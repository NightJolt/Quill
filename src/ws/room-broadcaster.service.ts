import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';
import { roomChannel } from './ws-events';

/**
 * Bridges non-WS code paths (HTTP `/internal` controllers) to Socket.IO
 * fan-out. The gateway binds the live `Server` here in `afterInit`; any
 * service can then inject this and emit to a room channel **without** depending
 * on `ChatGateway` directly — injecting the gateway (or the raw `Server`) into
 * `MessageService` would invert the `WsModule → MessageModule` import and
 * create a circular dependency. A standalone leaf service sidesteps that: both
 * `WsModule` and `MessageModule` import `BroadcastModule` and share the one
 * singleton.
 *
 * Single-instance only — `server.to(...)` is process-local. Revisit with the
 * deferred Redis adapter for multi-instance deployments.
 */
@Injectable()
export class RoomBroadcaster {
  private server: Server | null = null;

  /** Called once by the gateway in `afterInit`. */
  bind(server: Server): void {
    this.server = server;
  }

  /** Fan out an event to everyone subscribed to `(appId, roomId)`. No-op until bound. */
  emit(appId: string, roomId: string, event: string, payload: unknown): void {
    this.server?.to(roomChannel(appId, roomId)).emit(event, payload);
  }
}
