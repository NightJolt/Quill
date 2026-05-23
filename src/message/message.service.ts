import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Message, MessageDocument } from './message.schema';
import { ParticipantService } from '@/participant/participant.service';
import { ApiException, ExcKey } from '@/common/exceptions/api.exception';
import { AttachmentDto, MessageRes, SendMessageReq } from './message.dto';

@Injectable()
export class MessageService {
  constructor(
    @InjectModel(Message.name) private readonly messages: Model<Message>,
    private readonly participants: ParticipantService,
  ) {}

  async send(
    appId: string,
    roomId: string,
    senderId: string,
    req: SendMessageReq,
  ): Promise<MessageRes> {
    const isParticipant = await this.participants.isParticipant(appId, roomId, senderId);
    if (!isParticipant) {
      throw new ApiException(
        ExcKey.NOT_A_PARTICIPANT,
        'You are not a participant of this room',
        HttpStatus.FORBIDDEN,
      );
    }
    const doc = await this.messages.create({
      appId,
      roomId,
      senderId,
      content: req.content,
      attachments: req.attachments,
    });
    return this.toRes(doc);
  }

  /**
   * Paginate history backwards in time. `before` is exclusive — pass the
   * `createdAt` of the oldest already-loaded message to fetch the next page.
   * Capped at 100 per page; default 50.
   */
  async history(
    appId: string,
    roomId: string,
    userId: string,
    before: Date | undefined,
    limit: number,
  ): Promise<MessageRes[]> {
    const isParticipant = await this.participants.isParticipant(appId, roomId, userId);
    if (!isParticipant) {
      throw new ApiException(
        ExcKey.NOT_A_PARTICIPANT,
        'You are not a participant of this room',
        HttpStatus.FORBIDDEN,
      );
    }
    const filter: Record<string, unknown> = { appId, roomId };
    if (before) filter.createdAt = { $lt: before };
    const docs = await this.messages.find(filter).sort({ createdAt: -1 }).limit(Math.min(limit, 100));
    return docs.map((d) => this.toRes(d));
  }

  private toRes(doc: MessageDocument): MessageRes {
    return {
      id: doc.id,
      roomId: doc.roomId.toString(),
      senderId: doc.senderId.toString(),
      content: doc.content,
      attachments: doc.attachments?.map(
        (a): AttachmentDto => ({
          type: a.type,
          fileId: a.fileId.toString(),
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          durationMs: a.durationMs,
        }),
      ),
      linkPreviews: doc.linkPreviews?.map((lp) => ({
        url: lp.url,
        title: lp.title,
        description: lp.description,
        imageUrl: lp.imageUrl,
        siteName: lp.siteName,
      })),
      createdAt: doc.createdAt.toISOString(),
    };
  }
}
