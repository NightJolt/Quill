# Quill

Multi-tenant chat backend. Replaces TalkJS for urbancare; designed to be reused by future apps.

See `CLAUDE.md` for the full spec — what it is, why it exists, auth model, data model, API surface, integration shape.

## Quick start

```bash
pnpm install
cp .env.example .env       # fill in MONGO_URI and a real QUILL_APP_URBANCARE_KEY
pnpm start:dev
```

Quill boots on `:8086` by default. Health check at `GET /health`.

## Auth model (TL;DR)

Two callers, two credential shapes — both backed by the **same** app private key:

- **App backend → Quill** (`/internal/**` endpoints): `Authorization: Bearer <app private key>`
- **App user → Quill** (Socket.IO + user-facing REST): handshake auth `{ appId, userId, signature }` where `signature = HMAC-SHA256(userId, app private key)`

No expiry on signatures. Access is controlled by the `chat_participants` table, not by token validity. See `CLAUDE.md` for the full rationale.
