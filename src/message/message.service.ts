import { HttpStatus, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { MessageRepository } from './message.repository';
import { MessageDocument } from './message.schema';
import { ParticipantRepository } from '@/participant/participant.repository';
import { ApiException, ExcKey } from '@/common/exceptions/api.exception';
import { RoomBroadcaster } from '@/ws/room-broadcaster.service';
import { WsEvents } from '@/ws/ws-events';
import { LinkPreviewData, MessageRes, SendMessageReq } from './message.dto';

@Injectable()
export class MessageService {
  constructor(
    private readonly repo: MessageRepository,
    private readonly participants: ParticipantRepository,
    private readonly broadcaster: RoomBroadcaster,
  ) {}

  async send(
    appId: string,
    roomId: string,
    senderId: string,
    req: SendMessageReq,
  ): Promise<MessageRes> {
    await this.assertParticipant(appId, roomId, senderId);
    this.assertMetadataSize(req.metadata);
    const doc = await this.repo.create({
      appId,
      roomId,
      senderId,
      content: req.content,
      attachments: req.attachments,
      metadata: req.metadata,
    });
    return this.toRes(doc);
  }

  /** Reject oversized opaque metadata — a generous cap for ids/small structs. */
  private assertMetadataSize(metadata: Record<string, unknown> | undefined): void {
    if (!metadata) return;
    if (JSON.stringify(metadata).length > 16_384) {
      throw new ApiException(
        ExcKey.UNHANDLED,
        'metadata exceeds the 16KB limit',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Edit a message's text. Always self-service: even via the trusted internal
   * key, `actorId` must equal the original sender (managers moderate by
   * deleting, not editing — see the monolith's `/manager` surface). Broadcasts
   * `message_update` to the room so live clients reconcile.
   */
  async edit(
    appId: string,
    roomId: string,
    messageId: string,
    actorId: string,
    content: string,
  ): Promise<MessageRes> {
    const doc = await this.loadOrThrow(appId, roomId, messageId);
    if (doc.deleted) {
      throw new ApiException(
        ExcKey.MESSAGE_DELETED,
        'Cannot edit a deleted message',
        HttpStatus.CONFLICT,
      );
    }
    if (doc.senderId.toString() !== actorId) {
      throw new ApiException(
        ExcKey.FORBIDDEN,
        'You can only edit your own messages',
        HttpStatus.FORBIDDEN,
      );
    }
    const trimmed = content.trim();
    if (!trimmed && !(doc.attachments && doc.attachments.length)) {
      throw new ApiException(
        ExcKey.EMPTY_MESSAGE,
        'Message content cannot be empty — delete it instead',
        HttpStatus.BAD_REQUEST,
      );
    }
    doc.content = trimmed;
    doc.editedAt = new Date();
    await this.repo.save(doc);

    const res = this.toRes(doc);
    this.broadcaster.emit(appId, roomId, WsEvents.MESSAGE_UPDATE, { roomId, message: res });
    return res;
  }

  /**
   * Soft-delete a message (tombstone). `allowAnySender` is the moderation
   * override the monolith sets on the manager route — when false, the actor
   * must be the original sender. Clears content/attachments so the deleted text
   * doesn't linger server-side, then broadcasts `message_deleted`. Idempotent.
   */
  /**
   * Soft-delete a message. Returns the message's `metadata` as it was *before*
   * tombstoning, so the caller (the app backend) can release any resources it
   * referenced — e.g. urbancare uncommits the media file ids. Quill itself
   * never interprets the metadata.
   */
  async remove(
    appId: string,
    roomId: string,
    messageId: string,
    actorId: string,
    allowAnySender: boolean,
  ): Promise<{ metadata?: Record<string, unknown> }> {
    const doc = await this.loadOrThrow(appId, roomId, messageId);
    if (doc.deleted) return {}; // already a tombstone — idempotent, nothing to release
    if (!allowAnySender && doc.senderId.toString() !== actorId) {
      throw new ApiException(
        ExcKey.FORBIDDEN,
        'You can only delete your own messages',
        HttpStatus.FORBIDDEN,
      );
    }
    const metadata = doc.metadata; // capture before clearing
    doc.deleted = true;
    doc.deletedAt = new Date();
    doc.content = '';
    doc.attachments = undefined;
    doc.linkPreviews = undefined;
    doc.set('metadata', undefined); // drop media/file refs from the tombstone
    await this.repo.save(doc);

    this.broadcaster.emit(appId, roomId, WsEvents.MESSAGE_DELETE, { roomId, messageId });
    return { metadata };
  }

  /**
   * Attach link previews to a message and broadcast the hydrated version
   * (`message_update`). Called by {@link LinkPreviewService} after an async
   * fetch. No-op if the message vanished or was deleted in the meantime.
   */
  async attachLinkPreviews(
    appId: string,
    roomId: string,
    messageId: string,
    previews: LinkPreviewData[],
  ): Promise<void> {
    if (!previews.length) return;
    const doc = await this.repo.findById(appId, roomId, messageId);
    if (!doc || doc.deleted) return;
    doc.set('linkPreviews', previews); // Mongoose casts plain objects → subdocs
    await this.repo.save(doc);

    const res = this.toRes(doc);
    this.broadcaster.emit(appId, roomId, WsEvents.MESSAGE_UPDATE, { roomId, message: res });
  }

  private async loadOrThrow(
    appId: string,
    roomId: string,
    messageId: string,
  ): Promise<MessageDocument> {
    const doc = await this.repo.findById(appId, roomId, messageId);
    if (!doc) {
      throw new ApiException(ExcKey.MESSAGE_NOT_FOUND, 'Message not found', HttpStatus.NOT_FOUND);
    }
    return doc;
  }

  /**
   * Paginate a room's history. Two directions, one per call:
   *   - `beforeIso` (exclusive) → older messages, newest-first — scroll-up.
   *   - `afterIso`  (exclusive) → newer messages, oldest-first — reconnect /
   *     missed-message backfill.
   * Pass the `createdAt` of your boundary message. Capped at 100; default 50.
   *
   * Owns input parsing (ISO string → Date) so callers (controller, future
   * WS handler, future cron) all hit the same validation.
   */
  async history(
    appId: string,
    roomId: string,
    userId: string,
    beforeIso: string | undefined,
    afterIso: string | undefined,
    limit: number,
  ): Promise<MessageRes[]> {
    await this.assertParticipant(appId, roomId, userId);

    if (beforeIso && afterIso) {
      throw new ApiException(
        ExcKey.UNHANDLED,
        'pass only one of `before` or `after`',
        HttpStatus.BAD_REQUEST,
      );
    }

    const after = this.parseIso(afterIso, 'after');
    if (after) {
      const docs = await this.repo.findForward(appId, roomId, after, limit);
      return docs.map((d) => this.toRes(d));
    }

    const before = this.parseIso(beforeIso, 'before');
    const docs = await this.repo.findHistory(appId, roomId, before, limit);
    return docs.map((d) => this.toRes(d));
  }

  private parseIso(iso: string | undefined, field: 'before' | 'after'): Date | undefined {
    if (!iso) return undefined;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      throw new ApiException(
        ExcKey.UNHANDLED,
        `\`${field}\` must be an ISO 8601 timestamp`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return d;
  }

  private async assertParticipant(appId: string, roomId: string, userId: string): Promise<void> {
    const ok = await this.participants.exists(appId, roomId, userId);
    if (!ok) {
      throw new ApiException(
        ExcKey.NOT_A_PARTICIPANT,
        'You are not a participant of this room',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private toRes(doc: MessageDocument): MessageRes {
    // `toObject()` strips Mongoose subdocument back-refs (`$parent`, etc.). A
    // populated `attachments`/`linkPreviews` array left as live subdocs is
    // circular, which blows the stack when class-transformer (here) or
    // Socket.IO (on emit) walks it. Plain primitives/ObjectIds are fine as-is.
    const obj = doc.toObject();
    return plainToInstance(MessageRes, {
      id: doc.id,
      senderId: doc.senderId,
      content: doc.content,
      attachments: obj.attachments,
      linkPreviews: obj.linkPreviews,
      metadata: obj.metadata,
      createdAt: doc.createdAt,
      // Omit when absent/false so the wire stays clean for the common case.
      editedAt: doc.editedAt ? doc.editedAt.toISOString() : undefined,
      deleted: doc.deleted ? true : undefined,
    });
  }
}
