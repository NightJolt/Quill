import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterAppReq {
  @ApiProperty({
    description:
      'Human-readable identifier — used in logs and admin UIs. Lowercase ascii letters / digits / dashes / underscores. Unique across all chat_apps rows.',
    example: 'acme-coworking',
    minLength: 2,
    maxLength: 48,
    pattern: '^[a-z0-9_-]+$',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(48)
  @Matches(/^[a-z0-9_-]+$/, {
    message: 'label must be lowercase a-z, 0-9, hyphen or underscore',
  })
  label!: string;
}

export interface AppRes {
  appId: string;
  label: string;
  createdAt: string;
  rotatedAt: string | null;
  revoked: boolean;
}

export interface RegisterAppRes {
  appId: string;
  label: string;
  /** Plaintext — shown ONCE. Capture and store immediately; cannot be retrieved later. */
  privateKey: string;
}

export interface RotateKeyRes {
  /** New plaintext key — replace the value in the consuming app's backend env. */
  privateKey: string;
}
