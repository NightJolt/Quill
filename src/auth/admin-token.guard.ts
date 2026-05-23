import { CanActivate, ExecutionContext, HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { ApiException, ExcKey } from '@/common/exceptions/api.exception';
import { QuillConfig } from '@/common/config/quill-config';

/**
 * Authenticates /admin/** endpoints. Single bearer token from env
 * (`QUILL_ADMIN_TOKEN`); treat as root credentials.
 *
 * Comparison is constant-time to avoid leaking token bytes via timing.
 * Boot fails if the token isn't set — admin endpoints are not optional.
 */
@Injectable()
export class AdminTokenGuard implements CanActivate, OnModuleInit {
  private expected!: Buffer;

  constructor(private readonly config: QuillConfig) {}

  onModuleInit(): void {
    const token = this.config.adminToken;
    if (!token) {
      throw new Error(
        'QUILL_ADMIN_TOKEN env var is required for /admin endpoints. Generate with: ' +
          'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      );
    }
    this.expected = Buffer.from(token);
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new ApiException(ExcKey.UNAUTHORIZED, 'Missing Bearer credentials', HttpStatus.UNAUTHORIZED);
    }
    const provided = Buffer.from(header.slice('Bearer '.length).trim());
    if (provided.length !== this.expected.length) {
      throw new ApiException(ExcKey.UNAUTHORIZED, 'Invalid admin token', HttpStatus.UNAUTHORIZED);
    }
    if (!timingSafeEqual(provided, this.expected)) {
      throw new ApiException(ExcKey.UNAUTHORIZED, 'Invalid admin token', HttpStatus.UNAUTHORIZED);
    }
    return true;
  }
}
