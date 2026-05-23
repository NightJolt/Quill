import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { App, AppDocument } from './app.schema';
import { KeyVault } from './key-vault.service';

/**
 * Registry of known apps + their private keys.
 *
 * Source of truth is `chat_apps` (Mongo). Each row carries an envelope-
 * encrypted private key (`encryptedKey`); on boot we decrypt every active
 * row and cache plaintext keys in memory for hot-path lookups. The cache is
 * the only thing guards consult — never the DB on a per-request basis.
 *
 * Mutations (`register` / `unregister` / `rotate`) update the DB row and then
 * mutate the cache in-place. There is no env scanning anywhere.
 */
@Injectable()
export class AppRegistry implements OnModuleInit {
  private readonly logger = new Logger(AppRegistry.name);
  private readonly keyByAppId = new Map<string, string>();
  private readonly appIdByKey = new Map<string, string>();
  private readonly labelByAppId = new Map<string, string>();

  constructor(
    @InjectModel(App.name) private readonly apps: Model<App>,
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

  // ─── Admin mutations ────────────────────────────────────────────────────

  /**
   * Mint a new app. Returns the plaintext private key in the response —
   * caller MUST capture it, the value is not retrievable afterward.
   *
   * Throws on duplicate `label` (Mongo unique index on `chat_apps.label`).
   */
  async register(label: string): Promise<{ appId: string; privateKey: string; label: string }> {
    const privateKey = KeyVault.generateAppKey();
    const encryptedKey = this.vault.encrypt(privateKey);
    const _id = new Types.ObjectId();
    await this.apps.create({ _id, label, encryptedKey, revoked: false });
    const appId = _id.toHexString();
    this.applyToCache(appId, label, privateKey);
    this.logger.log(`Registered app: ${label}(${appId})`);
    return { appId, privateKey, label };
  }

  /**
   * Revoke an app — sets `revoked: true` and drops it from the cache.
   * The chat_apps row stays for historical record; rooms/messages with
   * this appId remain in the DB but can no longer be authenticated against.
   *
   * Returns true if a row was actually revoked, false if no such app.
   */
  async unregister(appId: string): Promise<boolean> {
    const result = await this.apps.updateOne(
      { _id: new Types.ObjectId(appId), revoked: { $ne: true } },
      { $set: { revoked: true } },
    );
    if (result.matchedCount === 0) return false;
    this.removeFromCache(appId);
    this.logger.log(`Revoked app: ${appId}`);
    return true;
  }

  /**
   * Rotate an app's private key. The old key is discarded; existing
   * signatures issued against it become invalid. Callers must distribute
   * the new key to the consuming app's backend.
   */
  async rotate(appId: string): Promise<{ privateKey: string } | null> {
    const _id = new Types.ObjectId(appId);
    const doc = await this.apps.findOne({ _id, revoked: { $ne: true } });
    if (!doc) return null;
    const privateKey = KeyVault.generateAppKey();
    const encryptedKey = this.vault.encrypt(privateKey);
    await this.apps.updateOne({ _id }, { $set: { encryptedKey, rotatedAt: new Date() } });
    this.applyToCache(appId, doc.label, privateKey);
    this.logger.log(`Rotated key for app: ${doc.label}(${appId})`);
    return { privateKey };
  }

  /** Non-sensitive snapshot — no keys, suitable for /admin/apps list. */
  async list(): Promise<
    { appId: string; label: string; createdAt: Date; rotatedAt?: Date; revoked: boolean }[]
  > {
    const docs = await this.apps.find({}).sort({ createdAt: 1 });
    return docs.map((d) => ({
      appId: d.id,
      label: d.label,
      createdAt: d.createdAt,
      rotatedAt: d.rotatedAt,
      revoked: d.revoked,
    }));
  }

  /**
   * Replace the in-memory cache from DB. Mostly used at boot — for
   * single-instance deployments mutations call `applyToCache`/`removeFromCache`
   * directly. When/if Quill goes multi-instance, this becomes the path
   * change-stream listeners invoke.
   */
  async reload(): Promise<void> {
    this.keyByAppId.clear();
    this.appIdByKey.clear();
    this.labelByAppId.clear();
    const docs = await this.apps.find({
      revoked: { $ne: true },
      encryptedKey: { $exists: true },
    });
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
      this.applyToCache(doc.id, doc.label, plaintextKey);
    }
    const summary = [...this.keyByAppId.keys()]
      .map((id) => `${this.labelByAppId.get(id)}(${id})`)
      .join(', ');
    this.logger.log(`Loaded ${this.keyByAppId.size} app(s): ${summary || '(none)'}`);
  }

  // ─── Cache helpers (private) ────────────────────────────────────────────

  private applyToCache(appId: string, label: string, privateKey: string): void {
    // If rotating, the old key still maps to this appId — drop it.
    const oldKey = this.keyByAppId.get(appId);
    if (oldKey && oldKey !== privateKey) {
      this.appIdByKey.delete(oldKey);
    }
    this.keyByAppId.set(appId, privateKey);
    this.appIdByKey.set(privateKey, appId);
    this.labelByAppId.set(appId, label);
  }

  private removeFromCache(appId: string): void {
    const key = this.keyByAppId.get(appId);
    this.keyByAppId.delete(appId);
    if (key) this.appIdByKey.delete(key);
    this.labelByAppId.delete(appId);
  }
}
