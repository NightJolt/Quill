import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { REACTION_EMOJIS } from '@/message/reactions';

/** Wire constants a client needs before it has a session. */
export interface PublicConfigRes {
  /** The canonical reaction set, in canonical chip order. */
  reactions: string[];
}

/**
 * Unauthenticated, static, cache-friendly: the server-side constants both
 * clients must agree with. It exists so the two clients cannot silently drift
 * from the server's validation — a client can render its reaction row straight
 * from this list instead of hardcoding one that a future server change would
 * invalidate.
 *
 * Deliberately *not* on `/health` — that stays a bare liveness probe.
 *
 * No auth: the reaction set is a public UI constant, already visible in every
 * client bundle. Nothing tenant-specific belongs here; if a per-app setting is
 * ever needed it goes behind `SignatureGuard` on a different route.
 */
@ApiTags('Health')
@Controller('config')
export class PublicConfigController {
  @Get()
  config(): PublicConfigRes {
    return { reactions: [...REACTION_EMOJIS] };
  }
}
