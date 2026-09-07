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
 * Sign an outbound request body: HMAC-SHA256 over the **raw JSON bytes**,
 * keyed by the app's private key. Output is lowercase hex.
 *
 * The reverse direction of {@link signUserId} — there Quill *verifies* an app's
 * claim about a user; here Quill *proves* to the app that a webhook really came
 * from Quill. Same primitive, same per-app secret, no new key material.
 *
 * Two rules the caller must honour, because HMAC is over bytes and not over
 * "the object":
 *   1. **Serialize once, sign that exact string, send that exact string.** A
 *      second `JSON.stringify` can legally reorder nothing but *can* differ in
 *      other ways, and any framework that re-serializes on the way out breaks
 *      the signature. `PushService` holds one `rawBody` local for all three.
 *   2. The receiver must verify over the raw request bytes too — parsing and
 *      re-serializing on their side is the mirror-image mistake.
 *
 * Body-only signing, no timestamp and no nonce: it matches Quill's no-expiry
 * signature philosophy, and the payload carries a `messageId` the receiver can
 * dedupe on if it ever cares about replay.
 */
export function signBody(rawBody: string, privateKey: string): string {
  return createHmac('sha256', privateKey).update(rawBody, 'utf8').digest('hex');
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
