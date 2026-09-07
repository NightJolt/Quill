import { IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength } from 'class-validator';
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

/**
 * Body for `PATCH /admin/apps/:appId`. One patchable field today.
 *
 * `callbackUrl` is where Quill POSTs its notify callback after every sent
 * message in this tenant. **Both `null` and an omitted field clear it** — with
 * a single field there is no useful "leave unchanged" case to distinguish, and
 * cleared is the safe interpretation (it is also the default state: no URL
 * means no callback is ever fired).
 *
 * `@IsOptional()` is what lets an explicit `null` through — class-validator
 * skips the remaining validators for `null` *and* `undefined`.
 */
export class PatchAppReq {
  @IsOptional()
  // `require_tld: false` is deliberate and load-bearing: validator.js defaults
  // it to true, which rejects `http://localhost:8085/...` — the exact URL every
  // local dev setup points the callback at, and the one the runbook documents.
  // It also admits in-cluster service names (`http://core:8085/...`). The
  // protocol allowlist is what actually constrains the target; `PushService`
  // only ever POSTs, never follows redirects into anything else.
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(512)
  callbackUrl?: string | null;
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
  /** Notify callback target; absent when the app has none configured. */
  callbackUrl?: string;
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
