import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminTokenGuard } from '@/auth/admin-token.guard';
import { ObjectIdPipe } from '@/common/pipes/object-id.pipe';
import { AdminAppService } from './admin-app.service';
import { AppRes, RegisterAppReq, RegisterAppRes, RotateKeyRes } from './admin.dto';

/**
 * Admin endpoints — single bearer token from env (`QUILL_ADMIN_TOKEN`).
 * All business logic (DB error translation, not-found semantics, socket
 * invalidation on revoke/rotate) lives in `AdminAppService`. This file is
 * pure HTTP-shape wiring.
 */
@ApiTags('Admin — Apps')
@ApiBearerAuth('admin')
@Controller('admin/apps')
@UseGuards(AdminTokenGuard)
export class AdminController {
  constructor(private readonly app: AdminAppService) {}

  /** List all registered apps (no keys). */
  @Get()
  list(): Promise<AppRes[]> {
    return this.app.list();
  }

  /**
   * Register a new app. Returns the plaintext `privateKey` ONCE — capture
   * and store immediately; Quill keeps only the encrypted form.
   */
  @Post()
  register(@Body() req: RegisterAppReq): Promise<RegisterAppRes> {
    return this.app.register(req.label);
  }

  /**
   * Rotate an app's private key. Generates a new key, disconnects all live
   * Socket.IO sessions for this app, returns the new plaintext key ONCE.
   * Old key + old signatures stop working immediately.
   */
  @Post(':appId/rotate')
  rotate(@Param('appId', ObjectIdPipe) appId: string): Promise<RotateKeyRes> {
    return this.app.rotate(appId);
  }

  /**
   * Revoke an app (soft delete). Sets revoked=true, drops the cache entry,
   * disconnects all live sessions. The chat_apps row stays for audit;
   * rooms/messages remain in the DB but cannot be authenticated against.
   */
  @Delete(':appId')
  async unregister(@Param('appId', ObjectIdPipe) appId: string): Promise<{ success: true }> {
    await this.app.unregister(appId);
    return { success: true };
  }
}
