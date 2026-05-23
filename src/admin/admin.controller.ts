import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminTokenGuard } from '@/auth/admin-token.guard';
import { AppRegistry } from '@/auth/app-registry.service';
import { ConnectionRegistry } from '@/ws/connection-registry.service';
import { ObjectIdPipe } from '@/common/pipes/object-id.pipe';
import { ApiException, ExcKey } from '@/common/exceptions/api.exception';
import { AppRes, RegisterAppReq, RegisterAppRes, RotateKeyRes } from './admin.dto';

/**
 * Admin endpoints — single bearer token from env (`QUILL_ADMIN_TOKEN`).
 * Mutations (register / unregister / rotate) invalidate cached identity:
 * unregister + rotate disconnect every open socket for the affected appId
 * so old signatures stop working immediately.
 */
@ApiTags('Admin — Apps')
@ApiBearerAuth('admin')
@Controller('admin/apps')
@UseGuards(AdminTokenGuard)
export class AdminController {
  constructor(
    private readonly registry: AppRegistry,
    private readonly connections: ConnectionRegistry,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all registered apps (no keys)' })
  async list(): Promise<AppRes[]> {
    const apps = await this.registry.list();
    return apps.map((a) => ({
      appId: a.appId,
      label: a.label,
      createdAt: a.createdAt.toISOString(),
      rotatedAt: a.rotatedAt ? a.rotatedAt.toISOString() : null,
      revoked: a.revoked,
    }));
  }

  @Post()
  @ApiOperation({
    summary: 'Register a new app',
    description:
      'Returns the plaintext `privateKey` ONCE. Capture and store immediately — Quill keeps only the encrypted form.',
  })
  async register(@Body() req: RegisterAppReq): Promise<RegisterAppRes> {
    try {
      return await this.registry.register(req.label);
    } catch (err: unknown) {
      if (isDuplicateKey(err)) {
        throw new ApiException(
          ExcKey.UNHANDLED,
          `label "${req.label}" is already taken`,
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }

  @Post(':appId/rotate')
  @ApiOperation({
    summary: 'Rotate an app\'s private key',
    description:
      'Generates a new key, disconnects all live Socket.IO sessions for this app, returns the new plaintext key ONCE. Old key + old signatures stop working immediately.',
  })
  async rotate(@Param('appId', ObjectIdPipe) appId: string): Promise<RotateKeyRes> {
    const result = await this.registry.rotate(appId);
    if (!result) {
      throw new ApiException(ExcKey.UNHANDLED, 'App not found or already revoked', HttpStatus.NOT_FOUND);
    }
    // Rotating revokes all existing signatures — kick open sockets so
    // clients reconnect with a fresh signature.
    this.connections.disconnectAllForApp(appId);
    return result;
  }

  @Delete(':appId')
  @ApiOperation({
    summary: 'Revoke an app (soft delete)',
    description:
      'Sets revoked=true, drops the cache entry, disconnects all live sessions. The chat_apps row stays for audit; rooms/messages remain in the DB but cannot be authenticated against.',
  })
  async unregister(@Param('appId', ObjectIdPipe) appId: string): Promise<{ success: true }> {
    const revoked = await this.registry.unregister(appId);
    if (!revoked) {
      throw new ApiException(ExcKey.UNHANDLED, 'App not found or already revoked', HttpStatus.NOT_FOUND);
    }
    this.connections.disconnectAllForApp(appId);
    return { success: true };
  }
}

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: number }).code === 11000
  );
}
