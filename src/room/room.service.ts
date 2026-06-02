import { HttpStatus, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { RoomRepository } from './room.repository';
import { RoomDocument } from './room.schema';
import { ApiException, ExcKey } from '../common/exceptions/api.exception';
import { PutRoomReq, RoomRes } from './room.dto';

@Injectable()
export class RoomService {
  constructor(private readonly repo: RoomRepository) {}

  async upsert(appId: string, roomId: string, req: PutRoomReq): Promise<RoomRes> {
    const doc = await this.repo.upsert(appId, roomId, req.name);
    return this.toRes(doc);
  }

  async getById(appId: string, roomId: string): Promise<RoomRes> {
    const doc = await this.repo.findActive(appId, roomId);
    if (!doc) {
      throw new ApiException(ExcKey.ROOM_NOT_FOUND, 'Room not found', HttpStatus.NOT_FOUND);
    }
    return this.toRes(doc);
  }

  async softDelete(appId: string, roomId: string): Promise<void> {
    const ok = await this.repo.softDelete(appId, roomId);
    if (!ok) {
      throw new ApiException(ExcKey.ROOM_NOT_FOUND, 'Room not found', HttpStatus.NOT_FOUND);
    }
  }

  private toRes(doc: RoomDocument): RoomRes {
    return plainToInstance(RoomRes, {
      // The external id the caller supplied — NOT the internal `_id` surrogate.
      id: doc.roomId,
      name: doc.name,
      createdAt: doc.createdAt,
    });
  }
}
