import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AttachmentType, Message, MessageDocument } from './message.schema';

/**
 * Mongo data access for `chat_messages`. Pure queries.
 */
@Injectable()
export class MessageRepository {
  constructor(@InjectModel(Message.name) private readonly messages: Model<Message>) {}

  /**
   * `fileId` arrives as a string here (validated by `@IsMongoId()` on the
   * inbound DTO); Mongoose casts to ObjectId on save via the schema type.
   */
  create(args: {
    appId: string;
    roomId: string;
    senderId: string;
    content: string;
    attachments?: Array<{
      type: AttachmentType;
      fileId: string;
      mimeType?: string;
      sizeBytes?: number;
      durationMs?: number;
    }>;
    metadata?: Record<string, unknown>;
  }): Promise<MessageDocument> {
    return this.messages.create(args);
  }

  /**
   * Paginated history newest-first. `before` is exclusive — pass the
   * `createdAt` of the oldest already-loaded message to fetch the next
   * page (scroll-up). Hard cap of 100 per page.
   */
  findHistory(
    appId: string,
    roomId: string,
    before: Date | undefined,
    limit: number,
  ): Promise<MessageDocument[]> {
    const filter: Record<string, unknown> = { appId, roomId };
    if (before) filter.createdAt = { $lt: before };
    return this.messages
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 100))
      .exec();
  }

  /**
   * Forward pagination, oldest-first. `after` is exclusive — pass the
   * `createdAt` of the newest message the client already has to fetch what
   * arrived since (reconnect / missed-message backfill). Ascending so a
   * client behind by more than `limit` can keep advancing `after` to the
   * newest received. Same `(appId, roomId, createdAt)` index, hard cap 100.
   */
  findForward(
    appId: string,
    roomId: string,
    after: Date,
    limit: number,
  ): Promise<MessageDocument[]> {
    return this.messages
      .find({ appId, roomId, createdAt: { $gt: after } })
      .sort({ createdAt: 1 })
      .limit(Math.min(limit, 100))
      .exec();
  }

  /**
   * Single message lookup, scoped by `(appId, roomId)` so a caller can only
   * reach a message inside the tenant + room it named — a manager moderating
   * apartment A can't touch a message keyed to apartment B even with its id.
   */
  findById(appId: string, roomId: string, id: string): Promise<MessageDocument | null> {
    return this.messages.findOne({ _id: id, appId, roomId }).exec();
  }

  // ── Windowed reads around an anchor message ──────────────────────────────
  //
  // These two back `GET /rooms/{id}/messages/around/{messageId}` (jump to a
  // reply target that isn't in the loaded window). They differ from
  // {@link findHistory} / {@link findForward} in two deliberate ways:
  //
  //   1. **Full `(createdAt, _id)` tuple cursor.** The shipped `before=` /
  //      `after=` routes cursor on `createdAt` alone, so two messages sharing a
  //      millisecond can be skipped or repeated at a page boundary. Anchoring
  //      on a *message* rather than a timestamp lets us close that gap here
  //      without touching the shipped cursor semantics both clients are built
  //      on. The `$or` is the standard keyset form: strictly past the anchor's
  //      timestamp, or level with it and past its `_id`.
  //   2. **`limit + 1`.** The extra row is the has-more probe — the service
  //      reports `hasMoreBefore` / `hasMoreAfter` from whether it came back and
  //      then drops it. `limit` may legitimately be 0 (caller wants only one
  //      side of the window), and `.limit(0)` means *unlimited* in Mongo, so
  //      the `+ 1` also keeps that case from fetching the whole room.
  //
  // Served by `{appId: 1, roomId: 1, createdAt: -1, _id: -1}` — the trailing
  // `_id` is what lets the `(createdAt, _id)` sort walk the index instead of
  // materialising and sorting the whole room on every jump.

  /** Messages strictly older than the `(at, id)` anchor, newest-first, `limit + 1` deep. */
  findBeforeMessage(
    appId: string,
    roomId: string,
    at: Date,
    id: string,
    limit: number,
  ): Promise<MessageDocument[]> {
    return this.messages
      .find({
        appId,
        roomId,
        $or: [{ createdAt: { $lt: at } }, { createdAt: at, _id: { $lt: id } }],
      })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .exec();
  }

  /** Messages strictly newer than the `(at, id)` anchor, oldest-first, `limit + 1` deep. */
  findAfterMessage(
    appId: string,
    roomId: string,
    at: Date,
    id: string,
    limit: number,
  ): Promise<MessageDocument[]> {
    return this.messages
      .find({
        appId,
        roomId,
        $or: [{ createdAt: { $gt: at } }, { createdAt: at, _id: { $gt: id } }],
      })
      .sort({ createdAt: 1, _id: 1 })
      .limit(limit + 1)
      .exec();
  }

  /** Persist in-place mutations (edit / soft-delete) made by the service. */
  save(doc: MessageDocument): Promise<MessageDocument> {
    return doc.save();
  }

  // ── Reactions ────────────────────────────────────────────────────────────
  //
  // Both ops are single atomic `findOneAndUpdate`s against one document path
  // (`reactions.<userId>`), returning the post-image so the service never has
  // to re-read. Concurrency properties:
  //
  //   - Two *different* users hit two different paths → both land, neither is
  //     lost, no conflict.
  //   - The *same* user hitting the same path twice is idempotent — a map key
  //     cannot duplicate.
  //   - The `deleted: false` + `(appId, roomId)` predicates are part of the
  //     same atomic match, so a message that is tombstoned or belongs to
  //     another room/tenant can never be mutated. `null` means "did not
  //     match"; the service disambiguates why.

  /**
   * Set the user's reaction to `emoji` — but only if it differs from what they
   * already have. The `$ne` predicate is what makes toggle-vs-replace decidable
   * in one round trip without a prior read: a match means "replaced or added"
   * (the common case, one op); `null` means either "they already hold this
   * emoji" (→ the caller falls through to {@link clearReaction}) or "the
   * message isn't reactable". `$ne` also matches a *missing* path, so a
   * first-ever reaction is the same single op.
   */
  setReaction(
    appId: string,
    roomId: string,
    id: string,
    userId: string,
    emoji: string,
  ): Promise<MessageDocument | null> {
    return this.messages
      .findOneAndUpdate(
        { _id: id, appId, roomId, deleted: false, [`reactions.${userId}`]: { $ne: emoji } },
        { $set: { [`reactions.${userId}`]: emoji } },
        { new: true },
      )
      .exec();
  }

  /**
   * Remove the user's reaction — but only if it is still `emoji`. Guarding on
   * the value keeps the toggle honest: if the user switched to a different
   * emoji from another device between the two ops, this no-ops rather than
   * clobbering the newer choice.
   */
  clearReaction(
    appId: string,
    roomId: string,
    id: string,
    userId: string,
    emoji: string,
  ): Promise<MessageDocument | null> {
    return this.messages
      .findOneAndUpdate(
        { _id: id, appId, roomId, deleted: false, [`reactions.${userId}`]: emoji },
        { $unset: { [`reactions.${userId}`]: '' } },
        { new: true },
      )
      .exec();
  }
}
