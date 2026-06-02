/**
 * Single source of truth for the 24-char hex ObjectId format. Imported by
 * the WS handshake verifier, SignatureGuard, ObjectIdPipe, and AppRegistry.
 */
export const OBJECT_ID_REGEX = /^[a-fA-F0-9]{24}$/;

export const isObjectId = (value: unknown): value is string =>
  typeof value === 'string' && OBJECT_ID_REGEX.test(value);
