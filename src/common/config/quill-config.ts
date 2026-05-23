import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';


/**
 * Strongly-typed accessor for Quill's runtime config. The raw values come from
 * environment variables (loaded by `@nestjs/config`); this class is responsible
 * for parsing the dynamic `QUILL_APP_<NAME>_ID` / `QUILL_APP_<NAME>_KEY` pairs
 * into a stable list the AuthModule can consume.
 *
 * Apps are env-driven for MVP. A `chat_apps` collection would replace this
 * source without changing the consumers.
 */
@Injectable()
export class QuillConfig {
  constructor(private readonly config: ConfigService) {}

  get port(): number {
    return Number(this.config.get<string>('PORT', '8086'));
  }

  get mongoUri(): string {
    const uri = this.config.get<string>('MONGO_URI');
    if (!uri) {
      throw new Error('MONGO_URI is required');
    }
    return uri;
  }

  get corsOrigins(): string[] | '*' {
    const raw = this.config.get<string>('QUILL_CORS_ORIGINS', '*');
    if (raw.trim() === '*') return '*';
    return raw
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  /** AES-256 master key used to envelope-encrypt app private keys in chat_apps. */
  get masterKey(): string | undefined {
    return this.config.get<string>('QUILL_MASTER_KEY');
  }

  /** Single bearer token authorizing /admin/** endpoints. Set in env, treat as a root password. */
  get adminToken(): string | undefined {
    return this.config.get<string>('QUILL_ADMIN_TOKEN');
  }

}
