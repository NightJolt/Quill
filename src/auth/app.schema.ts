import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * A registered Quill tenant. The document's `_id` IS the `appId` referenced
 * by every chat_rooms / chat_participants / chat_messages row.
 *
 * `label` is the friendly name used in logs and (eventually) admin UIs —
 * derived on boot from the env var name (e.g. `QUILL_APP_URBANCARE_ID` →
 * label="urbancare"). Updates on every boot from env so renaming the env
 * var label propagates without manual DB edits.
 *
 * The private key is **NOT** stored here — it's env-only. This collection
 * exists for observability and as the actual referent of appId; auth
 * verification stays in env.
 *
 * Deleting an env var for an app does NOT delete the chat_apps row. The
 * row remains as historical record; the registry just stops authenticating
 * that appId. Manual delete is fine when you're sure.
 */
@Schema({ collection: 'chat_apps', timestamps: { createdAt: true, updatedAt: false } })
export class App {
  @Prop({ required: true, unique: true })
  label!: string;

  /**
   * Envelope-encrypted private key — `base64(IV || ciphertext || authTag)`,
   * AES-256-GCM under `QUILL_MASTER_KEY` (see KeyVault). Replaces env-stored
   * keys: chat_apps is now the source of truth for app secrets, with
   * defense-in-depth via the master-key indirection.
   *
   * Optional in the type because freshly-migrated rows may not have it yet;
   * after Phase 3 cutover this becomes required at runtime via filter
   * `{ encryptedKey: { $exists: true } }` in registry loads.
   */
  @Prop()
  encryptedKey?: string;

  @Prop({ type: Date })
  rotatedAt?: Date;

  /**
   * Absolute `http(s)` URL Quill POSTs a notify callback to after every
   * successfully-sent message in this tenant (see `PushService`). The app
   * backend turns that into whatever notification/push it wants; Quill relays
   * the message verbatim and never interprets it.
   *
   * **Absent means no callback is ever fired** — that is the intended "off"
   * state, not a misconfiguration, and it is how every app starts. Set it with
   * `PATCH /admin/apps/:appId { callbackUrl }`; the same route clears it with
   * `null`.
   */
  @Prop()
  callbackUrl?: string;

  /**
   * Soft-delete flag. Revoked apps stop authenticating but their rows stay
   * (rooms/messages remain readable for archival). Set true by
   * `DELETE /admin/apps/:appId`.
   */
  @Prop({ default: false })
  revoked!: boolean;

  createdAt!: Date;
}

export type AppDocument = HydratedDocument<App>;
export const AppSchema = SchemaFactory.createForClass(App);
