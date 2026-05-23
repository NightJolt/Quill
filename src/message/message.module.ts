import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Message, MessageSchema } from './message.schema';
import { MessageService } from './message.service';
import { ParticipantModule } from '../participant/participant.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Message.name, schema: MessageSchema }]),
    ParticipantModule,
  ],
  providers: [MessageService],
  exports: [MessageService],
})
export class MessageModule {}
