import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AttachmentType, Message, MessageDocument } from './message.schema';

/**
 * Mongo data access for `chat_messages`. Pure queries.
 */
@Injectable()
export class MessageRepository {
  constructor(@InjectModel(Message.name) private readonly messages: Model<Message>) {}

  /**
   * `fileId` arrives as a string here (validated by `@IsMongoId()` on the
   * inbound DTO); Mongoose casts to ObjectId on save via the schema type.
   */
  create(args: {
    appId: string;
    roomId: string;
    senderId: string;
    content: string;
    attachments?: Array<{
      type: AttachmentType;
      fileId: string;
      mimeType?: string;
      sizeBytes?: number;
      durationMs?: number;
    }>;
  }): Promise<MessageDocument> {
    return this.messages.create(args);
  }

  /**
   * Paginated history newest-first. `before` is exclusive — pass the
   * `createdAt` of the oldest already-loaded message to fetch the next
   * page (scroll-up). Hard cap of 100 per page.
   */
  findHistory(
    appId: string,
    roomId: string,
    before: Date | undefined,
    limit: number,
  ): Promise<MessageDocument[]> {
    const filter: Record<string, unknown> = { appId, roomId };
    if (before) filter.createdAt = { $lt: before };
    return this.messages
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 100))
      .exec();
  }

  /**
   * Forward pagination, oldest-first. `after` is exclusive — pass the
   * `createdAt` of the newest message the client already has to fetch what
   * arrived since (reconnect / missed-message backfill). Ascending so a
   * client behind by more than `limit` can keep advancing `after` to the
   * newest received. Same `(appId, roomId, createdAt)` index, hard cap 100.
   */
  findForward(
    appId: string,
    roomId: string,
    after: Date,
    limit: number,
  ): Promise<MessageDocument[]> {
    return this.messages
      .find({ appId, roomId, createdAt: { $gt: after } })
      .sort({ createdAt: 1 })
      .limit(Math.min(limit, 100))
      .exec();
  }
}
