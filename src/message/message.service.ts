import { HttpStatus, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { MessageRepository } from './message.repository';
import { MessageDocument } from './message.schema';
import { ParticipantRepository } from '@/participant/participant.repository';
import { ApiException, ExcKey } from '@/common/exceptions/api.exception';
import { RoomBroadcaster } from '@/ws/room-broadcaster.service';
import { WsEvents } from '@/ws/ws-events';
import { MessageRes, SendMessageReq } from './message.dto';

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
    const doc = await this.repo.create({
      appId,
      roomId,
      senderId,
      content: req.content,
      attachments: req.attachments,
    });
    return this.toRes(doc);
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
  async remove(
    appId: string,
    roomId: string,
    messageId: string,
    actorId: string,
    allowAnySender: boolean,
  ): Promise<void> {
    const doc = await this.loadOrThrow(appId, roomId, messageId);
    if (doc.deleted) return; // already a tombstone — idempotent
    if (!allowAnySender && doc.senderId.toString() !== actorId) {
      throw new ApiException(
        ExcKey.FORBIDDEN,
        'You can only delete your own messages',
        HttpStatus.FORBIDDEN,
      );
    }
    doc.deleted = true;
    doc.deletedAt = new Date();
    doc.content = '';
    doc.attachments = undefined;
    doc.linkPreviews = undefined;
    await this.repo.save(doc);

    this.broadcaster.emit(appId, roomId, WsEvents.MESSAGE_DELETE, { roomId, messageId });
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
    return plainToInstance(MessageRes, {
      id: doc.id,
      senderId: doc.senderId,
      content: doc.content,
      attachments: doc.attachments,
      linkPreviews: doc.linkPreviews,
      createdAt: doc.createdAt,
      // Omit when absent/false so the wire stays clean for the common case.
      editedAt: doc.editedAt ? doc.editedAt.toISOString() : undefined,
      deleted: doc.deleted ? true : undefined,
    });
  }
}
