import { Module } from '@nestjs/common';
import { RoomBroadcaster } from './room-broadcaster.service';

/**
 * Provides the single shared {@link RoomBroadcaster}. Imported by both
 * `WsModule` (the gateway binds the Socket.IO server into it) and
 * `MessageModule` (services emit through it) — kept as its own leaf module so
 * neither has to import the other.
 */
@Module({
  providers: [RoomBroadcaster],
  exports: [RoomBroadcaster],
})
export class BroadcastModule {}
