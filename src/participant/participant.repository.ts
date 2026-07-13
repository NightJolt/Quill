import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Participant, ParticipantDocument } from './participant.schema';
import { isDuplicateKeyError } from '@/common/utils/mongo-errors';

/**
 * Mongo data access for `chat_participants`. Pure queries.
 */
@Injectable()
export class ParticipantRepository {
  constructor(
    @InjectModel(Participant.name) private readonly participants: Model<Participant>,
  ) {}

  /**
   * Idempotent bulk add. Pre-existing `(appId, roomId, userId)` rows are
   * silently skipped via the unique index + `ordered: false`. Returns
   * the full participant set for the given userIds (newly added + already
   * present).
   */
  async addMany(
    appId: string,
    roomId: string,
    userIds: string[],
  ): Promise<ParticipantDocument[]> {
    const rows = userIds.map((userId) => ({ appId, roomId, userId, lastReadAt: null }));
    try {
      await this.participants.insertMany(rows, { ordered: false });
    } catch (err: unknown) {
      // Bulk insert with duplicates is the happy path — rethrow only on
      // non-dupkey errors.
      if (!isDuplicateKeyError(err)) throw err;
    }
    return this.participants.find({ appId, roomId, userId: { $in: userIds } }).exec();
  }

  async remove(appId: string, roomId: string, userId: string): Promise<void> {
    await this.participants.deleteOne({ appId, roomId, userId });
  }

  findByRoom(appId: string, roomId: string): Promise<ParticipantDocument[]> {
    return this.participants.find({ appId, roomId }).exec();
  }

  async listRoomIdsForUser(appId: string, userId: string): Promise<string[]> {
    const docs = await this.participants
      .find({ appId, userId }, { roomId: 1 })
      .lean<{ roomId: Types.ObjectId }[]>();
    return docs.map((d) => d.roomId.toString());
  }

  async exists(appId: string, roomId: string, userId: string): Promise<boolean> {
    const count = await this.participants.countDocuments({ appId, roomId, userId });
    return count > 0;
  }

  async markRead(appId: string, roomId: string, userId: string, at: Date): Promise<void> {
    // $max: the watermark only advances — a stale/out-of-order `read` emit
    // from a reconnecting client must not regress it.
    await this.participants.updateOne(
      { appId, roomId, userId },
      { $max: { lastReadAt: at } },
    );
  }
}
