import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiException, ExcKey } from './api.exception';

interface WireError {
  success: false;
  error: {
    key: string;
    message: string;
    code: number;
    data?: Record<string, unknown>;
  };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    if (exception instanceof ApiException) {
      res.status(exception.getStatus()).json(this.shape(exception));
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      // class-validator pipe errors arrive here with { message: string[], error, statusCode }
      const message =
        typeof body === 'object' && body !== null && 'message' in body
          ? Array.isArray((body as { message: unknown }).message)
            ? ((body as { message: string[] }).message.join('; ') as string)
            : String((body as { message: unknown }).message)
          : exception.message;
      res.status(status).json({
        success: false,
        error: { key: ExcKey.UNHANDLED, message, code: status },
      } satisfies WireError);
      return;
    }

    this.logger.error('Unhandled exception', exception as Error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        key: ExcKey.UNHANDLED,
        message: 'Internal server error',
        code: HttpStatus.INTERNAL_SERVER_ERROR,
      },
    } satisfies WireError);
  }

  private shape(e: ApiException): WireError {
    return {
      success: false,
      error: {
        key: e.key,
        message: e.message,
        code: e.getStatus(),
        data: e.data,
      },
    };
  }
}
