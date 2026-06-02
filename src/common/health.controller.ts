import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  /** Liveness probe. */
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
