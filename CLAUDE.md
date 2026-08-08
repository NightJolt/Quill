# Quill

Multi-tenant chat backend. Built to replace TalkJS in `urbancare_monolith` and be reused by future apps.

**Status: design phase, not yet scaffolded.** This file is the spec — it describes the system we're building, not one that exists.

---

## Why this exists

Urbancare currently uses TalkJS for apartment-wide group chat. Reasons for replacing it:

- **Cost** — TalkJS's pricing scales with MAU; the apartment-management product would hit the paywall quickly.
- **Design control** — `<Chatbox>` styling is constrained; chat UI never matched the rest of urbancare's surfaces.
- **Vendor lock-in not a primary driver** — but byproducts (messages stored on TalkJS's side, identity sync overhead) go away with this build.

**What's kept from the TalkJS mental model**: rooms are an abstract "N-participant container" — could be 1:1, group of 5, or apartment-wide. The chat backend knows nothing about apartments or what an app's users represent. It only knows users (opaque IDs) and rooms.

**Reusability is intentional.** Quill is designed multi-tenant from day one. Urbancare is App #1. Each future product gets its own `appId` + `privateKey` and the same chat backend serves them all in isolation.

---

## Scope of MVP

In:
- Rooms with arbitrary participant sets (1+ users).
- Send + receive messages with real-time delivery.
- History pagination.
- Read receipts (`lastReadAt` per participant).
- Typing indicators.
- Image / file attachments (delegated to the calling app's file storage).
- Push notification fan-out (delegated back to calling app's push pipeline).

Out (initially):
- A built-in admin UI. Apps are managed via raw `/admin/**` HTTP for v1.
- Voice messages, link previews, **composer** emoji picker — these live in **the calling app's frontend**, not in Quill. See "Frontend features" below. (Message *reactions* are a different thing and are now in — they mutate an existing message, which is server state; see the reversal note in "Skip".)
- Threaded replies, search. Defer. (Message edit/delete shipped; quote-reply rides the app-owned `metadata` bag and needs no Quill change.)
- Distributed scaling (Redis adapter, multi-instance). Single instance until proven necessary.
- Multi-instance cache invalidation. AppRegistry mutations update the local cache directly; for multi-instance deployment, add Mongo change streams on `chat_apps`.

---

## Tech stack

```
Runtime:          Node 22 LTS
Framework:        NestJS 11.x
WebSocket:        @nestjs/websockets + @nestjs/platform-socket.io (Socket.IO v4)
HTTP:             @nestjs/platform-express
Database:         MongoDB (shared cluster with urbancare_monolith, separate collections)
ODM:              @nestjs/mongoose + mongoose 8.x
Validation:       class-validator + class-transformer
JWT/signing:      Node's built-in `crypto.createHmac` (no jsonwebtoken needed)
Config:           @nestjs/config (env-driven)
Logging:          Nest's built-in `Logger` (pino is NOT a dependency)
Package manager:  npm (package-lock.json — there is no pnpm lockfile)
Build:            Nest CLI → dist/
Deploy:           port 8086. Only a Dockerfile is checked in — no systemd unit,
                  nginx conf, compose file or CI workflow lives in this repo.
```

⚠️ **The Dockerfile does not build.** It runs `corepack enable && pnpm install
--frozen-lockfile` against `COPY package.json pnpm-lock.yaml* ./`, but the repo
is npm-managed — the glob matches nothing and pnpm aborts on a missing lockfile
with that flag. The pnpm lockfile was deliberately removed; the Dockerfile was
not updated to match. Switch it to `npm ci` before relying on a container build.

**Why not Kotlin + Spring** (matching the monolith): briefly considered. Rejected because (a) Socket.IO is genuinely the best-in-class chat library and rewriting its primitives in raw Spring WS is busy work; (b) TypeScript shares with urbancare_front, so message-event type definitions can be shared between client and server; (c) ~10× lighter idle memory than another Spring app on the same VPS.

**Cost taken**: a third language in the ops surface (Kotlin / TypeScript / Dart already). Acceptable because the chat service shares a language with the frontend.

---

## Multi-tenancy

**Tenant = app.** Identified by `appId`.

Each registered app has:
- `appId` — public identifier, safe to ship in client bundles.
- `privateKey` — server-only shared secret. Lives on (a) the app's own backend, (b) Quill's app registry. Never touches clients.

The `appId` is a partition key — every Mongoose schema (`Room`, `Participant`, `Message`) carries it, every query filters by it. **User IDs are scoped per app** — `userId = "abc"` in app A is a different user from `userId = "abc"` in app B. Cross-app contamination is impossible by construction.

### App registry

**Source of truth is `chat_apps` (Mongo).** Each row carries the appId (= `_id`), label, and the app's private key envelope-encrypted under `QUILL_MASTER_KEY` (see `chat_apps` schema). On boot, `AppRegistry.onModuleInit` reads every non-revoked row, decrypts each `encryptedKey`, and caches plaintext keys in memory:

```typescript
class AppRegistry {
  // hot-path lookups for guards
  getKey(appId): string | null;
  findAppByKey(key): string | null;

  // admin mutations — update DB then cache, return plaintext key once
  async register(label): Promise<{ appId, privateKey, label }>;
  async rotate(appId): Promise<{ privateKey } | null>;
  async unregister(appId): Promise<boolean>;
  async list(): Promise<AppSnapshot[]>;
  async reload(): Promise<void>;   // rebuild cache from DB
}
```

**Required env vars** — boot crashes if any is missing or malformed:

```
MONGO_URI=<connection string>        # QuillConfig.mongoUri throws when unset
QUILL_MASTER_KEY=<64 hex chars>      # 32 random bytes — encrypts every app's key in chat_apps
QUILL_ADMIN_TOKEN=<long random hex>  # bearer for /admin endpoints
```

Optional: `PORT` (8086), `QUILL_DB_NAME` (overrides the DB in the URI),
`QUILL_CORS_ORIGINS` (default `*`, **HTTP only** — the WS gateway hardcodes
`origin: '*'` in its decorator, so this does not restrict socket origins),
`QUILL_LINK_PREVIEWS` (default `true`; `false` disables outbound preview fetches).

Loaded from `.env.local` then `.env`. **There are no `QUILL_APP_*` env vars** — apps are added/removed at runtime via `/admin/**`.

### Creating, rotating, and revoking apps

All `/admin/**` are guarded by `AdminTokenGuard` (constant-time match against `QUILL_ADMIN_TOKEN`).

```
POST   /admin/apps               { label }               → { appId, label, privateKey }   (key shown ONCE)
GET    /admin/apps                                       → [{ appId, label, createdAt, rotatedAt, revoked }]
POST   /admin/apps/:appId/rotate                         → { privateKey }   (new key, shown ONCE)
DELETE /admin/apps/:appId                                → { success: true }   (soft delete)
```

- `POST /admin/apps` generates a fresh 32-byte privateKey, encrypts it, inserts a `chat_apps` row, updates the cache, returns plaintext. Plaintext is **only** in the response — never retrievable again.
- `POST /admin/apps/:appId/rotate` generates a new key, replaces `encryptedKey`, sets `rotatedAt`, swaps the cache, **disconnects every open Socket.IO connection for this appId**. Clients reconnect with a fresh signature.
- `DELETE /admin/apps/:appId` sets `revoked: true`, drops the cache entry, disconnects open sockets. Rooms/participants/messages stay; the appId becomes unreachable. Manual hard-delete of the row is fine when you're sure.

Day-to-day registration:

```bash
# generate the master + admin secrets once, on first deploy
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # → QUILL_MASTER_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # → QUILL_ADMIN_TOKEN

# any time later, add an app
curl -X POST http://quill.example.com/admin/apps \
  -H "Authorization: Bearer $QUILL_ADMIN_TOKEN" \
  -d '{"label":"acme"}' -H "Content-Type: application/json"
# → { "appId": "...", "privateKey": "...", "label": "acme" }
# Capture privateKey immediately and put it in acme's backend env.
```

---

## Auth model (TalkJS-equivalent)

Two distinct credentials, two distinct callers:

| Caller | Credential | Used for |
|---|---|---|
| App backend → Quill (REST) | `Authorization: Bearer <privateKey>` | Internal admin endpoints (`/internal/**`): create rooms, manage participants |
| App user → Quill (WebSocket) | `auth: { appId, userId, signature }` | Connecting to the chat server, sending messages |

### Signature format — copied from TalkJS verbatim

```
signature = HMAC-SHA256(userId, app_privateKey)
```

The signature is computed **only over the userId**. Not over appId, not over an expiry, not over anything else. Output as a hex string.

**No expiry.** Reasoning (same as TalkJS):
1. The signature proves identity, not authorization. Access checks live in the `chat_participants` table — kicking a user from a room instantly revokes access regardless of signature validity.
2. Stealing a signature is no worse than stealing the app's session cookie. The user is already authenticated to the app to receive the signature in the first place.
3. No refresh dance on the frontend — mint once at page load, reuse.

### Who signs, who verifies

```
                    privateKey (shared secret)
                       /              \
                      /                \
                 App backend          Quill
                  (signs)           (verifies)
```

The app's backend signs because **it's the only one that can authenticate the user** — Quill has no idea who urbancare's users are, only the urbancare monolith does. Quill's job is to trust the assertion.

### App backend integration (urbancare monolith side)

Mint signatures via a new endpoint:

```
GET /api/chat/session
  (auth: urbancare's auth-token cookie)
→ { appId, userId, signature }
```

Kotlin sketch:

```kotlin
@GetMapping("/api/chat/session")
fun mintSession(@CurrentUser user: UserDoc): ChatSessionRes {
    val signature = hmacSha256Hex(user.id, chatProperties.appKey)
    return ChatSessionRes(
        appId = chatProperties.appId,
        userId = user.id,
        signature = signature,
    )
}
```

### Quill WS handshake guard

```typescript
canActivate(ctx: ExecutionContext): boolean {
  const client: Socket = ctx.switchToWs().getClient();
  const { userId, appId, signature } = client.handshake.auth;

  if (!userId || !appId || !signature) return false;
  const key = this.registry.getKey(appId);
  if (!key) return false;

  const expected = createHmac('sha256', key).update(userId).digest('hex');
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;

  client.data.userId = userId;
  client.data.appId = appId;
  return true;
}
```

### Internal-key guard

For monolith → Quill REST calls (room create, add/remove participant, etc.):

```typescript
canActivate(ctx: ExecutionContext): boolean {
  const req = ctx.switchToHttp().getRequest();
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return false;
  const key = auth.slice(7);
  const appId = this.registry.findAppByKey(key);
  if (!appId) return false;
  req.appContext = { appId };
  return true;
}
```

---

## Data model

All collections share a Mongo cluster with urbancare_monolith but use distinct collection names and are written to **only by Quill**. The monolith never reaches into Quill's collections directly.

### `chat_rooms`

```typescript
{
  _id: ObjectId,           // Quill-internal surrogate (auto-generated)
  appId: ObjectId,
  roomId: ObjectId,        // caller-supplied external id (e.g. apartmentId)
  name?: string,           // optional display label, app-specific
  deleted: boolean,        // soft-delete flag
  createdAt: Date,
}
```

Compound unique index `(appId, roomId)` — that pair, **not `_id`**, is the room's identity. `roomId` is the id the consuming app supplies (urbancare passes `apartmentId`); `_id` is an internal surrogate Quill generates. This keeps tenants isolated: two apps may use the same `roomId` and the `(appId, roomId)` index keys them apart. Participants and messages reference the external `roomId` (scoped by `appId`), never `_id`, so there's no internal-id lookup. The API echoes `roomId` back as `RoomRes.id` — callers always see the id they supplied.

### `chat_participants`

```typescript
{
  _id: ObjectId,
  appId: string,           // indexed
  roomId: string,
  userId: string,          // app-scoped user id
  joinedAt: Date,
  lastReadAt?: Date,       // for unread counts + read receipts
}
```

Compound unique index: `(appId, roomId, userId)`.
Compound index for room lookups: `(appId, userId)` — for listing a user's rooms.

### `chat_messages`

```typescript
{
  _id: ObjectId,
  appId: string,           // indexed
  roomId: string,
  senderId: string,        // app-scoped userId
  content: string,         // plain text; emoji are just Unicode chars
  createdAt: Date,
  attachments?: [
    {
      type: 'image' | 'audio' | 'file',
      fileId: string,      // the *calling app's* file id, not Quill's
      mimeType?: string,
      sizeBytes?: number,
      durationMs?: number, // for audio
    }
  ],
  linkPreviews?: [
    {
      url: string,
      title?: string,
      description?: string,
      imageUrl?: string,
      siteName?: string,
    }
  ],
  metadata?: Record<string, unknown>,   // opaque, app-owned; Quill never reads it
  reactions?: { [userId: string]: string },  // emoji reactions — see below
  editedAt?: Date,
  deleted: boolean,
  deletedAt?: Date,
  // v2 fields when needed: replyToId
}
```

Compound index for history pagination: `(appId, roomId, createdAt)`. **No index on `reactions`** — see below.

#### Reactions

Stored as a **map keyed by the reacting user's id**, `{ "<userId hex>": "<emoji>" }` — not an array of `{userId, emoji}` pairs. The shape is chosen entirely for concurrency:

- **One reaction per user per message is structural.** A map key cannot repeat, so a double-tap (or the same user on two devices) can never produce two entries. No dedup logic, no unique index, no read-modify-write.
- **Every mutation is a single atomic op on a distinct document path.** Set/replace is `$set { "reactions.<uid>": emoji }`; remove is `$unset { "reactions.<uid>": "" }`. Two users reacting in the same instant address two *different* paths, so both survive — neither can overwrite the other. An array shape would have forced either a read-modify-write `doc.save()` (lost updates under a reaction burst in an apartment-wide room, which is exactly the load pattern here) or a `$pull`+`$push` pair, which Mongo rejects outright as a conflicting update on one path.
- **Toggle is decided by the query predicate, not by a prior read.** `setReaction` matches on `"reactions.<uid>": { $ne: emoji }`, so it lands only when the user's reaction actually differs (and `$ne` also matches a *missing* path, so a first-ever reaction is the same single op). A miss means "they already hold this emoji" → `clearReaction` runs with the mirror predicate `"reactions.<uid>": emoji`. Common path is one round trip; toggle-off is two.

Cost of the shape: BSON field names must be strings, so this is the **one documented exception to the "every id-bearing field is stored as an ObjectId" convention** — the keys are 24-char hex strings. They are validated as ObjectId hex by the WS handshake guard before they ever become field names, so they cannot contain `.` or a leading `$`.

Absent on messages nobody has reacted to (`default: undefined` — no empty map is ever written), which is why **no migration is needed**: existing rows read as `undefined`, and `$set` on `reactions.<uid>` creates the path on demand.

**No new index is warranted.** Every reaction touches exactly one document, located by `_id` (plus `appId`/`roomId`/`deleted` as in-document predicates) — the default `_id` index already serves it as a point lookup. There is no query that filters or sorts *by* reaction, and indexing a map field would create a multikey index over a hot, high-churn path for no reader. Revisit only if a "messages I reacted to" query ever appears.

Values are constrained at the service layer to the canonical set in `src/message/reactions.ts` (`👍 ❤️ 😂 😮 😢 🙏`) — the single source of truth, re-exported from `ws/ws-events.ts` for clients to copy and served at runtime from `GET /config`. The read-side projection also drops any stored value outside the set, so the set can be narrowed later without a migration. `MessageService.remove` clears `reactions` alongside `metadata`, so a tombstone carries neither.

### `chat_apps`

```typescript
{
  _id: ObjectId,                  // = the appId, referenced by every other chat_* row
  label: string (unique),         // 'urbancare' — friendly name for logs/admin
  encryptedKey: string,           // base64(IV || ciphertext || authTag) — AES-256-GCM under QUILL_MASTER_KEY
  rotatedAt?: Date,               // last key rotation
  revoked: boolean,               // soft-delete; revoked apps stop authenticating but rooms stay
  createdAt: Date,
}
```

**Source of truth for the registry.** `AppRegistry` loads non-revoked rows on boot, decrypts each `encryptedKey`, and caches plaintext keys in memory for hot-path auth. Mutations (`register` / `rotate` / `unregister`) update the DB and the cache in lockstep.

**Envelope encryption** keeps app secrets out of plaintext DB storage. The master key (`QUILL_MASTER_KEY`) lives only in env; a DB compromise alone yields useless ciphertext. The cost: losing `QUILL_MASTER_KEY` means losing every app key — treat it as a root credential.

**Lifecycle**: `DELETE /admin/apps/:appId` sets `revoked: true` and drops the cache; the row stays for audit. Existing rooms/messages remain in the DB but their appId becomes unreachable for new auth.

### Id storage convention

**Every id-bearing field is stored as a `BSON ObjectId`, never as a string.** That includes `appId`, `roomId`, `userId`, `senderId`, `createdBy`, and attachment `fileId`. Mirrors urbancare_monolith's `@Field(targetType = FieldType.OBJECT_ID)` convention — 12 bytes on disk instead of 24-character hex strings, faster comparisons, and consistent typing across the stack.

Constraint this places on all Quill apps: **every identifier must be a 24-char hex ObjectId.** That includes the app's own appId (lives in env vars as a hex value, not a slug). urbancare's userIds already fit; a future app that wants UUIDs would need a per-app field-type config (not built).

At the API boundary everything is still strings — DTOs validate via `@IsMongoId()`, path params validate via `ObjectIdPipe`, WS handshake validates `appId` and `userId` as 24-char hex. Service `toRes()` mappers call `.toString()` to convert back. The result: clients always see hex strings, the database always stores ObjectIds.

**One documented exception**: the keys of `chat_messages.reactions` are hex *strings*, because BSON field names cannot be ObjectIds. That is the price of the map shape, and the map shape is what buys atomic per-user updates — see "Reactions" above. The keys are guard-validated as ObjectId hex before they are ever used as field names.

---

## API surface

### User-facing (signature auth via WS handshake / REST headers)

```
WebSocket: wss://quill.example.com/  (Socket.IO endpoint)
  Handshake auth: { appId, userId, signature }

REST (implemented today — signature headers X-Quill-App-Id / X-Quill-User-Id / X-Quill-Signature):
  GET    /rooms/{id}/messages?before=|after=&limit=   # history; one direction per call, both exclusive, max 100
  GET    /rooms/{id}/participants                     # roster + lastReadAt watermarks; participant-gated (read receipts / unread hydration)

REST (unauthenticated):
  GET    /health                                 # liveness probe
  GET    /config                                 # → { reactions: ["👍","❤️","😂","😮","😢","🙏"] }
                                                 #   static wire constants both clients must mirror, so
                                                 #   they cannot drift from server-side validation.
                                                 #   Nothing tenant-specific belongs here.

REST (sketched, NOT implemented — WS covers these today):
  GET    /rooms                                  # list a user's rooms
  POST   /rooms/{id}/messages                    # send over REST
  POST   /rooms/{id}/read                        # mark-read over REST
```

Default expectation: **user-facing REST is minimal or zero**. Frontend can do everything over Socket.IO (rooms list, history pagination, send, mark-read). REST is a fallback for cases where WS isn't connected (server-rendered initial state, missed-message backfill).

### Internal (private-key auth)

```
POST   /internal/rooms                         { name? }
POST   /internal/rooms/{id}/participants       { userIds: [...] }
DELETE /internal/rooms/{id}/participants/{userId}
DELETE /internal/rooms/{id}                    # soft delete
GET    /internal/rooms/{id}                    # admin read
```

Routes never put `appId` in the URL — it's always derived from the credential.

---

## WebSocket protocol (Socket.IO events)

### Client → server

```
send         { roomId, content, attachments?, metadata?, clientTempId } → ack: { messageId, createdAt }
typing       { roomId, isTyping: boolean }
read         { roomId, upTo: <ISO8601 timestamp> } → updates participant lastReadAt
subscribe    { roomId } → joins Socket.IO room "room:{appId}:{roomId}", server checks participation
unsubscribe  { roomId }
react        { roomId, messageId, emoji } → ack: { ok:true, emoji: string|null, reactions:[...] }
                                                  | { ok:false, reason, message }
```

`react` is the **only user-authenticated message mutation**. Edit and delete go through `/internal` because the calling app owns their policy (the manager delete override); a reaction's only policy is "is a participant of this room", which Quill already enforces — so routing it through the monolith would add a network hop to a tap-latency gesture for no authorization gain.

Toggle semantics, one reaction per user per message (WhatsApp-style): a *different* emoji replaces the caller's previous one, the *same* emoji removes it. There is no separate "unreact" request — the ack's `emoji` (the value, or `null`) says which happened. `emoji` must be in the canonical set or the ack is `{ ok:false, reason:'INVALID_REACTION' }`.

Like `subscribe`, `react` **resolves its ack on failure instead of throwing**. This is load-bearing, not stylistic: Nest does not apply global HTTP exception filters to gateways (`ExceptionFiltersContext.getGlobalMetadata()` returns `[]`), so a thrown `ApiException` reaches `BaseWsExceptionFilter.handleUnknownError`, which flattens it to a generic `{status:'error', message:'Internal server error'}` on the `exception` channel **and never resolves the ack** — the client just times out with no error key. `reason` carries an `ExcKey` so clients share one error map with REST. (`send` still throws and has this problem — see backlog.)

The server validates that the connecting userId is a participant of any room they try to subscribe to. Subscriptions are not persistent — they're per-connection.

### Server → client

```
message           { roomId, message: {...} }
message_update    { roomId, message: {...} }        # full message — edit + async link-preview hydration
message_deleted   { roomId, messageId }
message_reaction  { roomId, messageId, userId, emoji: string | null }
typing            { roomId, userId, isTyping }
read              { roomId, userId, lastReadAt }
```

**Implemented today:** all of the above (see `ws-events.ts` — the source of truth the frontend copies). The following are **specified but NOT yet emitted** by `chat.gateway.ts` — do not build the frontend against them until they ship:

```
participant_add    { roomId, userId }     # NOT IMPLEMENTED — see backlog quill-5
participant_remove { roomId, userId }     # NOT IMPLEMENTED — see backlog quill-5
```

`message_reaction` is a **delta, not a snapshot** — deliberately, and it is only safe to be one because the model is one-reaction-per-user: `{userId, emoji}` is a *complete* statement of that user's state on that message, so applying it is idempotent and two different users' events commute in any arrival order. `emoji: null` means the user cleared theirs. A full snapshot would instead be O(participants) bytes on every tap in an apartment-wide room, and two concurrent snapshots could arrive out of order and silently lose a reaction. The aggregated per-emoji buckets live on `MessageRes.reactions` (history + `message_update`), so a client scrolling back sees reaction state without a second round trip.

### Acks and retries

- `send` returns ack `{ messageId, createdAt }`. Client uses `clientTempId` to reconcile optimistic UI.
- Default Socket.IO ack timeout: 10s. Client retries on timeout. (NOTE: server-side dedup on `clientTempId` is not yet implemented — see backlog quill-3; a retry currently creates a duplicate row.)
- On reconnect: client requests `GET /rooms/{id}/messages?after=<createdAt of last received message>` to backfill forward (oldest-first). Scroll-up uses `?before=<createdAt of oldest loaded>` (newest-first). Both bounds exclusive; pass only one per call.

---

## Monolith integration (replaces TalkJS today)

The integration shape stays nearly identical to the current `ChatEventListener` — only the HTTP client changes.

### Replace `TalkJSApi` / `TalkJSService`

```
commons/talkjs/  →  commons/quill/
  TalkJSApi.kt     →  QuillGatewayApi.kt
  TalkJSService.kt →  (deleted; QuillSystemService inside core/chat directly calls QuillGatewayApi)
```

`QuillGatewayApi` is a Feign client with the same shape:

```kotlin
interface QuillGatewayApi {
    @PostExchange("/internal/rooms")
    fun createRoom(@RequestHeader("Authorization") auth: String, @RequestBody req: CreateRoomReq): RoomRes

    @PostExchange("/internal/rooms/{roomId}/participants")
    fun addParticipants(@RequestHeader("Authorization") auth: String, @PathVariable roomId: String, @RequestBody req: AddParticipantsReq)

    @DeleteExchange("/internal/rooms/{roomId}/participants/{userId}")
    fun removeParticipant(@RequestHeader("Authorization") auth: String, @PathVariable roomId: String, @PathVariable userId: String)

    @DeleteExchange("/internal/rooms/{roomId}")
    fun deleteRoom(@RequestHeader("Authorization") auth: String, @PathVariable roomId: String)
}
```

### Event listener becomes thinner

```kotlin
@Component
class ChatEventListener(
    private val chatApiService: ChatApiService,
) {
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    fun onApartmentCreated(event: ApartmentCreatedEvent) {
        chatApiService.createApartmentRoom(event.apartmentId)
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    fun onUserJoinApartment(event: UserJoinedApartmentEvent) {
        chatApiService.addUserToApartmentRoom(event.userId, event.apartmentId)
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    fun onUserLeaveApartment(event: UserLeftApartmentEvent) {
        chatApiService.removeUserFromApartmentRoom(event.userId, event.apartmentId)
    }
}
```

**No `UserCreatedEvent` or `UserUpdatedEvent` listeners** — Quill doesn't mirror user profiles. The frontend hydrates sender info from urbancare's existing `/api/apartment/{id}/members` endpoint.

### `ChatDoc` / `ChatRepository` change

Today: `ChatDoc(apartmentId)`. After: drop entirely OR repurpose to store the room id Quill returned. Simpler is to store `apartmentRoomId: String` directly on `ApartmentDoc` and delete the `chats` collection.

### Frontend (`urbancare_front`) changes

- Add `/api/chat/session` endpoint (mints signature).
- Replace `@talkjs/react` with `socket.io-client`.
- Delete `Chat.tsx`, `ChatProvider.tsx`, related files.
- Build chat UI from scratch — see "Frontend features" below.

### Push notifications

Quill emits an internal event to the calling app's backend, which then calls FCM:

```
POST {app_callback_url}/internal/quill/notify
  Authorization: Bearer <signed by Quill's outbound key per app>
  Body: { userId, roomId, message: {...} }
```

The monolith owns Firebase Admin SDK already; it handles the actual FCM push. Quill stays focused on chat.

**Selection rule**: fan out to message recipients only — skip the sender and skip users with active WS connections. Throttle to one push per (user, room) per 10s to avoid spam.

---

## Frontend features (in calling apps, not in Quill)

Quill ships a backend. Each consuming app builds its own chat UI. For urbancare_front specifically:

### Effort estimates (recorded for planning)

| Feature | Effort | Notes |
|---|---|---|
| Room list + active room view + composer | 5-7 days | Foundation |
| Real-time delivery via WS | included | Built on `useChatSocket` hook |
| Optimistic sending + retry | 1 day | |
| Typing indicators | 0.5 day | Server emits `typing` event |
| Read receipts | 0.5 day | Built on `lastReadAt` |
| Image / file attachments | 1 day | Reuse `FileService.uploadProtectedFile` |
| Emoji picker | 0.5 day | `emoji-picker-react`, desktop only (mobile uses OS keyboard) |
| Voice messages | 3-5 days | MediaRecorder + waveform via wavesurfer.js, hold-or-tap UX |
| Link previews | 1-2 days | **Server-side fetch** in Quill, with SSRF protections (block private IPs, size cap, redirect cap) |
| Push notifications | 1 day | Wire FCM in monolith via Quill callback |
| Mobile (Flutter) parity | TBD | After web is done |

### Frontend structure (urbancare_front)

```
src/
  app/(home)/apartment/[apartmentId]/chat/
    page.tsx                  → ChatLayout (list + active room)
  components/chat/
    ChatRoomList.tsx          → rooms with last message + unread badge
    ChatRoom.tsx              → message thread + composer for one room
    MessageList.tsx           → virtualized, infinite-scroll-up
    MessageBubble.tsx         → sender, content, time, grouping
    Composer.tsx              → autosize textarea, send-on-enter
    EmojiPicker.tsx           → desktop-only popover
    VoiceRecorder.tsx         → MediaRecorder + waveform
    LinkPreviewCard.tsx
    TypingIndicator.tsx
    ReadReceipts.tsx
  hooks/chat/
    use-chat-session.ts       → mints + caches signature from /api/chat/session
    use-chat-socket.ts        → singleton WS, reconnect, subscription registry
    use-room-messages.ts      → infinite query for history, merges WS messages
    use-room-list.ts
  service/
    chat-service.ts           → wrappers around socket.emit and the few REST endpoints
  model/dto/
    chat.dto.ts               → Room, Message, ChatEvent (matches Quill server types)
```

`use-chat-socket.ts` is the load-bearing piece — single shared WS connection across the app, context-exposed, with reconnection + missed-message backfill. Budget a day to get this right.

---

## Project structure (Quill itself)

```
quill/
├── package.json
├── package-lock.json
├── tsconfig.json
├── nest-cli.json
├── Dockerfile                              # node:22-alpine + dist
├── .env.example
├── README.md
├── CLAUDE.md                               # ← this file
└── src/
    ├── main.ts                             # bootstrap, Socket.IO adapter
    ├── app.module.ts
    ├── auth/
    │   ├── app-registry.service.ts         # env-backed Map for MVP
    │   ├── ws-session.guard.ts             # validates signature on WS handshake
    │   ├── internal-key.guard.ts           # for /internal/** endpoints
    │   └── auth.module.ts
    ├── room/
    │   ├── room.controller.ts              # /internal/rooms
    │   ├── room.service.ts
    │   ├── room.schema.ts                  # Mongoose schema for chat_rooms
    │   └── room.module.ts
    ├── participant/
    │   ├── participant.schema.ts
    │   ├── participant.service.ts
    │   └── participant.module.ts
    ├── message/
    │   ├── message.controller.ts           # GET /rooms/{id}/messages
    │   ├── message.service.ts
    │   ├── message.schema.ts
    │   ├── link-preview.service.ts         # OG scraper with SSRF guards
    │   └── message.module.ts
    ├── ws/
    │   ├── chat.gateway.ts                 # @WebSocketGateway, Socket.IO event handlers
    │   ├── connection-registry.service.ts  # in-memory userId → Set<Socket>
    │   └── ws.module.ts
    ├── push/
    │   ├── push.service.ts                 # callback POST to app backend
    │   └── push.module.ts
    └── common/
        ├── exceptions/                     # ApiException + filter
        ├── config/                         # @nestjs/config schema
        └── shared-events.ts                # WS event payload types (shareable with frontend)
```

### Naming conventions

Follow Nest's standard `kebab-case` for filenames, `PascalCase` for classes. **Modules by domain** (room, participant, message, ws, auth) — not by role like the monolith. NestJS doesn't have urbancare_monolith's `{Module}{Role}Service.kt` convention; module-per-domain is the Nest idiom.

The `room/`, `participant/`, `message/` boundary is intentional — although they share a "chat" concept, they have distinct lifecycles (rooms created independently, participants added/removed independently, messages constantly flowing). Co-locating them under `chat/` is fine if it grows unwieldy; start modular.

---

## Known gaps & hardening backlog

Findings from a TalkJS-vs-Quill architecture review (2026-05). Tackle gradually — ordered by priority. Each item names the real problem, the concrete fix (corrected against the actual code), and the files. Items marked **rejected** were considered and deliberately declined; **skip** items are recorded so the omission is a decision, not an oversight.

> Context on the verdict: Quill's big bets are sound — it copied the parts of TalkJS that scale (`lastReadAt` watermark over per-message `readBy`; caller-supplied room IDs; no profile storage; notifications delegated to the app via callback) and dropped the parts that don't. The gaps below are mostly correctness/security seams in the message-delivery path, plus doc-vs-code drift that would inject bugs into the frontend build.

### Now — message-delivery correctness/security (cheap before the frontend ships)

- [ ] **Reject empty messages.** `content` is `@IsString() @MaxLength(4000)` with no minimum and the schema defaults it to `''`, so `{content:''}` with no attachments persists a junk row and broadcasts an empty bubble to the whole apartment. Fix in the single choke point both WS and REST funnel through — `MessageService.send()` (`src/message/message.service.ts`): trim `content`, reject when trimmed length is 0 **AND** no attachments (throw `ApiException(ExcKey.EMPTY_MESSAGE, …, 400)`), and persist the trimmed value. Do **not** put `@MinLength(1)` on `content` alone — it would wrongly reject valid attachment-only messages. (`message.dto.ts`, `ws/ws-events.ts` may carry an optional fast-fail validator, but the service is the source of truth.)
- [x] **Forward (`after=`) history pagination so reconnect backfill works.** *(Done 2026-06.)* `findForward()` in `message.repository.ts` (`createdAt: {$gt}`, sort asc, cap 100); `MessageService.history` accepts `after`, shares an ISO parser with `before`, rejects both supplied (400); `after` query param wired in the controller. The `(createdAt,_id)` tuple-cursor tie-break is deferred as noted.
- [ ] **Force-unsubscribe removed users + emit roster events.** `onSubscribe` checks participation only at subscribe-time; `ParticipantService.remove()` deletes the row but never kicks the socket, so a removed resident keeps receiving live broadcasts until they disconnect (authorization seam). In `remove()`, after the DB delete, loop **every** socket from `ConnectionRegistry.socketsFor(appId,userId)` (multiple tabs/devices) and `socket.leave(roomChannel(appId,roomId))` — this is the load-bearing fix and must run unconditionally. Then emit the spec'd `participant_add`/`participant_remove` to the room channel. **Wiring:** publish via a small leaf `RoomBroadcaster` (or Nest `EventEmitter2`) that `ParticipantService` writes and the gateway consumes — do **not** inject the Socket.IO `Server` into `ParticipantService` (`WsModule` already imports `ParticipantModule`; inverting it risks a circular dep). Single-instance only; `socket.leave` is process-local — revisit with the deferred Redis adapter.

### Soon

- [ ] **Dedup sends on `clientTempId`.** CLAUDE.md tells clients to retry on the 10s ack timeout, but nothing dedups → a write that lands after timeout creates a duplicate broadcast. `clientTempId` is echoed for optimistic UI but never persisted. Make `(appId, roomId, senderId, clientTempId)` an idempotency key: a **partial** unique index (`partialFilterExpression: { clientTempId: { $exists: true } }` — not sparse, and **no TTL** — a Mongo TTL deletes the whole message doc), plumb `clientTempId` through `send()` + `repo.create()`, then catch `isDuplicateKeyError` (helper in `common/utils/mongo-errors.ts`) and re-query to return the original. Sends that omit `clientTempId` are excluded from the index and behave as today.
- [ ] **Build the `PushService` callback stub + pin reverse-auth** (resolves open-question #2). Fire-and-forget in `ChatGateway.onSend` **after** the broadcast emit (not in `MessageService.send()`, which future REST sends reuse and which owns no broadcast); never block the ack. Recipients = room participants − sender − `ConnectionRegistry.hasActive()`; throttle 1/(appId,userId,roomId)/10s (in-memory Map, single-instance). Contract: `POST {callbackUrl} { userId, roomId, message }` with `X-Quill-Signature = HMAC-SHA256(rawBody, appPrivateKey)` (reuse the user-sig crypto primitive, zero new secrets; monolith verifies over the raw bytes). Add an optional `callbackUrl` to `chat_apps` **and** a `PATCH /admin/apps/:appId { callbackUrl }` to set it (else the field is dead). Decide replay protection explicitly (body-only signing matches Quill's no-expiry philosophy; add a timestamp only if needed — note: the `timestamp + "." + body` scheme is *Stripe's*, not TalkJS's).
- [x] **Reconcile the WS protocol doc with shipped code** *(Done 2026-06.)* `read` now documented as `{roomId, upTo: ISO}` (watermark); reconnect documented as `?after=` (forward) / `?before=` (scroll-up); `participant_add`/`participant_remove`/`message_update` flagged NOT IMPLEMENTED in the Server→client section so the frontend doesn't build against them.

### Later — cheap internal hardening

- [ ] **`room.upsert` race → typed exception.** `RoomRepository.upsert` (`src/room/room.repository.ts`) throws a raw `Error('…disappeared after upsert')` if a DELETE races it, surfacing to the monolith Feign caller as an opaque 500 `UNHANDLED`. Add `ExcKey.CONFLICT` and throw `ApiException(ExcKey.CONFLICT, …, 409)` — **not** `ROOM_NOT_FOUND`/404 (the upsert *succeeded*, then raced). Skip the "retry once" — the path is effectively unreachable in the apartment-room-creation flow.
- [ ] **Format-validate the signature header to 64 hex** before comparison, for input-validation consistency with the appId/userId ObjectId checks (lets you drop the `try/catch` around `Buffer.from` in `signature.ts`). Add a shared `SIGNATURE_REGEX = /^[0-9a-f]{64}$/` next to `OBJECT_ID_REGEX`; reject in `SignatureGuard` + `verifyWsHandshake`. Note: frame this as validation hygiene, **not** as closing a timing oracle — the length compare leaks only "is it 64 chars," which the attacker already knows; the real compare is already `timingSafeEqual`. Handshake rate-limiting stays deferred (open-question #5).
- [ ] **Index `chat_rooms` on `(appId, deleted)`** (`room.schema.ts`, same explicit style as `MessageSchema.index`). Point lookups are fine today; this is forward-looking for a future "list active rooms for app" query. (No participant index needed — `findByRoom(appId,roomId)` is already served as a prefix of the unique `(appId,roomId,userId)` index.)

### Rejected (considered, declined)

- **Pluggable `verifyCredential` seam for future JWT** — YAGNI. Only two call sites (`signature.guard.ts`, `ws-session.guard.ts`), already adjacent; the client contract lives in the monolith + frontend, which a Quill-internal seam never touches. If JWT is ever needed it's a ~4-line local refactor then. (Non-expiring HMAC is a deliberate, documented choice — see "Signature format".)
- **Add a per-participant `notify`/mute column now, defer the UI** — on Mongo an optional field with a default applies on read with zero backfill/downtime, so there's no migration cost to pre-empt. Adding it ahead of its only consumer (`PushService`) is a speculative dead field. Add `notify` *in the same change* that builds the push selection rule that reads it.

### Skip (correct anti-goals; revisit only if a second consuming app demands them)

Per-message `readBy` (TalkJS's own ~≤300-participant cap is the evidence this is the wrong call for apartment-wide rooms), ~~emoji reactions~~ (**reversed 2026-08 — shipped, see below**), threaded replies, ~~message edit/delete~~ (shipped), message search, presence service. Nothing in the schema paints these into a corner — `replyToId` is still reserved as a v2 field, and presence is derivable from `ConnectionRegistry`.

#### Reversal: emoji reactions are now IN (2026-08)

This entry previously read "emoji reactions" as a correct anti-goal, on the reasoning that emoji belong in the calling app's frontend. **The UrbanCare product owner has explicitly asked for message reactions on both clients (web + Flutter), so the decision is reversed deliberately** — recorded here rather than left as doc-vs-code drift.

Why the original reasoning didn't survive contact:

- The anti-goal conflated two different things. An **emoji picker in the composer** genuinely is frontend-only — emoji are just Unicode inside `content`, and Quill never needs to know. A **reaction** is not: it is a per-user mutation of an *existing* message, which is server state by definition. No amount of frontend work can produce it.
- It could not be smuggled through `metadata` either. `metadata` is written once at insert and there was, decisively, **no user-authenticated message-mutation path at all** — `edit` and `remove` are both `/internal`, app-private-key gated. Reactions therefore required the first such path (`react` over WS), which is the actual new capability here.
- The "revisit only if a second consuming app demands them" bar was the wrong bar. It was written for features that add *ongoing* complexity; reactions add one optional schema field, two atomic update ops and one WS event, and cost nothing when unused (absent field → `undefined`, no migration).

What was **kept** from the anti-goals, and is not reversed:

- **No threaded replies. Quill is still not a Slack/Discord.** The reply feature the clients are building is *quote-reply* — a single denormalized reference carried in the app-owned `metadata` bag, fixed at send time, rendered inline above the bubble. That needs **zero** Quill change and is fully compatible with "no threads": there is no sub-conversation, no thread view, no reply count, no `replyToId` on the schema. A real thread view would still need this anti-goal reversed explicitly, and it has not been.
- **No arbitrary emoji picker for reactions.** The reaction set is a fixed, server-validated six (`👍 ❤️ 😂 😮 😢 🙏`, `src/message/reactions.ts`). That is what keeps the reversal cheap: no picker dependency on either client, no grapheme-safe validation problem server-side (skin-tone modifiers and ZWJ sequences are simply rejected), and a bounded per-message bucket count. Composer emoji stay frontend-only as before.
- **No per-message `readBy`.** Reactions look superficially similar — a per-user field on a message — but the cardinality argument is different: `readBy` grows to *every* participant on *every* message, whereas reactions are opt-in, rare, and one entry per reacting user. The `lastReadAt` watermark stays.

See "Reactions" under the data model and the WebSocket protocol section for the shipped shape.

---

## Open questions / deferred decisions

1. **Domain**: `chat.urbancare.ge`? Subdomain per app? Single quill domain across apps? Probably single domain (`quill.example.com` or similar) with `appId` differentiating at the auth layer.
2. **Push callback auth shape**: Quill needs to authenticate itself when calling back into an app's `/internal/quill/notify`. Likely the same per-app key, signed in reverse direction. Define on first push integration.
3. **Migration**: TalkJS message history. Currently on free tier with "Test Mode" banner; assume no migration needed.
4. **Reconcile job**: nightly cron that walks each app's intended membership (queried via app callback) vs Quill's actual participants and fixes drift. Defer until first drift bug surfaces.
5. **Rate limits**: per-user message rate cap to mitigate spam/abuse. Defer until needed; trivial to add as a Nest interceptor.
6. **Logging / audit**: should Quill maintain its own audit trail of room/participant changes? Probably yes — single audit collection (`chat_audit_events`) keyed by `(appId, ...)`. Defer.
7. **Schema migrations**: how do we version Mongoose schemas without downtime? Nest's `OnModuleInit` script approach is fine for v1. Revisit at v2.

---

## Anti-goals

- Quill is not a TalkJS clone in features. No Inbox UI, no built-in widgets, no email-fallback notifications.
- Quill is not a Slack/Discord. No threads, no channels-of-channels, no workspace concept. Apps that need that can model it on top of plain rooms.
- Quill is not a presence service. Online/offline is derived from connection state (`connection-registry`), not a long-lived field. Apps that need rich presence can build on it.
- Quill does not store files. File storage is the calling app's job; Quill stores `fileId` references and trusts the app to resolve them.
- Quill does not validate file types or sizes. The calling app does that at upload time.

---

## References (urbancare-specific context)

- Existing TalkJS integration: `urbancare_monolith/src/main/kotlin/ge/urbancare/core/commons/talkjs/` (`TalkJSApi.kt`, `TalkJSService.kt`, `TalkJSRequests.kt`) — to be deleted.
- Existing chat module: `urbancare_monolith/src/main/kotlin/ge/urbancare/core/chat/` — `ChatEventListener.kt` keeps the same shape with the listener body swapped to `QuillGatewayApi` calls.
- Existing frontend chat: `urbancare_front/src/components/chat/Chat.tsx`, `src/components/provider/ChatProvider.tsx` — to be deleted and rebuilt.
- Spring event conventions urbancare uses (BEFORE_COMMIT vs AFTER_COMMIT, async listener actorId rule) — see `urbancare_monolith/CLAUDE.md`.

---

## Roadmap (rough)

| Phase | Scope | Estimate |
|---|---|---|
| 0. Scaffold | Nest project, Mongoose schemas, env-backed app registry, guards | 1-2 days |
| 1. REST internals | Create room, add/remove participants, soft-delete room | 2-3 days |
| 2. WebSocket + send/receive | Connection auth, subscribe, send, broadcast, ack | 3-4 days |
| 3. History + read receipts | Paginated message history, lastReadAt | 1-2 days |
| 4. Monolith integration | Swap TalkJSService → QuillGatewayApi, `/api/chat/session` endpoint | 1-2 days |
| 5. Frontend rebuild (urbancare_front) | useChatSession, useChatSocket, room list, active room, composer | 5-7 days |
| 6. Polish | Optimistic sends, typing, read receipts, attachments | 3-5 days |
| 7. Voice + emoji + link previews | See feature table above | 5-8 days |
| 8. Push notifications | Callback to monolith → FCM | 1-2 days |
| 9. Cutover | Feature flag toggle, deprecate TalkJS code | 1 day |

**Total realistic: ~5-6 weeks of focused solo work to fully replace TalkJS.**
