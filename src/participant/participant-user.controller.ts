import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { SignatureGuard } from '../auth/signature.guard';
import { UserCtx } from '../auth/decorators';
import type { UserContext } from '../auth/app-context';
import { ObjectIdPipe } from '../common/pipes/object-id.pipe';
import { ParticipantService } from './participant.service';
import { ParticipantRes } from './participant.dto';

/**
 * User-facing read access to a room's roster. Same signature auth as message
 * history; gated on the caller being a participant of the room.
 *
 * Clients need this for read receipts / unread state: `lastReadAt` is the
 * per-participant watermark the `read` WS event advances, and without this
 * endpoint a freshly loaded client has no way to hydrate it (the internal
 * participants endpoint requires the app private key).
 */
@ApiTags('Participants')
@ApiSecurity('quill-app-id')
@ApiSecurity('quill-user-id')
@ApiSecurity('quill-signature')
@Controller('rooms/:roomId/participants')
@UseGuards(SignatureGuard)
export class ParticipantUserController {
  constructor(private readonly participants: ParticipantService) {}

  /** List a room's participants with their read watermarks (participants only). */
  @Get()
  list(
    @UserCtx() user: UserContext,
    @Param('roomId', ObjectIdPipe) roomId: string,
  ): Promise<ParticipantRes[]> {
    return this.participants.listForRoomAsUser(user.appId, roomId, user.userId);
  }
}
