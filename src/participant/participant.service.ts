import { HttpStatus, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { ParticipantRepository } from './participant.repository';
import { ParticipantDocument } from './participant.schema';
import { RoomRepository } from '../room/room.repository';
import { ApiException, ExcKey } from '../common/exceptions/api.exception';
import { ParticipantRes } from './participant.dto';

@Injectable()
export class ParticipantService {
  constructor(
    private readonly repo: ParticipantRepository,
    private readonly rooms: RoomRepository,
  ) {}

  async addMany(appId: string, roomId: string, userIds: string[]): Promise<ParticipantRes[]> {
    await this.assertRoomExists(appId, roomId);
    const docs = await this.repo.addMany(appId, roomId, userIds);
    return docs.map((d) => this.toRes(d));
  }

  async remove(appId: string, roomId: string, userId: string): Promise<void> {
    await this.assertRoomExists(appId, roomId);
    await this.repo.remove(appId, roomId, userId);
  }

  async listForRoom(appId: string, roomId: string): Promise<ParticipantRes[]> {
    await this.assertRoomExists(appId, roomId);
    const docs = await this.repo.findByRoom(appId, roomId);
    return docs.map((d) => this.toRes(d));
  }

  /** Roster for a user-facing caller — only participants may see the roster. */
  async listForRoomAsUser(
    appId: string,
    roomId: string,
    callerId: string,
  ): Promise<ParticipantRes[]> {
    const ok = await this.repo.exists(appId, roomId, callerId);
    if (!ok) {
      throw new ApiException(
        ExcKey.NOT_A_PARTICIPANT,
        'You are not a participant of this room',
        HttpStatus.FORBIDDEN,
      );
    }
    return this.listForRoom(appId, roomId);
  }

  isParticipant(appId: string, roomId: string, userId: string): Promise<boolean> {
    return this.repo.exists(appId, roomId, userId);
  }

  markRead(appId: string, roomId: string, userId: string, at: Date): Promise<void> {
    return this.repo.markRead(appId, roomId, userId, at);
  }

  private async assertRoomExists(appId: string, roomId: string): Promise<void> {
    const exists = await this.rooms.existsActive(appId, roomId);
    if (!exists) {
      throw new ApiException(ExcKey.ROOM_NOT_FOUND, 'Room not found', HttpStatus.NOT_FOUND);
    }
  }

  private toRes(doc: ParticipantDocument): ParticipantRes {
    // appId + roomId are implicit (caller's credential + URL path).
    return plainToInstance(ParticipantRes, {
      userId: doc.userId,
      joinedAt: doc.joinedAt,
      lastReadAt: doc.lastReadAt,
    });
  }
}
