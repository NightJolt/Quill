import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IdField } from '@/common/transformers/id-field.transformer';
import { IsoDate } from '@/common/transformers/iso-date.transformer';

// ── Requests ───────────────────────────────────────────────────────────────

/**
 * Body for `PUT /internal/rooms/:roomId`. The room id comes from the URL —
 * caller picks it (typically the consuming app's own resource id, e.g.
 * `apartmentId` for urbancare). PUT is idempotent: existing rooms with the
 * same `(appId, roomId)` are left alone (resurrected from soft delete if they
 * were deleted, name overwritten if supplied).
 */
export class PutRoomReq {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  name?: string;
}

// ── Responses ──────────────────────────────────────────────────────────────

export class RoomRes {
  @IdField()
  id!: string;
  name?: string;
  @IsoDate()
  createdAt!: string;
}
