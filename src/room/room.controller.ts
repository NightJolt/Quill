import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InternalKeyGuard } from '../auth/internal-key.guard';
import { AppCtx } from '../auth/decorators';
import type { AppContext } from '../auth/app-context';
import { ObjectIdPipe } from '../common/pipes/object-id.pipe';
import { RoomService } from './room.service';
import { CreateRoomReq, RoomRes } from './room.dto';

/**
 * Internal admin endpoints — called by app backends (urbancare monolith, etc.)
 * authenticated with their app's private key. Never exposed to end users.
 *
 * Routes do not include `appId` in the URL — it's derived from the credential
 * via InternalKeyGuard and injected with @AppCtx().
 */
@ApiTags('Internal — Rooms')
@ApiBearerAuth('appKey')
@Controller('internal/rooms')
@UseGuards(InternalKeyGuard)
export class RoomController {
  constructor(private readonly rooms: RoomService) {}

  @Post()
  @ApiOperation({ summary: 'Create a room (with optional initial participants)' })
  create(@AppCtx() ctx: AppContext, @Body() req: CreateRoomReq): Promise<RoomRes> {
    return this.rooms.create(ctx.appId, req);
  }

  @Get(':roomId')
  @ApiOperation({ summary: 'Get one room by id' })
  get(
    @AppCtx() ctx: AppContext,
    @Param('roomId', ObjectIdPipe) roomId: string,
  ): Promise<RoomRes> {
    return this.rooms.getById(ctx.appId, roomId);
  }

  @Delete(':roomId')
  @ApiOperation({ summary: 'Soft-delete a room' })
  async delete(
    @AppCtx() ctx: AppContext,
    @Param('roomId', ObjectIdPipe) roomId: string,
  ): Promise<{ success: true }> {
    await this.rooms.softDelete(ctx.appId, roomId);
    return { success: true };
  }
}
