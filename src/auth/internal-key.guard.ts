import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AppRegistry } from './app-registry.service';
import { ApiException, ExcKey } from '../common/exceptions/api.exception';
import { HttpStatus } from '@nestjs/common';

/**
 * Authenticates app-backend → Quill calls.
 *
 * Header shape: `Authorization: Bearer <app private key>`.
 *
 * On success, attaches `request.appContext = { appId }` so downstream
 * controllers can scope queries.
 */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  constructor(private readonly registry: AppRegistry) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new ApiException(ExcKey.UNAUTHORIZED, 'Missing Bearer credentials', HttpStatus.UNAUTHORIZED);
    }
    const key = header.slice('Bearer '.length).trim();
    const appId = this.registry.findAppByKey(key);
    if (!appId) {
      throw new ApiException(ExcKey.UNAUTHORIZED, 'Invalid app key', HttpStatus.UNAUTHORIZED);
    }
    req.appContext = { appId };
    return true;
  }
}
