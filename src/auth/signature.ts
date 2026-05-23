import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Compute the TalkJS-style signature: HMAC-SHA256 of the userId only,
 * keyed by the app's private key. Output is lowercase hex.
 *
 * Used in two places:
 *   - app backend mints it for its users (`/api/chat/session` on the monolith)
 *   - Quill recomputes and compares on WS handshake
 *
 * Identity-proving only; access control lives in chat_participants.
 */
export function signUserId(userId: string, privateKey: string): string {
  return createHmac('sha256', privateKey).update(userId).digest('hex');
}

/**
 * Constant-time comparison of two hex signatures. Throws on length mismatch
 * (timingSafeEqual requires equal-length buffers).
 */
export function verifySignature(userId: string, privateKey: string, candidate: string): boolean {
  const expected = signUserId(userId, privateKey);
  if (expected.length !== candidate.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(candidate, 'hex'));
  } catch {
    return false;
  }
}
