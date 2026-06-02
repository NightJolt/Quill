import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { SignatureGuard } from '@/auth/signature.guard';
import { UserCtx } from '@/auth/decorators';
import type { UserContext } from '@/auth/app-context';
import { ObjectIdPipe } from '@/common/pipes/object-id.pipe';
import { MessageService } from './message.service';
import type { MessageRes } from './message.dto';

/**
 * User-facing REST for message history. Authenticated via the same signature
 * scheme as the WS handshake — three headers, validated by SignatureGuard.
 *
 * The WS gateway streams new messages live; this endpoint hydrates the
 * backlog (initial load + scroll-up pagination + missed-message backfill
 * after a WS reconnect).
 *
 * Business logic (`before` parsing, participation check) lives in
 * `MessageService.history`. This file is pure HTTP-shape wiring.
 */
@ApiTags('Messages')
@ApiSecurity('quill-app-id')
@ApiSecurity('quill-user-id')
@ApiSecurity('quill-signature')
@Controller('rooms')
@UseGuards(SignatureGuard)
export class MessageController {
  constructor(private readonly messages: MessageService) {}

  /**
   * Paginated message history for a room. One direction per call:
   *   - `before=<ISO>` → messages older than that, newest-first (scroll-up).
   *   - `after=<ISO>`  → messages newer than that, oldest-first (reconnect /
   *     missed-message backfill).
   * Pass the `createdAt` of your boundary message; both bounds are exclusive.
   * Supplying both is a 400. Max limit 100, default 50.
   */
  @Get(':roomId/messages')
  history(
    @UserCtx() user: UserContext,
    @Param('roomId', ObjectIdPipe) roomId: string,
    @Query('before') before?: string,
    @Query('after') after?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ): Promise<MessageRes[]> {
    return this.messages.history(user.appId, roomId, user.userId, before, after, limit ?? 50);
  }
}
