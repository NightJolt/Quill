import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsMongoId } from 'class-validator';
import { IdField } from '@/common/transformers/id-field.transformer';
import { IsoDate } from '@/common/transformers/iso-date.transformer';

// ── Requests ───────────────────────────────────────────────────────────────

export class AddParticipantsReq {
  /**
   * UserIds to add (24-char hex). Idempotent — adding existing participants
   * is a no-op. At least 1, at most 500 per call.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsMongoId({ each: true })
  userIds!: string[];
}

// ── Responses ──────────────────────────────────────────────────────────────

export class ParticipantRes {
  @IdField()
  userId!: string;
  @IsoDate()
  joinedAt!: string;
  @IsoDate()
  lastReadAt!: string | null;
}
