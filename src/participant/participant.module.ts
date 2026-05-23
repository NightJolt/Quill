import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Participant, ParticipantSchema } from './participant.schema';
import { Room, RoomSchema } from '../room/room.schema';
import { ParticipantService } from './participant.service';
import { ParticipantController } from './participant.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Participant.name, schema: ParticipantSchema },
      { name: Room.name, schema: RoomSchema },
    ]),
  ],
  controllers: [ParticipantController],
  providers: [ParticipantService],
  exports: [ParticipantService],
})
export class ParticipantModule {}
