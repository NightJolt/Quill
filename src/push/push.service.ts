import { Injectable, Logger } from '@nestjs/common';
import { AppRegistry } from '@/auth/app-registry.service';
import { signBody } from '@/auth/signature';
import type { MessageRes } from '@/message/message.dto';

/** One attempt's ceiling. Two attempts worst case, so ~11s of total budget. */
const CALLBACK_TIMEOUT_MS = 5000;
/** Fixed pause before the single retry. No ladder — see the class doc. */
const RETRY_DELAY_MS = 1000;

/**
 * Body Quill POSTs to an app's `callbackUrl` after every sent message.
 *
 * `metadata` is relayed **verbatim and uninterpreted** — it is the app's own
 * opaque bag, and the whole point of this callback is that Quill stays ignorant
 * of what mentions/media/replies mean. The receiving app is the policy decision
 * point: it decides who (if anyone) gets a notification out of this.
 */
export interface NotifyPayload {
  appId: string;
  roomId: string;
  messageId: string;
  senderId: string;
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Outbound notify callback — the one place Quill talks *to* a calling app.
 *
 * Fires once per successfully-sent message, from `ChatGateway.onSend` **after**
 * the room broadcast, never from `MessageService.send` (which future REST sends
 * reuse and which owns no broadcast). The app backend turns the payload into
 * durable notification rows and pushes; Quill does none of that itself.
 *
 * **Deliberately unfiltered.** No recipient selection, no
 * `ConnectionRegistry.hasActive` online-skip, no throttle. Quill cannot filter
 * correctly — recipients are a function of `metadata.mentions`, which only the
 * app understands — and skipping a user because one socket happens to be open
 * would silently drop a durable notification row for anyone sitting on a stale
 * background tab. Sending everything and letting the app decide is the cheaper
 * mistake. (This is a change from the older CLAUDE.md sketch, which proposed
 * exactly that filtering.)
 *
 * **Delivery is best-effort by design:** one attempt, one retry, then a warn
 * and it's gone. No queue, no persistence, no backoff ladder. The message
 * itself is already durable in Mongo and readable over history, so a dropped
 * callback costs a notification, never a message. Anything stronger means an
 * outbox table and a worker, which is not worth it for this.
 *
 * The whole method is failure-swallowing: it never throws, never rejects, and
 * is called with `void` so it can never touch the send ack's latency.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(private readonly registry: AppRegistry) {}

  /**
   * Fire the callback for one message. Fire-and-forget — call it as
   * `void push.notify(...)` and never await it.
   *
   * Returns immediately when the app has no `callbackUrl` configured, which is
   * the default state for every app and is not an error.
   */
  async notify(appId: string, roomId: string, message: MessageRes): Promise<void> {
    try {
      const callbackUrl = this.registry.callbackUrlOf(appId);
      if (!callbackUrl) return; // no callback configured — the intended "off" state

      const privateKey = this.registry.getKey(appId);
      if (!privateKey) {
        // The app was revoked between the send and here. Nothing to sign with.
        this.logger.warn(`notify skipped: no key for app ${appId}`);
        return;
      }

      const payload: NotifyPayload = {
        appId,
        roomId,
        messageId: message.id,
        senderId: message.senderId,
        content: message.content,
        createdAt: message.createdAt,
        metadata: message.metadata,
      };

      // Serialize ONCE. This exact string is what gets signed and what gets
      // sent — re-stringifying for the request would risk signing bytes the
      // receiver never sees. See `signBody`.
      const rawBody = JSON.stringify(payload);
      const headers = {
        'Content-Type': 'application/json',
        'X-Quill-App-Id': appId,
        'X-Quill-Signature': signBody(rawBody, privateKey),
      };

      // Attempt, then exactly one retry after a fixed pause.
      for (let attempt = 1; attempt <= 2; attempt++) {
        const failure = await this.post(callbackUrl, headers, rawBody);
        if (!failure) return;
        if (attempt === 1) {
          await delay(RETRY_DELAY_MS);
          continue;
        }
        this.logger.warn(
          `notify callback failed for message ${message.id} (app=${appId} room=${roomId}): ${failure}`,
        );
      }
    } catch (err) {
      // Belt and braces. Nothing above should throw, but this method is called
      // un-awaited: an escaping rejection would surface as an unhandled promise
      // rejection and, depending on the Node flags, take the process down.
      this.logger.warn(`notify callback errored: ${(err as Error)?.message ?? err}`);
    }
  }

  /**
   * One POST attempt. Resolves `null` on success, or a short reason string
   * describing the failure — never rejects.
   */
  private async post(
    url: string,
    headers: Record<string, string>,
    rawBody: string,
  ): Promise<string | null> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: rawBody,
        signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
      });
      // Release the socket promptly — we never read the response body, and an
      // undrained one keeps the connection pinned until GC.
      void res.body?.cancel().catch(() => undefined);
      return res.ok ? null : `HTTP ${res.status}`;
    } catch (err) {
      // Network error, DNS failure, or the 5s AbortSignal firing.
      return (err as Error)?.message ?? 'request failed';
    }
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
