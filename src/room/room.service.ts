import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { InjectConnection } from '@nestjs/mongoose';
import { Room, RoomDocument } from './room.schema';
import { Participant } from '../participant/participant.schema';
import { ApiException, ExcKey } from '../common/exceptions/api.exception';
import { CreateRoomReq, RoomRes } from './room.dto';

@Injectable()
export class RoomService {
  constructor(
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(Participant.name) private readonly participants: Model<Participant>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * Create a room scoped to `appId` and seed it with the creator + any
   * initialParticipants. The set is deduped — `createdBy` is always included
   * exactly once. All writes happen in a single Mongo session for atomicity.
   */
  async create(appId: string, req: CreateRoomReq): Promise<RoomRes> {
    const participantIds = new Set<string>([req.createdBy, ...(req.initialParticipants ?? [])]);
    const session = await this.connection.startSession();
    try {
      let room!: RoomDocument;
      await session.withTransaction(async () => {
        const [created] = await this.rooms.create(
          [{ appId, name: req.name, createdBy: req.createdBy }],
          { session },
        );
        room = created;
        const rows = [...participantIds].map((userId) => ({
          appId,
          roomId: room.id,
          userId,
          lastReadAt: null,
        }));
        if (rows.length > 0) {
          await this.participants.insertMany(rows, { session });
        }
      });
      return this.toRes(room);
    } finally {
      await session.endSession();
    }
  }

  async getById(appId: string, id: string): Promise<RoomRes> {
    const room = await this.rooms.findOne({ _id: id, appId, deleted: false });
    if (!room) {
      throw new ApiException(ExcKey.ROOM_NOT_FOUND, 'Room not found', HttpStatus.NOT_FOUND);
    }
    return this.toRes(room);
  }

  async softDelete(appId: string, id: string): Promise<void> {
    const result = await this.rooms.updateOne(
      { _id: id, appId, deleted: false },
      { $set: { deleted: true } },
    );
    if (result.matchedCount === 0) {
      throw new ApiException(ExcKey.ROOM_NOT_FOUND, 'Room not found', HttpStatus.NOT_FOUND);
    }
  }

  private toRes(doc: RoomDocument): RoomRes {
    return {
      id: doc.id,
      appId: doc.appId.toString(),
      name: doc.name,
      createdBy: doc.createdBy.toString(),
      createdAt: doc.createdAt.toISOString(),
    };
  }
}
