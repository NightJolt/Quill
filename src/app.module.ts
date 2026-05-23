import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { QuillConfigModule } from './common/config/config.module';
import { QuillConfig } from './common/config/quill-config';
import { HealthController } from './common/health.controller';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { RoomModule } from './room/room.module';
import { ParticipantModule } from './participant/participant.module';
import { MessageModule } from './message/message.module';
import { WsModule } from './ws/ws.module';

@Module({
  imports: [
    QuillConfigModule,
    MongooseModule.forRootAsync({
      useFactory: (config: QuillConfig) => ({ uri: config.mongoUri }),
      inject: [QuillConfig],
    }),
    AuthModule,
    AdminModule,
    RoomModule,
    ParticipantModule,
    MessageModule,
    WsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
