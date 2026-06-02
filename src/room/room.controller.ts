import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InternalKeyGuard } from '@/auth/internal-key.guard';
import { AppCtx } from '@/auth/decorators';
import type { AppContext } from '@/auth/app-context';
import { ObjectIdPipe } from '@/common/pipes/object-id.pipe';
import { RoomService } from './room.service';
import { PutRoomReq, RoomRes } from './room.dto';

@ApiTags('Internal — Rooms')
@ApiBearerAuth('appKey')
@Controller('internal/rooms')
@UseGuards(InternalKeyGuard)
export class RoomController {
  constructor(private readonly rooms: RoomService) {}

  /**
   * Idempotent upsert. Safe to call repeatedly for the same `roomId` —
   * existing rows are left alone (resurrected if soft-deleted, name updated
   * if supplied).
   */
  @Put(':roomId')
  upsert(
    @AppCtx() ctx: AppContext,
    @Param('roomId', ObjectIdPipe) roomId: string,
    @Body() req: PutRoomReq,
  ): Promise<RoomRes> {
    return this.rooms.upsert(ctx.appId, roomId, req);
  }

  /** Get one room by id. */
  @Get(':roomId')
  get(
    @AppCtx() ctx: AppContext,
    @Param('roomId', ObjectIdPipe) roomId: string,
  ): Promise<RoomRes> {
    return this.rooms.getById(ctx.appId, roomId);
  }

  /** Soft-delete a room. */
  @Delete(':roomId')
  async delete(
    @AppCtx() ctx: AppContext,
    @Param('roomId', ObjectIdPipe) roomId: string,
  ): Promise<{ success: true }> {
    await this.rooms.softDelete(ctx.appId, roomId);
    return { success: true };
  }
}
