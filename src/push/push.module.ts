import { Module } from '@nestjs/common';
import { PushService } from './push.service';

/**
 * The outbound notify callback. A leaf module on purpose: {@link PushService}
 * depends on nothing but `AppRegistry` (which `AuthModule` provides globally),
 * so `WsModule` can import this without dragging in message/participant wiring
 * and without any import cycle.
 */
@Module({
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
