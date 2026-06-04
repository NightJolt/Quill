import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AttachmentDto } from '../message/message.dto';

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
    createdAt: string;
    editedAt?: string;
  };
}

/** Emitted when a message is soft-deleted. The client tombstones it by id. */
export interface MessageDeletedEvt {
  roomId: string;
  messageId: string;
}

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
  // outbound
  MESSAGE: 'message',
  MESSAGE_UPDATE: 'message_update',
  MESSAGE_DELETE: 'message_deleted',
  TYPING_EVT: 'typing',
  READ_EVT: 'read',
} as const;

/** Socket.IO room name for fan-out to a given room. */
export const roomChannel = (appId: string, roomId: string): string => `room:${appId}:${roomId}`;
