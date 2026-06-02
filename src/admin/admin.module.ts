import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminAppService } from './admin-app.service';
import { WsModule } from '@/ws/ws.module';

@Module({
  imports: [WsModule],
  controllers: [AdminController],
  providers: [AdminAppService],
})
export class AdminModule {}
