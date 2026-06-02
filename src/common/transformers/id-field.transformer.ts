import { Transform } from 'class-transformer';
import { Types } from 'mongoose';

/**
 * Property decorator: serializes Mongo `ObjectId` → 24-char hex string on
 * outbound. Already-string values pass through unchanged.
 *
 * Wire shape is always `string`; the field can be typed as `string` on the
 * DTO. The runtime value handed to `plainToInstance` may be either an
 * ObjectId instance (straight from a Mongoose document) or a string
 * (pre-stringified upstream) — the decorator covers both.
 *
 *   @IdField()
 *   appId!: string;
 */
export const IdField = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) => {
    if (value === null || value === undefined) return value;
    if (value instanceof Types.ObjectId) return value.toHexString();
    return value;
  });
