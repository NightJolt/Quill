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
import type { MessageRes, MessageWindowRes } from './message.dto';

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

  /**
   * A window of history centred on one message — the "jump to a message I
   * haven't loaded" read (tapping a reply quote whose original is far up, or
   * opening chat from a notification deep link).
   *
   * `limitBefore` / `limitAfter` are **counts**, not cursors: on
   * {@link history} the words `before`/`after` mean ISO timestamps, so these
   * deliberately carry different names. Each defaults to 25 and is clamped to
   * 50, so the window is at most 101 messages. Response is ascending and
   * always includes the target; `hasMoreBefore` / `hasMoreAfter` say whether
   * history continues past each edge.
   *
   * **Declaration order is load-bearing.** This route must stay above
   * `:messageId` below — Express matches in registration order, and the
   * broader pattern would otherwise swallow this one and hand `ObjectIdPipe`
   * the literal string `around`, which is a 400.
   */
  @Get(':roomId/messages/around/:messageId')
  around(
    @UserCtx() user: UserContext,
    @Param('roomId', ObjectIdPipe) roomId: string,
    @Param('messageId', ObjectIdPipe) messageId: string,
    @Query('limitBefore', new DefaultValuePipe(25), ParseIntPipe) limitBefore: number,
    @Query('limitAfter', new DefaultValuePipe(25), ParseIntPipe) limitAfter: number,
  ): Promise<MessageWindowRes> {
    return this.messages.getAround(
      user.appId,
      roomId,
      user.userId,
      messageId,
      limitBefore,
      limitAfter,
    );
  }

  /**
   * A single message by id, in the same `MessageRes` shape history returns.
   * 404 when it doesn't exist *or* belongs to another room/tenant — the lookup
   * is pinned to `(appId, roomId)`, so an id from elsewhere simply isn't
   * visible from here.
   */
  @Get(':roomId/messages/:messageId')
  getOne(
    @UserCtx() user: UserContext,
    @Param('roomId', ObjectIdPipe) roomId: string,
    @Param('messageId', ObjectIdPipe) messageId: string,
  ): Promise<MessageRes> {
    return this.messages.getOne(user.appId, roomId, user.userId, messageId);
  }
}
