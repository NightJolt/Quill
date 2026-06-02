import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

/**
 * A chat room. Membership lives in chat_participants — Room is the bare
 * container. `appId` partitions rooms across tenants; every query must
 * filter by it.
 *
 * Identity is `(appId, roomId)`, NOT `_id`. `roomId` is the caller-supplied
 * external id (e.g. urbancare's apartmentId); `_id` is a Quill-internal
 * surrogate. Two different apps may legitimately use the same `roomId` — the
 * compound unique index keys them apart, so tenants stay isolated. (Earlier
 * this collection hijacked `_id` as the roomId, which put every tenant's
 * rooms in one global `_id` namespace and collided across apps; participants
 * and messages already follow this `(appId, X)` pattern.)
 *
 * `deleted` is a soft-delete flag; reads should always include `deleted: false`.
 */
@Schema({ collection: 'chat_rooms', timestamps: { createdAt: true, updatedAt: false } })
export class Room {
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  appId!: Types.ObjectId;

  /** Caller-supplied external id — unique per app, the room's real identity. */
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  roomId!: Types.ObjectId;

  @Prop()
  name?: string;

  @Prop({ default: false })
  deleted!: boolean;

  createdAt!: Date;
}

export type RoomDocument = HydratedDocument<Room>;
export const RoomSchema = SchemaFactory.createForClass(Room);

// One room per (tenant, external id). Replaces the old `_id == roomId` scheme.
// Also serves `appId`-prefix lookups, so no separate single-field appId index.
RoomSchema.index({ appId: 1, roomId: 1 }, { unique: true });
