import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Participant, ParticipantSchema } from './participant.schema';
import { ParticipantRepository } from './participant.repository';
import { ParticipantService } from './participant.service';
import { ParticipantController } from './participant.controller';
import { RoomModule } from '../room/room.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Participant.name, schema: ParticipantSchema }]),
    RoomModule, // for RoomRepository (assertRoomExists)
  ],
  controllers: [ParticipantController],
  providers: [ParticipantService, ParticipantRepository],
  exports: [ParticipantService, ParticipantRepository],
})
export class ParticipantModule {}
