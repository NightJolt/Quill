import { Transform } from 'class-transformer';

/**
 * Property decorator: converts Date → ISO 8601 string in **both** directions
 * (plain↔instance) so the runtime field value always matches the declared
 * wire type (`string`). With this, services can feed `plainToInstance` a raw
 * Mongoose Date and the resulting class instance immediately holds a string.
 *
 *   @IsoDate()
 *   createdAt!: string;
 *
 *   @IsoDate()
 *   rotatedAt?: string | null;
 *
 * Nullish → `null` so the wire shape is unambiguous (vs `undefined` getting
 * dropped by JSON.stringify).
 */
export const IsoDate = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) => {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    // Already a string (e.g. on a second pass through the pipeline).
    return value;
  });
