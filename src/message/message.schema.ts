import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export const AttachmentType = {
  IMAGE: 'image',
  AUDIO: 'audio',
  FILE: 'file',
} as const;
export type AttachmentType = (typeof AttachmentType)[keyof typeof AttachmentType];

/**
 * Attachment metadata. The `fileId` references the *calling app's* file
 * storage — Quill never holds bytes, only ids. Apps resolve `fileId` to a URL
 * on their own side when rendering.
 */
@Schema({ _id: false })
export class Attachment {
  @Prop({ required: true, enum: Object.values(AttachmentType) })
  type!: AttachmentType;

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  fileId!: Types.ObjectId;

  @Prop()
  mimeType?: string;

  @Prop()
  sizeBytes?: number;

  @Prop()
  durationMs?: number;
}
const AttachmentSchema = SchemaFactory.createForClass(Attachment);

@Schema({ _id: false })
export class LinkPreview {
  @Prop({ required: true })
  url!: string;

  @Prop()
  title?: string;

  @Prop()
  description?: string;

  @Prop()
  imageUrl?: string;

  @Prop()
  siteName?: string;
}
const LinkPreviewSchema = SchemaFactory.createForClass(LinkPreview);

@Schema({ collection: 'chat_messages', timestamps: { createdAt: true, updatedAt: false } })
export class Message {
  @Prop({ required: true, index: true, type: MongooseSchema.Types.ObjectId })
  appId!: Types.ObjectId;

  /**
   * `roomId` and `senderId` are ObjectIds in storage (mirrors the monolith's
   * `@Field(targetType = OBJECT_ID)` convention). API boundary uses strings;
   * `toRes()` converts back via `.toString()`.
   */
  @Prop({ required: true, index: true, type: MongooseSchema.Types.ObjectId })
  roomId!: Types.ObjectId;

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  senderId!: Types.ObjectId;

  // Not `required` — a soft-deleted tombstone sets this to '', and Mongoose's
  // required validator rejects empty strings. `default: ''` still guarantees a
  // string; non-empty content for real sends is enforced in the DTO/service.
  @Prop({ default: '' })
  content!: string;

  @Prop({ type: [AttachmentSchema], default: undefined })
  attachments?: Attachment[];

  @Prop({ type: [LinkPreviewSchema], default: undefined })
  linkPreviews?: LinkPreview[];

  /** Set when the sender edits the message; absent on never-edited messages. */
  @Prop({ type: Date })
  editedAt?: Date;

  /**
   * Soft-delete tombstone. When true, `content`/`attachments` are cleared and
   * clients render a "message deleted" placeholder. History still returns the
   * row so deleted state is consistent between live and backfilled views.
   */
  @Prop({ default: false })
  deleted!: boolean;

  @Prop({ type: Date })
  deletedAt?: Date;

  createdAt!: Date;
}

export type MessageDocument = HydratedDocument<Message>;
export const MessageSchema = SchemaFactory.createForClass(Message);

// History pagination scan: same room, walk backwards in time.
MessageSchema.index({ appId: 1, roomId: 1, createdAt: -1 });
