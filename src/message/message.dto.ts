import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsMongoId,
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

  @IsoDate()
  createdAt!: string;
}
