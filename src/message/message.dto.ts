import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsMongoId,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IdField } from '@/common/transformers/id-field.transformer';
import { IsoDate } from '@/common/transformers/iso-date.transformer';
import { AttachmentType } from './message.schema';

// ── Requests ───────────────────────────────────────────────────────────────

export class AttachmentDto {
  @IsEnum(AttachmentType)
  type!: AttachmentType;

  @IsMongoId()
  fileId!: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationMs?: number;
}

export class SendMessageReq {
  @IsString()
  @MaxLength(4000)
  content!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];

  /** Opaque app-defined JSON (size-capped in the service). */
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * Body for `PATCH /internal/rooms/:roomId/messages/:messageId` — the trusted
 * app-backend channel. `actorId` is the user the calling app is acting on
 * behalf of; the service still enforces `actorId === senderId` (edit is
 * always self-service, even over the internal key).
 */
export class EditMessageInternalReq {
  @IsString()
  @MaxLength(4000)
  content!: string;

  @IsMongoId()
  actorId!: string;
}

// ── Response sub-shapes ────────────────────────────────────────────────────

export class AttachmentRes {
  type!: AttachmentType;
  @IdField()
  fileId!: string;
  mimeType?: string;
  sizeBytes?: number;
  durationMs?: number;
}

export class LinkPreviewRes {
  url!: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
}

/**
 * One reaction bucket: an emoji plus every user currently reacting with it.
 *
 * Aggregated from the per-user storage map so clients get a render-ready chip
 * row (`userIds.length` is the count; `userIds.includes(me)` is the "you
 * reacted" highlight) without regrouping on every paint. Because one user
 * holds at most one reaction, a given userId appears in exactly one bucket.
 *
 * `userIds` are plain 24-char hex strings — they are Mongo map *keys*, so they
 * are already strings in storage and need no `@IdField` conversion.
 */
export class ReactionRes {
  emoji!: string;
  userIds!: string[];
}

/**
 * Plain shape the link-preview scraper produces and `MessageService`
 * persists. Mongoose casts these into `LinkPreview` subdocuments on save.
 */
export interface LinkPreviewData {
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
}

// ── Responses ──────────────────────────────────────────────────────────────

export class MessageRes {
  @IdField()
  id!: string;
  @IdField()
  senderId!: string;
  content!: string;

  @Type(() => AttachmentRes)
  attachments?: AttachmentRes[];

  @Type(() => LinkPreviewRes)
  linkPreviews?: LinkPreviewRes[];

  /** Opaque app-defined JSON, echoed back verbatim. */
  metadata?: Record<string, unknown>;

  /**
   * Emoji reactions, one bucket per emoji, ordered by the canonical
   * `REACTION_EMOJIS` order (stable — chips never reshuffle as counts change).
   *
   * **Omitted entirely when nobody has reacted**, matching how `editedAt` and
   * `deleted` are omitted — most messages carry none and history pages stay
   * lean. Clients must read an absent field as `[]`.
   */
  @Type(() => ReactionRes)
  reactions?: ReactionRes[];

  @IsoDate()
  createdAt!: string;

  /** Present (ISO) only when the message has been edited. */
  editedAt?: string;

  /** Present (`true`) only for tombstones; omitted on live messages. */
  deleted?: boolean;
}
