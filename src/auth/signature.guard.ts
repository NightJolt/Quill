import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AppRegistry } from './app-registry.service';
import { verifySignature } from './signature';
import { ApiException, ExcKey } from '@/common/exceptions/api.exception';
import { isObjectId } from '@/common/utils/object-id';

/**
 * Authenticates user-facing REST endpoints (history pagination, etc.) with
 * the same `HMAC-SHA256(userId, app_privateKey)` signature scheme the WS
 * handshake uses.
 *
 * Header shape (three discrete headers — easier to inspect in network tab
 * and to wire up in Swagger than a packed Bearer):
 *
 *   X-Quill-App-Id:     <24-char hex appId>
 *   X-Quill-User-Id:    <24-char hex userId>
 *   X-Quill-Signature:  <64-char hex signature = HMAC-SHA256(userId, app_privateKey)>
 *
 * The consuming app's backend mints these for its frontend (same trio it
 * passes into the Socket.IO handshake `auth` payload). Frontend just
 * forwards them as headers on each REST call.
 *
 * On success, attaches `request.userContext = { appId, userId }`.
 */
@Injectable()
export class SignatureGuard implements CanActivate {
  static readonly APP_ID_HEADER = 'x-quill-app-id';
  static readonly USER_ID_HEADER = 'x-quill-user-id';
  static readonly SIGNATURE_HEADER = 'x-quill-signature';

  constructor(private readonly registry: AppRegistry) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const appId = readHeader(req, SignatureGuard.APP_ID_HEADER);
    const userId = readHeader(req, SignatureGuard.USER_ID_HEADER);
    const signature = readHeader(req, SignatureGuard.SIGNATURE_HEADER);

    if (!appId || !userId || !signature) {
      throw new ApiException(
        ExcKey.UNAUTHORIZED,
        'Missing X-Quill-App-Id / X-Quill-User-Id / X-Quill-Signature header',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (!isObjectId(appId) || !isObjectId(userId)) {
      throw new ApiException(
        ExcKey.UNAUTHORIZED,
        'appId and userId must be 24-char hex ObjectIds',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const key = this.registry.getKey(appId);
    if (!key) {
      throw new ApiException(ExcKey.UNAUTHORIZED, 'Unknown appId', HttpStatus.UNAUTHORIZED);
    }
    if (!verifySignature(userId, key, signature)) {
      throw new ApiException(
        ExcKey.INVALID_SIGNATURE,
        'Invalid signature',
        HttpStatus.UNAUTHORIZED,
      );
    }

    req.userContext = { appId, userId };
    return true;
  }
}

function readHeader(req: Request, name: string): string | null {
  const v = req.headers[name];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0) return v[0];
  return null;
}
