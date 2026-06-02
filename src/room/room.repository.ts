import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Room, RoomDocument } from './room.schema';
import { isDuplicateKeyError } from '@/common/utils/mongo-errors';

/**
 * Mongo data access for `chat_rooms`. Pure queries — no business logic,
 * no error translation. `RoomService` composes this for the HTTP-facing
 * behaviour (throwing `ApiException` on not-found, mapping to `RoomRes`).
 *
 * Rooms are keyed on `(appId, roomId)` — the caller-supplied external id,
 * unique per tenant — never on `_id` (a Quill-internal surrogate).
 */
@Injectable()
export class RoomRepository {
  constructor(@InjectModel(Room.name) private readonly rooms: Model<Room>) {}

  /** Tenant-scoped identity filter. */
  private key(appId: string, roomId: string): FilterQuery<Room> {
    return { appId: new Types.ObjectId(appId), roomId: new Types.ObjectId(roomId) };
  }

  /**
   * Idempotent upsert keyed on `(appId, roomId)`. `setOnInsert` populates
   * immutable fields only when the document is freshly created; `$set` runs
   * every call (so PUT resurrects soft-deleted rooms and optionally refreshes
   * the name). `_id` is left to Mongo to generate.
   */
  async upsert(appId: string, roomId: string, name: string | undefined): Promise<RoomDocument> {
    const filter = this.key(appId, roomId);
    const setFields: Record<string, unknown> = { deleted: false };
    if (name !== undefined) setFields.name = name;
    try {
      await this.rooms.updateOne(
        filter,
        { $setOnInsert: { ...filter, createdAt: new Date() }, $set: setFields },
        { upsert: true },
      );
    } catch (err: unknown) {
      // A concurrent upsert won the insert race on the unique (appId, roomId)
      // index — retry as a plain update against the now-existing row.
      if (!isDuplicateKeyError(err)) throw err;
      await this.rooms.updateOne(filter, { $set: setFields });
    }
    const room = await this.rooms.findOne(filter);
    if (!room) {
      // Defensive — would only happen if a parallel delete raced our upsert.
      throw new Error(`Room ${roomId} disappeared after upsert`);
    }
    return room;
  }

  /** Excludes soft-deleted rows. */
  findActive(appId: string, roomId: string): Promise<RoomDocument | null> {
    return this.rooms.findOne({ ...this.key(appId, roomId), deleted: false }).exec();
  }

  async existsActive(appId: string, roomId: string): Promise<boolean> {
    const exists = await this.rooms.exists({ ...this.key(appId, roomId), deleted: false });
    return exists !== null;
  }

  /** Returns true if a row was newly soft-deleted; false if not found or already deleted. */
  async softDelete(appId: string, roomId: string): Promise<boolean> {
    const result = await this.rooms.updateOne(
      { ...this.key(appId, roomId), deleted: false },
      { $set: { deleted: true } },
    );
    return result.matchedCount > 0;
  }
}
