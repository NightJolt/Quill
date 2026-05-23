import { Logger, UseGuards } from '@nestjs/common';
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
import { AppRegistry } from '../auth/app-registry.service';
import { WsSessionGuard, verifyWsHandshake, type WsHandshakeAuth } from '../auth/ws-session.guard';
import { WsUser } from '../auth/decorators';
import type { UserContext } from '../auth/app-context';
import { ConnectionRegistry } from './connection-registry.service';
import { ParticipantService } from '../participant/participant.service';
import { MessageService } from '../message/message.service';
import {
  MessageEvt,
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
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly registry: AppRegistry,
    private readonly connections: ConnectionRegistry,
    private readonly participants: ParticipantService,
    private readonly messages: MessageService,
  ) {}

  /**
   * Wire handshake auth as Socket.IO middleware. Runs BEFORE the connection
   * is established, so a rejection surfaces as `connect_error` on the client
   * instead of `connect` + immediate `disconnect`. The middleware also
   * stamps `socket.data` with the verified identity for downstream handlers.
   */
  afterInit(server: Server): void {
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
    });
    const evt: MessageEvt = {
      roomId: sent.roomId,
      message: {
        id: sent.id,
        senderId: sent.senderId,
        content: sent.content,
        attachments: sent.attachments,
        createdAt: sent.createdAt,
      },
      clientTempId: body.clientTempId,
    };
    this.server.to(roomChannel(user.appId, body.roomId)).emit(WsEvents.MESSAGE, evt);
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
    const at = new Date(body.upTo);
    if (Number.isNaN(at.getTime())) return;
    await this.participants.markRead(user.appId, body.roomId, user.userId, at);
    const evt: ReadEvt = { roomId: body.roomId, userId: user.userId, lastReadAt: at.toISOString() };
    this.server.to(roomChannel(user.appId, body.roomId)).emit(WsEvents.READ_EVT, evt);
  }
}
