import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { ConnectionRegistry } from './connection-registry.service';
import { ParticipantModule } from '@/participant/participant.module';
import { MessageModule } from '@/message/message.module';
import { BroadcastModule } from './broadcast.module';

@Module({
  imports: [ParticipantModule, MessageModule, BroadcastModule],
  providers: [ChatGateway, ConnectionRegistry],
  exports: [ConnectionRegistry],
})
export class WsModule {}
