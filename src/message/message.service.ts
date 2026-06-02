import { HttpStatus, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { MessageRepository } from './message.repository';
import { MessageDocument } from './message.schema';
import { ParticipantRepository } from '@/participant/participant.repository';
import { ApiException, ExcKey } from '@/common/exceptions/api.exception';
import { MessageRes, SendMessageReq } from './message.dto';

@Injectable()
export class MessageService {
  constructor(
    private readonly repo: MessageRepository,
    private readonly participants: ParticipantRepository,
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
    });
  }
}
