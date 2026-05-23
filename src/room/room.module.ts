import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Room, RoomSchema } from './room.schema';
import { Participant, ParticipantSchema } from '../participant/participant.schema';
import { RoomService } from './room.service';
import { RoomController } from './room.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Room.name, schema: RoomSchema },
      { name: Participant.name, schema: ParticipantSchema },
    ]),
  ],
  controllers: [RoomController],
  providers: [RoomService],
  exports: [RoomService],
})
export class RoomModule {}
