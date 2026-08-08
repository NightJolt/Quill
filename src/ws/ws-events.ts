import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsMongoId,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AttachmentDto } from '../message/message.dto';
import { REACTION_EMOJIS } from '../message/reactions';

/**
 * The canonical reaction set, re-exported here because this file is the one
 * the frontends copy. Runtime equivalent: `GET /config` → `{ reactions: [...] }`.
 */
export { REACTION_EMOJIS };
export type { ReactionEmoji } from '../message/reactions';

/**
 * Wire-level shapes for Socket.IO events. These are the source of truth for
 * the WS protocol — keep frontend client types in sync by copying or
 * sharing this file.
 *
 * Inbound classes carry `class-validator` decorators; the global
 * `ValidationPipe` runs on every `@MessageBody()` argument, so untrusted
 * client payloads can't get past the gateway with bogus shapes (huge
 * content strings, wrong types, non-ObjectId roomIds).
 *
 * Conventions:
 *   - `*Req` → inbound (client → server, validated)
 *   - `*Evt` → outbound (server → client, no decorators needed; these are
 *              just shape declarations for documentation)
 */

// ── Inbound (client → server) ──────────────────────────────────────────────

export class SubscribeReq {
  @IsMongoId()
  roomId!: string;
}

export class UnsubscribeReq {
  @IsMongoId()
  roomId!: string;
}

export class SendReq {
  @IsMongoId()
  roomId!: string;

  @IsString()
  @MaxLength(4000)
  content!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];

  /** Opaque app-defined JSON (size-capped in the service). */
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  /** Opaque id chosen by the client so it can reconcile optimistic UI when the ack comes back. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientTempId?: string;
}

export class TypingReq {
  @IsMongoId()
  roomId!: string;

  @IsBoolean()
  isTyping!: boolean;
}

export class ReadReq {
  @IsMongoId()
  roomId!: string;

  /** The createdAt of the most recent message the user has seen. */
  @IsDateString()
  upTo!: string;
}

/**
 * Toggle the caller's reaction on one message.
 *
 * **One reaction per user per message**, WhatsApp-style: emitting a *different*
 * emoji replaces the caller's previous one; emitting the *same* emoji again
 * removes it. There is no separate "unreact" request — the ack tells you which
 * of the two happened via `emoji: <string> | null`.
 *
 * `emoji` must be one of {@link REACTION_EMOJIS}; anything else is rejected
 * with `INVALID_REACTION`. `@MaxLength(16)` is only a cheap fast-fail — the
 * canonical-set check in `MessageService.react` is the real gate.
 */
export class ReactReq {
  @IsMongoId()
  roomId!: string;

  @IsMongoId()
  messageId!: string;

  @IsString()
  @MaxLength(16)
  emoji!: string;
}

// ── Outbound (server → client) ─────────────────────────────────────────────
// Plain interfaces — no validation needed on outbound payloads. The server
// builds these from trusted state. They exist for documentation + to give
// the gateway code something to type-check against.

export interface MessageEvt {
  roomId: string;
  message: {
    id: string;
    senderId: string;
    content: string;
    attachments?: SendReq['attachments'];
    metadata?: Record<string, unknown>;
    createdAt: string;
  };
  /** Echoed from SendReq for optimistic-reconciliation by the sender. */
  clientTempId?: string;
}

/** Emitted when a message's content changes (edit). Carries the full updated message. */
export interface MessageUpdateEvt {
  roomId: string;
  message: {
    id: string;
    senderId: string;
    content: string;
    attachments?: SendReq['attachments'];
    metadata?: Record<string, unknown>;
    createdAt: string;
    editedAt?: string;
  };
}

/** Emitted when a message is soft-deleted. The client tombstones it by id. */
export interface MessageDeletedEvt {
  roomId: string;
  messageId: string;
}

/**
 * Emitted to the whole room when one user's reaction on one message changes.
 *
 * A **delta, not a snapshot** — deliberately, and it is safe to be one because
 * the underlying model is "one reaction per user": `{userId, emoji}` is a
 * *complete* statement of that user's state on that message, so applying it is
 * idempotent and two users' events commute in any arrival order. A full
 * snapshot would instead be O(participants) bytes per tap in an
 * apartment-wide room, and two concurrent snapshots could arrive out of order
 * and lose a reaction.
 *
 * `emoji: null` means the user cleared their reaction (toggled off). Any other
 * value means the user now holds exactly that emoji — clients apply it by
 * removing `userId` from every bucket first, then appending to the named one.
 *
 * Mirrors `MessageDeletedEvt`'s style: room-scoped, addressed by `messageId`,
 * no message body.
 */
export interface MessageReactionEvt {
  roomId: string;
  messageId: string;
  /** The user whose reaction changed — may or may not be the receiving client. */
  userId: string;
  /** The user's reaction after the change; `null` when they removed it. */
  emoji: string | null;
}

/**
 * Ack for a `react` request.
 *
 * Reaction failures resolve the ack instead of throwing, matching `subscribe`.
 * (A thrown exception in a Nest WS handler never resolves the ack — the client
 * just times out — and Nest does **not** apply global HTTP exception filters to
 * gateways, so `ApiException`'s `key` would be flattened to a generic
 * "Internal server error" on the `exception` channel. An explicit result keeps
 * the error machine-readable.)
 *
 * `reason` values are `ExcKey` constants, so a client can share one error map
 * with the REST surface.
 */
export type ReactAck =
  | {
      ok: true;
      /** The caller's reaction after the toggle; `null` when it was removed. */
      emoji: string | null;
      /** Authoritative post-state for the whole message — same shape as `MessageRes.reactions`. */
      reactions: Array<{ emoji: string; userIds: string[] }>;
    }
  | { ok: false; reason: string; message: string };

export interface TypingEvt {
  roomId: string;
  userId: string;
  isTyping: boolean;
}

export interface ReadEvt {
  roomId: string;
  userId: string;
  lastReadAt: string;
}

// ── Event name constants ───────────────────────────────────────────────────

export const WsEvents = {
  // inbound
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  SEND: 'send',
  TYPING: 'typing',
  READ: 'read',
  REACT: 'react',
  // outbound
  MESSAGE: 'message',
  MESSAGE_UPDATE: 'message_update',
  MESSAGE_DELETE: 'message_deleted',
  MESSAGE_REACTION: 'message_reaction',
  TYPING_EVT: 'typing',
  READ_EVT: 'read',
} as const;

/** Socket.IO room name for fan-out to a given room. */
export const roomChannel = (appId: string, roomId: string): string => `room:${appId}:${roomId}`;
