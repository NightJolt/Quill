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
  // Explicit `type: String` — Mongoose infers the field type from reflect
  // metadata, and a string-literal union (`'image'|'audio'|'file'`) only
  // collapses to String under tsc; esbuild/tsx emit `Object` and Mongoose
  // throws CannotDetermineTypeError. Naming it keeps the schema loader-agnostic.
  @Prop({ required: true, type: String, enum: Object.values(AttachmentType) })
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

  /**
   * Opaque, app-defined JSON. Quill never reads or interprets it — the calling
   * app owns the shape (urbancare uses it to carry chat media file ids). Stored
   * as Mixed; size is capped at the service layer.
   */
  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: Record<string, unknown>;

  /**
   * Emoji reactions, stored as a **map keyed by the reacting user's id** —
   * `{ "<userId hex>": "<emoji>" }` — not as an array of `{userId, emoji}`.
   *
   * The shape is chosen for atomicity, and it is the whole reason reactions
   * are not a `metadata` key:
   *
   *   - **One reaction per user** is enforced by the data structure itself. A
   *     map key cannot repeat, so a double-tap (or the same user on two
   *     devices) can never produce two entries — no dedup logic, no unique
   *     index, no read-modify-write.
   *   - **Set / replace / clear are each a single atomic op** on a *distinct
   *     document path*: `$set {"reactions.<uid>": e}` and
   *     `$unset {"reactions.<uid>": ""}`. Two users reacting in the same
   *     instant touch two different paths, so WiredTiger serialises them and
   *     **both survive** — neither overwrites the other. An array shape would
   *     have forced either a read-modify-write `save()` (lost updates under a
   *     reaction burst in an apartment-wide room) or a `$pull`+`$push` pair,
   *     which Mongo rejects outright as a conflicting update on one path.
   *
   * Cost of the shape: map keys are BSON field names, which must be strings —
   * so this is the one place a user id is *not* stored as an ObjectId (see
   * "Id storage convention" in CLAUDE.md). Keys are 24-char hex, already
   * validated by the WS handshake guard, so they are safe as field names
   * (no `.`, no leading `$`).
   *
   * Absent on messages nobody has reacted to (`default: undefined` — no empty
   * map is written), which is also why no migration is needed: existing rows
   * read as `undefined`, and `$set` on `reactions.<uid>` creates the path.
   *
   * Values are constrained to {@link REACTION_EMOJIS} at the service layer;
   * the schema only knows they are strings.
   */
  @Prop({ type: Map, of: String, default: undefined })
  reactions?: Map<string, string>;

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
