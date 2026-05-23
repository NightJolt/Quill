import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

/**
 * A user's membership in a room. The compound unique index on
 * (appId, roomId, userId) guarantees one participant row per (room, user)
 * inside an app, and prevents cross-app collisions.
 *
 * `roomId` and `userId` are both stored as `ObjectId` (urbancare uses Mongo
 * ObjectIds for both rooms and users — same storage/perf rationale as
 * Room.createdBy). API boundary still talks strings.
 *
 * `lastReadAt` powers unread counts and read receipts; the participant set is
 * also the source of truth for who can subscribe to the room over WS.
 */
@Schema({ collection: 'chat_participants', timestamps: { createdAt: 'joinedAt', updatedAt: false } })
export class Participant {
  @Prop({ required: true, index: true, type: MongooseSchema.Types.ObjectId })
  appId!: Types.ObjectId;

  @Prop({ required: true, index: true, type: MongooseSchema.Types.ObjectId })
  roomId!: Types.ObjectId;

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  userId!: Types.ObjectId;

  @Prop({ type: Date, default: null })
  lastReadAt!: Date | null;

  joinedAt!: Date;
}

export type ParticipantDocument = HydratedDocument<Participant>;
export const ParticipantSchema = SchemaFactory.createForClass(Participant);

// One participant row per (room, user) per app.
ParticipantSchema.index({ appId: 1, roomId: 1, userId: 1 }, { unique: true });
// "Which rooms is this user in?" — drives the rooms-list view.
ParticipantSchema.index({ appId: 1, userId: 1 });
