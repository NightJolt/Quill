/**
 * The canonical reaction set — the single source of truth for what a client
 * may react with.
 *
 * Deliberately a **fixed, server-validated set** rather than an arbitrary
 * picker. That buys three things:
 *   - no emoji-picker dependency on either client (a hardcoded chip row);
 *   - no grapheme-safe validation problem server-side (an arbitrary picker
 *     would need ZWJ-sequence/skin-tone-modifier aware validation);
 *   - a bounded per-message reaction cardinality (≤ 6 distinct buckets),
 *     so the aggregated wire shape can never blow up.
 *
 * Clients must mirror this list. Two ways to stay in lockstep:
 *   - copy the array (it is re-exported from `ws/ws-events.ts`, the file the
 *     frontends copy), or
 *   - read it at runtime from `GET /config` (unauthenticated, static).
 *
 * Order is meaningful: it is the canonical chip order both clients render in
 * and the order `MessageRes.reactions` is sorted by, so chips never reshuffle
 * as counts change.
 */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

/**
 * Accept-side normalisation table.
 *
 * `❤️` is U+2764 U+FE0F — a base character plus VARIATION SELECTOR-16. Client
 * toolchains disagree about whether a literal keeps the selector (Dart source,
 * JS bundlers and some HTTP/JSON round-trips have all been observed to drop
 * it), so a byte-equality check against the canonical literal would reject a
 * perfectly well-meaning client. We therefore accept the VS16-stripped form as
 * an alias and always *store* the canonical form. Nothing else is aliased —
 * skin-tone modifiers, ZWJ sequences and look-alikes are rejected.
 */
const VARIATION_SELECTOR_16 = /\uFE0F/g;

const CANONICAL_BY_ALIAS: ReadonlyMap<string, ReactionEmoji> = (() => {
  const map = new Map<string, ReactionEmoji>();
  for (const emoji of REACTION_EMOJIS) {
    map.set(emoji, emoji);
    map.set(emoji.replace(VARIATION_SELECTOR_16, ''), emoji);
  }
  return map;
})();

/**
 * Map an inbound emoji string onto its canonical form, or `null` if it is not
 * in the reaction set. This is the only gate — the service rejects `null`
 * with `INVALID_REACTION` and never persists an unvalidated string.
 */
export function canonicalizeReaction(raw: string): ReactionEmoji | null {
  return CANONICAL_BY_ALIAS.get(raw) ?? null;
}

/**
 * Read-side guard. Applied when projecting stored reactions onto the wire so
 * that if the canonical set is ever *narrowed*, rows carrying a retired emoji
 * degrade to "no reaction" instead of shipping an emoji the clients have no
 * chip for. Cheap insurance; no migration needed to retire an emoji.
 */
export function isReactionEmoji(value: unknown): value is ReactionEmoji {
  return typeof value === 'string' && CANONICAL_BY_ALIAS.get(value) === value;
}
