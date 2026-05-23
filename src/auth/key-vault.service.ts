import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { QuillConfig } from '@/common/config/quill-config';

/**
 * Envelope encryption for app private keys.
 *
 *   plaintext key  ─ encrypt ─→  base64(IV || ciphertext || authTag)
 *   stored as       chat_apps.encryptedKey
 *   the key that encrypts        QUILL_MASTER_KEY (env)
 *
 * Why this exists: once apps can be created at runtime (admin API), env can't
 * be the carrier for app secrets — they have to live in the DB. Storing them
 * in plaintext means a DB compromise = total key compromise. Envelope
 * encryption with a single env-resident master key means a DB compromise
 * yields useless ciphertext.
 *
 * Algorithm: AES-256-GCM. Authenticated encryption — the auth tag detects
 * tampering. 96-bit IV per Mongo doc (NIST-recommended for GCM).
 *
 * Master key rotation is not yet implemented; if needed later, re-encrypt
 * every chat_apps row in a maintenance script.
 */
@Injectable()
export class KeyVault implements OnModuleInit {
  private static readonly ALGO = 'aes-256-gcm';
  private static readonly IV_BYTES = 12;
  private static readonly KEY_BYTES = 32;

  private readonly logger = new Logger(KeyVault.name);
  private masterKey!: Buffer;

  constructor(private readonly config: QuillConfig) {}

  onModuleInit(): void {
    const raw = this.config.masterKey;
    if (!raw) {
      throw new Error('QUILL_MASTER_KEY env var is required (32-byte hex, 64 characters)');
    }
    if (!/^[a-fA-F0-9]{64}$/.test(raw)) {
      throw new Error(
        'QUILL_MASTER_KEY must be 64 hex characters (32 bytes). Generate with: ' +
          'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      );
    }
    this.masterKey = Buffer.from(raw, 'hex');
    if (this.masterKey.length !== KeyVault.KEY_BYTES) {
      throw new Error('QUILL_MASTER_KEY decoded to wrong length');
    }
    this.logger.log('KeyVault initialized');
  }

  /** Encrypt a plaintext key. Output is base64(IV || ciphertext || authTag). */
  encrypt(plaintext: string): string {
    const iv = randomBytes(KeyVault.IV_BYTES);
    const cipher = createCipheriv(KeyVault.ALGO, this.masterKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, ciphertext, authTag]).toString('base64');
  }

  /** Decrypt back to plaintext. Throws on auth-tag mismatch (tampering/wrong key). */
  decrypt(blob: string): string {
    const buf = Buffer.from(blob, 'base64');
    if (buf.length < KeyVault.IV_BYTES + 16) {
      throw new Error('encryptedKey blob too short');
    }
    const iv = buf.subarray(0, KeyVault.IV_BYTES);
    const authTag = buf.subarray(buf.length - 16);
    const ciphertext = buf.subarray(KeyVault.IV_BYTES, buf.length - 16);
    const decipher = createDecipheriv(KeyVault.ALGO, this.masterKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  /** Helper for generating a new app private key (used by registry.register). */
  static generateAppKey(): string {
    return randomBytes(KeyVault.KEY_BYTES).toString('hex');
  }
}
