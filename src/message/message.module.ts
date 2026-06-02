import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Message, MessageSchema } from './message.schema';
import { MessageRepository } from './message.repository';
import { MessageService } from './message.service';
import { MessageController } from './message.controller';
import { ParticipantModule } from '../participant/participant.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Message.name, schema: MessageSchema }]),
    ParticipantModule, // for ParticipantRepository (isParticipant check)
  ],
  controllers: [MessageController],
  providers: [MessageService, MessageRepository],
  exports: [MessageService],
})
export class MessageModule {}
