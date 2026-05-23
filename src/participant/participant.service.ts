import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Participant, ParticipantDocument } from './participant.schema';
import { Room } from '../room/room.schema';
import { ApiException, ExcKey } from '../common/exceptions/api.exception';
import { ParticipantRes } from './participant.dto';

@Injectable()
export class ParticipantService {
  constructor(
    @InjectModel(Participant.name) private readonly participants: Model<Participant>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
  ) {}

  /**
   * Idempotent — adding a userId that's already a participant is a no-op
   * (the unique-index conflict is swallowed via `ordered: false`). Returns
   * the participant rows for everyone in the input list, whether newly added
   * or pre-existing.
   */
  async addMany(appId: string, roomId: string, userIds: string[]): Promise<ParticipantRes[]> {
    await this.assertRoomExists(appId, roomId);
    const rows = userIds.map((userId) => ({ appId, roomId, userId, lastReadAt: null }));
    try {
      await this.participants.insertMany(rows, { ordered: false });
    } catch (e: unknown) {
      // Bulk insert with duplicates: ignore unique-key violations (code 11000), rethrow others.
      if (!isDuplicateKeyBulkError(e)) {
        throw e;
      }
    }
    const docs = await this.participants.find({ appId, roomId, userId: { $in: userIds } });
    return docs.map((d) => this.toRes(d));
  }

  async remove(appId: string, roomId: string, userId: string): Promise<void> {
    await this.assertRoomExists(appId, roomId);
    await this.participants.deleteOne({ appId, roomId, userId });
    // Removing a non-participant is a no-op — idempotent for retry safety.
  }

  async listForRoom(appId: string, roomId: string): Promise<ParticipantRes[]> {
    await this.assertRoomExists(appId, roomId);
    const docs = await this.participants.find({ appId, roomId });
    return docs.map((d) => this.toRes(d));
  }

  async listRoomIdsForUser(appId: string, userId: string): Promise<string[]> {
    const docs = await this.participants
      .find({ appId, userId }, { roomId: 1 })
      .lean<{ roomId: Types.ObjectId }[]>();
    return docs.map((d) => d.roomId.toString());
  }

  async isParticipant(appId: string, roomId: string, userId: string): Promise<boolean> {
    const count = await this.participants.countDocuments({ appId, roomId, userId });
    return count > 0;
  }

  async markRead(appId: string, roomId: string, userId: string, at: Date): Promise<void> {
    await this.participants.updateOne(
      { appId, roomId, userId },
      { $set: { lastReadAt: at } },
    );
  }

  private async assertRoomExists(appId: string, roomId: string): Promise<void> {
    const exists = await this.rooms.exists({ _id: roomId, appId, deleted: false });
    if (!exists) {
      throw new ApiException(ExcKey.ROOM_NOT_FOUND, 'Room not found', HttpStatus.NOT_FOUND);
    }
  }

  private toRes(doc: ParticipantDocument): ParticipantRes {
    return {
      appId: doc.appId.toString(),
      roomId: doc.roomId.toString(),
      userId: doc.userId.toString(),
      joinedAt: doc.joinedAt.toISOString(),
      lastReadAt: doc.lastReadAt ? doc.lastReadAt.toISOString() : null,
    };
  }
}

interface MongoBulkWriteError {
  writeErrors?: { code?: number }[];
  code?: number;
}

function isDuplicateKeyBulkError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const err = e as MongoBulkWriteError;
  if (err.code === 11000) return true;
  if (Array.isArray(err.writeErrors)) {
    return err.writeErrors.every((w) => w.code === 11000);
  }
  return false;
}
