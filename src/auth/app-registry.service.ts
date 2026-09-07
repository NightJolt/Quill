import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Types } from 'mongoose';
import { AppRepository } from './app.repository';
import { KeyVault } from './key-vault.service';
import { ApiException, ExcKey } from '@/common/exceptions/api.exception';
import { isDuplicateKeyError } from '@/common/utils/mongo-errors';

/**
 * Registry of known apps + their private keys. Layered:
 *
 *   AppRepository   → raw Mongo queries on chat_apps
 *   AppRegistry     → in-memory cache (hot-path auth), encryption (via KeyVault),
 *                     lifecycle (register / rotate / unregister)
 *
 * Source of truth is `chat_apps`. On boot, every active row is decrypted
 * and cached in memory; guards never touch the DB. Mutations write through
 * to Mongo and patch the cache atomically.
 */
@Injectable()
export class AppRegistry implements OnModuleInit {
  private readonly logger = new Logger(AppRegistry.name);
  private readonly keyByAppId = new Map<string, string>();
  private readonly appIdByKey = new Map<string, string>();
  private readonly labelByAppId = new Map<string, string>();
  /**
   * Notify callback URLs, `appId` → absolute URL. Only apps that actually have
   * one configured appear here; a miss is the default, intended "no callback"
   * state, which is why {@link callbackUrlOf} returns `null` rather than
   * throwing.
   */
  private readonly callbackUrlByAppId = new Map<string, string>();

  constructor(
    private readonly repo: AppRepository,
    private readonly vault: KeyVault,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  // ─── Hot-path lookups (guards) ──────────────────────────────────────────

  getKey(appId: string): string | null {
    return this.keyByAppId.get(appId) ?? null;
  }

  findAppByKey(key: string): string | null {
    return this.appIdByKey.get(key) ?? null;
  }

  hasApp(appId: string): boolean {
    return this.keyByAppId.has(appId);
  }

  labelOf(appId: string): string {
    return this.labelByAppId.get(appId) ?? appId;
  }

  /**
   * The app's notify callback URL, or `null` when none is configured — the
   * default state, in which no callback is fired at all.
   */
  callbackUrlOf(appId: string): string | null {
    return this.callbackUrlByAppId.get(appId) ?? null;
  }

  // ─── Admin mutations ────────────────────────────────────────────────────

  /** Throws `ApiException(409)` if `label` is already taken. */
  async register(label: string): Promise<{ appId: string; privateKey: string; label: string }> {
    const privateKey = KeyVault.generateAppKey();
    const encryptedKey = this.vault.encrypt(privateKey);
    const _id = new Types.ObjectId();
    try {
      await this.repo.insert(_id, label, encryptedKey);
    } catch (err: unknown) {
      if (isDuplicateKeyError(err)) {
        throw new ApiException(
          ExcKey.UNHANDLED,
          `label "${label}" is already taken`,
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
    const appId = _id.toHexString();
    this.applyToCache(appId, label, privateKey);
    this.logger.log(`Registered app: ${label}(${appId})`);
    return { appId, privateKey, label };
  }

  /** Throws `ApiException(404)` if no such app exists or it's already revoked. */
  async unregister(appId: string): Promise<void> {
    const revoked = await this.repo.markRevoked(appId);
    if (!revoked) {
      throw new ApiException(
        ExcKey.UNHANDLED,
        'App not found or already revoked',
        HttpStatus.NOT_FOUND,
      );
    }
    this.removeFromCache(appId);
    this.logger.log(`Revoked app: ${appId}`);
  }

  /** Throws `ApiException(404)` if no such app exists or it's already revoked. */
  async rotate(appId: string): Promise<{ privateKey: string }> {
    const doc = await this.repo.findActiveById(appId);
    if (!doc) {
      throw new ApiException(
        ExcKey.UNHANDLED,
        'App not found or already revoked',
        HttpStatus.NOT_FOUND,
      );
    }
    const privateKey = KeyVault.generateAppKey();
    const encryptedKey = this.vault.encrypt(privateKey);
    await this.repo.updateEncryptedKey(appId, encryptedKey);
    // Carry `callbackUrl` through — `applyToCache` rewrites the whole cache
    // entry, so omitting it here would silently un-configure the callback on
    // every key rotation.
    this.applyToCache(appId, doc.label, privateKey, doc.callbackUrl);
    this.logger.log(`Rotated key for app: ${doc.label}(${appId})`);
    return { privateKey };
  }

  /**
   * Set (or clear, with `null`) the app's notify callback URL — writes through
   * to Mongo, then patches the in-memory cache so the change takes effect on
   * the very next message without a restart.
   *
   * Throws `ApiException(404)` if no such app exists or it's already revoked,
   * matching {@link rotate} / {@link unregister}.
   */
  async setCallbackUrl(appId: string, url: string | null): Promise<void> {
    const doc = await this.repo.findActiveById(appId);
    if (!doc) {
      throw new ApiException(
        ExcKey.UNHANDLED,
        'App not found or already revoked',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.repo.updateCallbackUrl(appId, url);
    if (url) this.callbackUrlByAppId.set(appId, url);
    else this.callbackUrlByAppId.delete(appId);
    this.logger.log(
      url
        ? `Set callbackUrl for app: ${doc.label}(${appId}) → ${url}`
        : `Cleared callbackUrl for app: ${doc.label}(${appId})`,
    );
  }

  /** Non-sensitive snapshot — no keys, suitable for `/admin/apps` list. */
  async list(): Promise<
    {
      appId: string;
      label: string;
      createdAt: Date;
      rotatedAt?: Date;
      revoked: boolean;
      callbackUrl?: string;
    }[]
  > {
    const docs = await this.repo.findAll();
    return docs.map((d) => ({
      appId: d.id,
      label: d.label,
      createdAt: d.createdAt,
      rotatedAt: d.rotatedAt,
      revoked: d.revoked,
      // Not a secret, and the only way to confirm a PATCH landed without
      // reading Mongo directly.
      callbackUrl: d.callbackUrl,
    }));
  }

  /**
   * Replace the in-memory cache from DB. Mostly used at boot. When/if
   * Quill goes multi-instance, change-stream listeners on `chat_apps`
   * can invoke this to keep instances in sync.
   */
  async reload(): Promise<void> {
    this.keyByAppId.clear();
    this.appIdByKey.clear();
    this.labelByAppId.clear();
    this.callbackUrlByAppId.clear();
    const docs = await this.repo.findActive();
    for (const doc of docs) {
      let plaintextKey: string;
      try {
        plaintextKey = this.vault.decrypt(doc.encryptedKey!);
      } catch (err) {
        this.logger.error(
          `Failed to decrypt key for app ${doc.label}(${doc.id}) — wrong master key?`,
          err as Error,
        );
        continue;
      }
      this.applyToCache(doc.id, doc.label, plaintextKey, doc.callbackUrl);
    }
    const summary = [...this.keyByAppId.keys()]
      .map((id) => `${this.labelByAppId.get(id)}(${id})`)
      .join(', ');
    this.logger.log(`Loaded ${this.keyByAppId.size} app(s): ${summary || '(none)'}`);
  }

  // ─── Cache helpers (private) ────────────────────────────────────────────

  /**
   * Write one app's full cache entry. `callbackUrl` is the app's *current*
   * stored value (undefined when it has none) — every caller must pass what it
   * read from Mongo, because this rewrites the entry rather than merging into
   * it. {@link setCallbackUrl} patches that one key on its own instead.
   */
  private applyToCache(
    appId: string,
    label: string,
    privateKey: string,
    callbackUrl?: string,
  ): void {
    const oldKey = this.keyByAppId.get(appId);
    if (oldKey && oldKey !== privateKey) {
      this.appIdByKey.delete(oldKey);
    }
    this.keyByAppId.set(appId, privateKey);
    this.appIdByKey.set(privateKey, appId);
    this.labelByAppId.set(appId, label);
    if (callbackUrl) this.callbackUrlByAppId.set(appId, callbackUrl);
    else this.callbackUrlByAppId.delete(appId);
  }

  private removeFromCache(appId: string): void {
    const key = this.keyByAppId.get(appId);
    this.keyByAppId.delete(appId);
    if (key) this.appIdByKey.delete(key);
    this.labelByAppId.delete(appId);
    this.callbackUrlByAppId.delete(appId);
  }
}
