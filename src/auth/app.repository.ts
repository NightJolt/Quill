import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { App, AppDocument } from './app.schema';

/**
 * Mongo data access for `chat_apps`. Pure queries — no caching, no
 * encryption, no errors translated to HTTP shape. `AppRegistry` is the
 * service layer; it composes this repo with `KeyVault` and the in-memory
 * cache for the hot-path auth lookups.
 */
@Injectable()
export class AppRepository {
  constructor(@InjectModel(App.name) private readonly apps: Model<App>) {}

  findAll(): Promise<AppDocument[]> {
    return this.apps.find({}).sort({ createdAt: 1 }).exec();
  }

  /** Non-revoked rows with a populated `encryptedKey` — the registry's hot set. */
  findActive(): Promise<AppDocument[]> {
    return this.apps
      .find({ revoked: { $ne: true }, encryptedKey: { $exists: true } })
      .exec();
  }

  findActiveById(appId: string): Promise<AppDocument | null> {
    return this.apps.findOne({ _id: new Types.ObjectId(appId), revoked: { $ne: true } }).exec();
  }

  insert(_id: Types.ObjectId, label: string, encryptedKey: string): Promise<AppDocument> {
    return this.apps.create({ _id, label, encryptedKey, revoked: false });
  }

  /** Mark soft-revoked. Returns true if a row was updated; false if not found / already revoked. */
  async markRevoked(appId: string): Promise<boolean> {
    const result = await this.apps.updateOne(
      { _id: new Types.ObjectId(appId), revoked: { $ne: true } },
      { $set: { revoked: true } },
    );
    return result.matchedCount > 0;
  }

  async updateEncryptedKey(appId: string, encryptedKey: string): Promise<void> {
    await this.apps.updateOne(
      { _id: new Types.ObjectId(appId) },
      { $set: { encryptedKey, rotatedAt: new Date() } },
    );
  }
}
