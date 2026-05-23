import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { ConnectionRegistry } from './connection-registry.service';
import { ParticipantModule } from '../participant/participant.module';
import { MessageModule } from '../message/message.module';

@Module({
  imports: [ParticipantModule, MessageModule],
  providers: [ChatGateway, ConnectionRegistry],
  exports: [ConnectionRegistry],
})
export class WsModule {}
