import { Logger, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AppRegistry } from '@/auth/app-registry.service';
import { WsSessionGuard, verifyWsHandshake, type WsHandshakeAuth } from '../auth/ws-session.guard';
import { WsUser } from '@/auth/decorators';
import type { UserContext } from '@/auth/app-context';
import { ConnectionRegistry } from './connection-registry.service';
import { RoomBroadcaster } from './room-broadcaster.service';
import { ParticipantService } from '@/participant/participant.service';
import { MessageService } from '@/message/message.service';
import { LinkPreviewService } from '@/message/link-preview.service';
import { ApiException } from '@/common/exceptions/api.exception';
import {
  MessageEvt,
  ReactAck,
  ReactReq,
  ReadEvt,
  ReadReq,
  SendReq,
  SubscribeReq,
  TypingEvt,
  TypingReq,
  UnsubscribeReq,
  WsEvents,
  roomChannel,
} from './ws-events';

@WebSocketGateway({
  cors: { origin: '*', credentials: true },
})
// Nest's `app.useGlobalPipes(...)` reliably wires HTTP routes but not WS
// `@MessageBody()` parameters. Apply the same ValidationPipe explicitly so
// the class-validator decorators on SubscribeReq / SendReq / TypingReq /
// ReadReq actually run — without this, an authenticated client can send
// arbitrarily-shaped payloads (e.g. 50MB `content`) and they'd persist.
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly registry: AppRegistry,
    private readonly connections: ConnectionRegistry,
    private readonly participants: ParticipantService,
    private readonly messages: MessageService,
    private readonly broadcaster: RoomBroadcaster,
    private readonly linkPreviews: LinkPreviewService,
  ) {}

  /**
   * Wire handshake auth as Socket.IO middleware. Runs BEFORE the connection
   * is established, so a rejection surfaces as `connect_error` on the client
   * instead of `connect` + immediate `disconnect`. The middleware also
   * stamps `socket.data` with the verified identity for downstream handlers.
   */
  afterInit(server: Server): void {
    // Hand the live server to the broadcaster so HTTP `/internal` moderation
    // (edit/delete) can fan out over the same Socket.IO rooms.
    this.broadcaster.bind(server);
    server.use((socket: Socket, next) => {
      const result = verifyWsHandshake(this.registry, socket.handshake.auth as WsHandshakeAuth);
      if (!result.ok) {
        this.logger.warn(`Rejecting WS handshake: ${result.reason}`);
        next(new Error(result.reason ?? 'Unauthorized'));
        return;
      }
      socket.data.appId = result.appId;
      socket.data.userId = result.userId;
      next();
    });
  }

  handleConnection(client: Socket): void {
    const { appId, userId } = client.data ?? {};
    if (!appId || !userId) {
      // Middleware should have rejected — defensive only.
      client.disconnect(true);
      return;
    }
    this.connections.add(appId, userId, client);
    this.logger.log(`WS connected: app=${appId} user=${userId} sid=${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    const { appId, userId } = client.data ?? {};
    if (appId && userId) {
      this.connections.remove(appId, userId, client);
    }
  }

  @UseGuards(WsSessionGuard)
  @SubscribeMessage(WsEvents.SUBSCRIBE)
  async onSubscribe(
    @WsUser() user: UserContext,
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SubscribeReq,
  ): Promise<{ ok: boolean; reason?: string }> {
    const ok = await this.participants.isParticipant(user.appId, body.roomId, user.userId);
    if (!ok) return { ok: false, reason: 'not_a_participant' };
    await client.join(roomChannel(user.appId, body.roomId));
    return { ok: true };
  }

  @UseGuards(WsSessionGuard)
  @SubscribeMessage(WsEvents.UNSUBSCRIBE)
  async onUnsubscribe(
    @WsUser() user: UserContext,
    @ConnectedSocket() client: Socket,
    @MessageBody() body: UnsubscribeReq,
  ): Promise<{ ok: true }> {
    await client.leave(roomChannel(user.appId, body.roomId));
    return { ok: true };
  }

  @UseGuards(WsSessionGuard)
  @SubscribeMessage(WsEvents.SEND)
  async onSend(
    @WsUser() user: UserContext,
    @MessageBody() body: SendReq,
  ): Promise<{ messageId: string; createdAt: string }> {
    const sent = await this.messages.send(user.appId, body.roomId, user.userId, {
      content: body.content,
      attachments: body.attachments,
      metadata: body.metadata,
    });
    const evt: MessageEvt = {
      // body.roomId is the canonical routing key (MessageRes no longer
      // carries it — the field is implicit at the REST/WS path level).
      roomId: body.roomId,
      message: {
        id: sent.id,
        senderId: sent.senderId,
        content: sent.content,
        attachments: sent.attachments,
        metadata: sent.metadata,
        createdAt: sent.createdAt,
      },
      clientTempId: body.clientTempId,
    };
    this.server.to(roomChannel(user.appId, body.roomId)).emit(WsEvents.MESSAGE, evt);

    // Fire-and-forget: hydrate a link preview after the message is delivered.
    // Self-contained (never throws, never blocks the ack); emits its own
    // `message_update` if a preview is found.
    void this.linkPreviews.hydrate(user.appId, body.roomId, sent.id, sent.content);

    return { messageId: sent.id, createdAt: sent.createdAt };
  }

  @UseGuards(WsSessionGuard)
  @SubscribeMessage(WsEvents.TYPING)
  async onTyping(@WsUser() user: UserContext, @MessageBody() body: TypingReq): Promise<void> {
    const isParticipant = await this.participants.isParticipant(user.appId, body.roomId, user.userId);
    if (!isParticipant) return;
    const evt: TypingEvt = { roomId: body.roomId, userId: user.userId, isTyping: body.isTyping };
    this.server.to(roomChannel(user.appId, body.roomId)).emit(WsEvents.TYPING_EVT, evt);
  }

  @UseGuards(WsSessionGuard)
  @SubscribeMessage(WsEvents.READ)
  async onRead(@WsUser() user: UserContext, @MessageBody() body: ReadReq): Promise<void> {
    const isParticipant = await this.participants.isParticipant(user.appId, body.roomId, user.userId);
    if (!isParticipant) return;
    // `body.upTo` is already validated as an ISO 8601 string by the global
    // ValidationPipe (see ReadReq's @IsDateString); just parse to Date here.
    const at = new Date(body.upTo);
    await this.participants.markRead(user.appId, body.roomId, user.userId, at);
    const evt: ReadEvt = { roomId: body.roomId, userId: user.userId, lastReadAt: at.toISOString() };
    this.server.to(roomChannel(user.appId, body.roomId)).emit(WsEvents.READ_EVT, evt);
  }

  /**
   * Toggle the caller's reaction on a message. Unlike edit/delete — which are
   * app-private-key `/internal` routes because the calling app owns their
   * policy — a reaction's only policy is room participation, which Quill
   * enforces itself. So it rides the user's own WS session, no monolith hop.
   *
   * The service owns everything (participation check, emoji validation, the
   * atomic write and the `message_reaction` fan-out, following the edit/delete
   * precedent where the service broadcasts); this handler is pure wiring plus
   * the error→ack mapping.
   *
   * Errors resolve the ack rather than propagating, mirroring `onSubscribe`.
   * Rethrowing a non-`ApiException` is deliberate — a genuine bug should hit
   * Nest's logger, not be laundered into a business-looking `reason`.
   */
  @UseGuards(WsSessionGuard)
  @SubscribeMessage(WsEvents.REACT)
  async onReact(@WsUser() user: UserContext, @MessageBody() body: ReactReq): Promise<ReactAck> {
    try {
      const { emoji, reactions } = await this.messages.react(
        user.appId,
        body.roomId,
        body.messageId,
        user.userId,
        body.emoji,
      );
      return { ok: true, emoji, reactions };
    } catch (err) {
      if (err instanceof ApiException) {
        return { ok: false, reason: err.key, message: err.message };
      }
      throw err;
    }
  }
}
