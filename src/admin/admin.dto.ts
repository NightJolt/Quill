import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { IdField } from '@/common/transformers/id-field.transformer';
import { IsoDate } from '@/common/transformers/iso-date.transformer';

// ── Requests ───────────────────────────────────────────────────────────────

export class RegisterAppReq {
  /**
   * Human-readable identifier — used in logs and admin UIs. Lowercase ascii
   * letters / digits / dashes / underscores. Unique across all chat_apps
   * rows.
   */
  @IsString()
  @MinLength(2)
  @MaxLength(48)
  @Matches(/^[a-z0-9_-]+$/, {
    message: 'label must be lowercase a-z, 0-9, hyphen or underscore',
  })
  label!: string;
}

// ── Responses ──────────────────────────────────────────────────────────────

export class AppRes {
  @IdField()
  appId!: string;
  label!: string;
  @IsoDate()
  createdAt!: string;
  @IsoDate()
  rotatedAt!: string | null;
  revoked!: boolean;
}

export class RegisterAppRes {
  @IdField()
  appId!: string;
  label!: string;
  /** Plaintext — shown ONCE. Capture and store immediately; cannot be retrieved later. */
  privateKey!: string;
}

export class RotateKeyRes {
  /** New plaintext key — replace the value in the consuming app's backend env. */
  privateKey!: string;
}
