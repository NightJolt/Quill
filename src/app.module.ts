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
      // dbName (QUILL_DB_NAME) overrides the database in the URI path when
      // set; undefined falls back to mongoose's default URI handling.
      useFactory: (config: QuillConfig) => ({
        uri: config.mongoUri,
        dbName: config.dbName,
      }),
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
