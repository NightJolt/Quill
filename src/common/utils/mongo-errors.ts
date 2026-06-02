/**
 * Mongo error code 11000 = duplicate key on a unique index. Surfaces both
 * as a single-write error (`err.code === 11000`) and inside `BulkWriteError`
 * (`err.writeErrors[].code === 11000`) when `insertMany({ ordered: false })`
 * was used.
 */
export function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: number; writeErrors?: { code?: number }[] };
  if (e.code === 11000) return true;
  return Array.isArray(e.writeErrors) && e.writeErrors.some((w) => w.code === 11000);
}
