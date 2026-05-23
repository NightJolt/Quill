import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { WsModule } from '@/ws/ws.module';

@Module({
  imports: [WsModule],
  controllers: [AdminController],
})
export class AdminModule {}
