/**
 * Wire-level shapes for Socket.IO events. These types are the source of truth
 * for the WS protocol — keep frontend client types in sync by copying or
 * sharing this file.
 *
 * Convention:
 *   - Inbound (`*Req`) → events the client emits to the server
 *   - Outbound (`*Evt`) → events the server pushes to clients
 *   - Ack payloads documented inline where they exist
 */

// ---------- Inbound (client → server) ----------

export interface SubscribeReq {
  roomId: string;
}

export interface UnsubscribeReq {
  roomId: string;
}

export interface SendReq {
  roomId: string;
  content: string;
  attachments?: {
    type: 'image' | 'audio' | 'file';
    fileId: string;
    mimeType?: string;
    sizeBytes?: number;
    durationMs?: number;
  }[];
  /** Opaque id chosen by the client so it can reconcile optimistic UI when the ack comes back. */
  clientTempId?: string;
}

export interface TypingReq {
  roomId: string;
  isTyping: boolean;
}

export interface ReadReq {
  roomId: string;
  /** The createdAt of the most recent message the user has seen. */
  upTo: string;
}

// ---------- Outbound (server → client) ----------

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

// ---------- Event name constants ----------

export const WsEvents = {
  // inbound
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  SEND: 'send',
  TYPING: 'typing',
  READ: 'read',
  // outbound
  MESSAGE: 'message',
  TYPING_EVT: 'typing',
  READ_EVT: 'read',
} as const;

/** Socket.IO room name for fan-out to a given room. */
export const roomChannel = (appId: string, roomId: string): string => `room:${appId}:${roomId}`;
