import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { Socket } from 'socket.io';
import type { AppContext, UserContext } from './app-context';

/**
 * Injects the `AppContext` attached by InternalKeyGuard.
 *
 *   @Post(...) foo(@AppCtx() ctx: AppContext) { ... }
 */
export const AppCtx = createParamDecorator((_data: unknown, ctx: ExecutionContext): AppContext => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.appContext) {
    throw new Error('AppContext missing — is InternalKeyGuard applied to this route?');
  }
  return req.appContext;
});

/**
 * Injects the `UserContext` attached by ChatGateway.handleConnection
 * (Socket.IO clients).
 *
 *   @SubscribeMessage(...) onSend(@WsUser() user: UserContext, @MessageBody() body: ...) { ... }
 */
export const WsUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): UserContext => {
  const client = ctx.switchToWs().getClient<Socket>();
  const { appId, userId } = client.data ?? {};
  if (!appId || !userId) {
    throw new Error('UserContext missing — handshake auth never completed');
  }
  return { appId, userId };
});

/**
 * Injects the `UserContext` attached by SignatureGuard on user-facing REST
 * endpoints.
 *
 *   @Get(...) history(@UserCtx() user: UserContext, ...) { ... }
 */
export const UserCtx = createParamDecorator((_data: unknown, ctx: ExecutionContext): UserContext => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.userContext) {
    throw new Error('UserContext missing — is SignatureGuard applied to this route?');
  }
  return req.userContext;
});
