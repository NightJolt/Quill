import { ArgumentMetadata, HttpStatus, Injectable, PipeTransform } from '@nestjs/common';
import { ApiException, ExcKey } from '../exceptions/api.exception';

const OBJECT_ID = /^[a-fA-F0-9]{24}$/;

/**
 * Param pipe that asserts a 24-char hex ObjectId. Use on `:roomId` /
 * `:userId` style path params so an invalid id returns a clean 400 instead
 * of crashing inside Mongoose with a CastError → 500.
 *
 *   @Param('roomId', ObjectIdPipe) roomId: string
 */
@Injectable()
export class ObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (!OBJECT_ID.test(value)) {
      throw new ApiException(
        ExcKey.UNHANDLED,
        `${metadata.data ?? 'parameter'} must be a 24-char hex ObjectId`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return value;
  }
}
