import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InternalKeyGuard } from '../auth/internal-key.guard';
import { AppCtx } from '../auth/decorators';
import type { AppContext } from '../auth/app-context';
import { ObjectIdPipe } from '../common/pipes/object-id.pipe';
import { ParticipantService } from './participant.service';
import { AddParticipantsReq, ParticipantRes } from './participant.dto';

/**
 * Internal endpoints for managing room membership. Same auth shape as the
 * room controller: Bearer the app's private key.
 */
@ApiTags('Internal — Participants')
@ApiBearerAuth('appKey')
@Controller('internal/rooms/:roomId/participants')
@UseGuards(InternalKeyGuard)
export class ParticipantController {
  constructor(private readonly participants: ParticipantService) {}

  @Post()
  @ApiOperation({ summary: 'Add users to a room (idempotent)' })
  add(
    @AppCtx() ctx: AppContext,
    @Param('roomId', ObjectIdPipe) roomId: string,
    @Body() req: AddParticipantsReq,
  ): Promise<ParticipantRes[]> {
    return this.participants.addMany(ctx.appId, roomId, req.userIds);
  }

  @Get()
  @ApiOperation({ summary: 'List participants of a room' })
  list(
    @AppCtx() ctx: AppContext,
    @Param('roomId', ObjectIdPipe) roomId: string,
  ): Promise<ParticipantRes[]> {
    return this.participants.listForRoom(ctx.appId, roomId);
  }

  @Delete(':userId')
  @ApiOperation({ summary: 'Remove a user from a room (idempotent)' })
  async remove(
    @AppCtx() ctx: AppContext,
    @Param('roomId', ObjectIdPipe) roomId: string,
    @Param('userId', ObjectIdPipe) userId: string,
  ): Promise<{ success: true }> {
    await this.participants.remove(ctx.appId, roomId, userId);
    return { success: true };
  }
}
