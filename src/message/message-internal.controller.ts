import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Param,
  ParseBoolPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InternalKeyGuard } from '@/auth/internal-key.guard';
import { AppCtx } from '@/auth/decorators';
import type { AppContext } from '@/auth/app-context';
import { ObjectIdPipe } from '@/common/pipes/object-id.pipe';
import { MessageService } from './message.service';
import { EditMessageInternalReq } from './message.dto';
import type { MessageRes } from './message.dto';

/**
 * Trusted moderation surface for messages — Bearer the app's private key, same
 * as the room/participant internal controllers. The calling app (urbancare
 * monolith) is the policy decision point: it has already authorized the actor
 * (own message on `/api`, apartment manager on `/manager`) before calling here.
 *
 * Quill remains the enforcement point for *ownership* (it holds `senderId`):
 *   - edit is always self-service — `actorId` must equal the sender.
 *   - delete honours `allowAnySender=true` (manager override) but otherwise
 *     also requires `actorId === senderId`, so a bug on the caller can't
 *     silently delete arbitrary messages.
 *
 * Both ops are scoped by the room id in the path, so a caller can only reach
 * messages inside the room it named.
 */
@ApiTags('Internal — Messages')
@ApiBearerAuth('appKey')
@Controller('internal/rooms/:roomId/messages')
@UseGuards(InternalKeyGuard)
export class MessageInternalController {
  constructor(private readonly messages: MessageService) {}

  /** Edit a message's text (self-service; `actorId` must own it). */
  @Patch(':messageId')
  edit(
    @AppCtx() ctx: AppContext,
    @Param('roomId', ObjectIdPipe) roomId: string,
    @Param('messageId', ObjectIdPipe) messageId: string,
    @Body() req: EditMessageInternalReq,
  ): Promise<MessageRes> {
    return this.messages.edit(ctx.appId, roomId, messageId, req.actorId, req.content);
  }

  /**
   * Soft-delete a message. `allowAnySender=true` is the manager override
   * (only ever set by the caller's `/manager` route); default false keeps it
   * self-service.
   */
  @Delete(':messageId')
  async remove(
    @AppCtx() ctx: AppContext,
    @Param('roomId', ObjectIdPipe) roomId: string,
    @Param('messageId', ObjectIdPipe) messageId: string,
    @Query('actorId', ObjectIdPipe) actorId: string,
    @Query('allowAnySender', new DefaultValuePipe(false), ParseBoolPipe) allowAnySender: boolean,
  ): Promise<{ success: true }> {
    await this.messages.remove(ctx.appId, roomId, messageId, actorId, allowAnySender);
    return { success: true };
  }
}
