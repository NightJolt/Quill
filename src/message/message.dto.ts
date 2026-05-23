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
import { AttachmentType } from './message.schema';

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

export interface MessageRes {
  id: string;
  roomId: string;
  senderId: string;
  content: string;
  attachments?: AttachmentDto[];
  linkPreviews?: { url: string; title?: string; description?: string; imageUrl?: string; siteName?: string }[];
  createdAt: string;
}
