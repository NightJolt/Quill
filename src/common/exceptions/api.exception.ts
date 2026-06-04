import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * App-level error with a stable string `key` clients can switch on, alongside
 * a human-readable message. Mirrors the monolith's `ApiException` shape so
 * cross-service error handling stays consistent.
 *
 * Throw this from services; ApiExceptionFilter renders the wire shape.
 */
export class ApiException extends HttpException {
  constructor(
    public readonly key: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly data?: Record<string, unknown>,
  ) {
    super({ key, message, code: status, data }, status);
  }
}

export const ExcKey = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  NOT_A_PARTICIPANT: 'NOT_A_PARTICIPANT',
  ALREADY_A_PARTICIPANT: 'ALREADY_A_PARTICIPANT',
  MESSAGE_NOT_FOUND: 'MESSAGE_NOT_FOUND',
  MESSAGE_DELETED: 'MESSAGE_DELETED',
  EMPTY_MESSAGE: 'EMPTY_MESSAGE',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  UNKNOWN_APP: 'UNKNOWN_APP',
  UNHANDLED: 'UNHANDLED',
} as const;
export type ExcKey = (typeof ExcKey)[keyof typeof ExcKey];
