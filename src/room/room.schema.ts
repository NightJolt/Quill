import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

/**
 * A chat room. Membership lives in chat_participants — Room is the bare
 * container. `appId` partitions rooms across tenants; every query must filter
 * by it.
 *
 * `createdBy` is stored as `ObjectId` (mirrors urbancare_monolith's
 * `@Field(targetType = OBJECT_ID)` convention — half the bytes of a hex
 * string, faster comparisons). API boundary still talks strings; the DTO
 * validates 24-char hex via `@IsMongoId()`.
 *
 * `deleted` is a soft-delete flag; reads should always include `deleted: false`.
 */
@Schema({ collection: 'chat_rooms', timestamps: { createdAt: true, updatedAt: false } })
export class Room {
  @Prop({ required: true, index: true, type: MongooseSchema.Types.ObjectId })
  appId!: Types.ObjectId;

  @Prop()
  name?: string;

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  createdBy!: Types.ObjectId;

  @Prop({ default: false })
  deleted!: boolean;

  createdAt!: Date;
}

export type RoomDocument = HydratedDocument<Room>;
export const RoomSchema = SchemaFactory.createForClass(Room);
