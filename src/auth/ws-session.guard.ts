import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';
import { AppRegistry } from './app-registry.service';
import { verifySignature } from './signature';

/**
 * Authenticates a Socket.IO connection at the message-handler level (used as
 * a guard on @SubscribeMessage handlers). The actual handshake validation
 * happens in `ChatGateway.handleConnection`; this guard double-checks the
 * context is still attached (defensive) before each message handler runs.
 *
 * Handshake auth shape (Socket.IO `auth` field):
 *   { appId: string, userId: string, signature: string }
 * where signature = HMAC-SHA256(userId, app_private_key) — see signature.ts.
 *
 * On success, the socket already has `socket.data.userId` and
 * `socket.data.appId` set by handleConnection.
 */
@Injectable()
export class WsSessionGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const client = ctx.switchToWs().getClient<Socket>();
    return Boolean(client.data?.userId && client.data?.appId);
  }
}

/**
 * Standalone helper invoked from `ChatGateway.handleConnection` to do the
 * actual signature check. Lives here so the verification logic is colocated
 * with the guard for the same auth shape.
 */
export interface WsHandshakeAuth {
  appId?: string;
  userId?: string;
  signature?: string;
}

export interface WsAuthResult {
  ok: boolean;
  appId?: string;
  userId?: string;
  reason?: string;
}

const OBJECT_ID = /^[a-fA-F0-9]{24}$/;

export function verifyWsHandshake(
  registry: AppRegistry,
  auth: WsHandshakeAuth,
): WsAuthResult {
  const { appId, userId, signature } = auth;
  if (!appId || !userId || !signature) {
    return { ok: false, reason: 'Missing appId/userId/signature' };
  }
  if (!OBJECT_ID.test(userId)) {
    // Quill requires 24-char hex userIds (mirrors the schema's ObjectId
    // typing). Rejecting at handshake stops downstream CastErrors before
    // they ever happen.
    return { ok: false, reason: 'userId must be a 24-char hex ObjectId' };
  }
  if (!OBJECT_ID.test(appId)) {
    return { ok: false, reason: 'appId must be a 24-char hex ObjectId' };
  }
  const key = registry.getKey(appId);
  if (!key) {
    return { ok: false, reason: 'Unknown appId' };
  }
  if (!verifySignature(userId, key, signature)) {
    return { ok: false, reason: 'Invalid signature' };
  }
  return { ok: true, appId, userId };
}
