import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Room, RoomSchema } from './room.schema';
import { RoomRepository } from './room.repository';
import { RoomService } from './room.service';
import { RoomController } from './room.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: Room.name, schema: RoomSchema }])],
  controllers: [RoomController],
  providers: [RoomService, RoomRepository],
  // Both exported: ParticipantService injects RoomRepository for its room-
  // existence assertion; future modules can choose either layer.
  exports: [RoomService, RoomRepository],
})
export class RoomModule {}
