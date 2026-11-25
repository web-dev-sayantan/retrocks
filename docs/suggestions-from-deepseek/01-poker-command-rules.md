# Pointing Poker Command Rules

> Status: partially implemented. Deck validation parity is the next slice.

## Current checkout

- [Discard policy](../../src/lib/poker-discard-policy.ts) already makes a shared decision from intent, round identity, phase, and whether votes exist. Story selection and Room closure can require confirmation for an empty unresolved round. The other discard-sensitive commands require votes. The [controller](../../src/lib/poker-controller.ts) coordinates confirmation and single-flight changes, and [Room storage](../../src/server/poker/room.ts) checks the round identity again before committing.
- [Deck policy](../../src/lib/poker-deck-policy.ts) shares unchanged-Deck detection. [Poker schemas](../../src/lib/poker-schemas.ts) define the authoritative custom Deck, Story title, and Room name input rules; presets come from the shared Deck definition. A stale discard confirmation already has a common server error. Prompts and required-confirmation messages reflect the command's consequences.
- The controller still implements optimistic Story and Deck updates separately from the authoritative transitions. For example, optimistic Deck normalization drops blank choices, while the schema rejects blank entries in structured input. [Deck settings](../../src/components/poker/PokerDeckSettings.tsx) already treats blank lines as separators when building that input.

## Remaining proposal

As a Facilitator, I want Deck settings, the optimistic Room, and the server to agree on whether the submitted Deck is valid and whether it changes the Room.

1. Reuse the existing Deck schema for validating and normalizing structured choices before deriving an optimistic update. Keep text-to-list parsing in the editor. Use the existing Deck equality and discard decisions for accepted input.
2. Preserve a no-op for an unchanged Deck. On confirmed discard, the optimistic view clears the old round until the server returns the replacement round with its authoritative ID. Preserve the existing stale-confirmation error if the round changes while the prompt is open.
3. For later Story work, extract a shared decision only where both the optimistic view and authoritative write need it. Active Story edits and lock/delete transitions are candidates. Retitling an active Story restarts an unresolved round, while locking or deleting the active Story clears the stage. Preserve current command behavior, including the fact that the authoritative `move-story` allows reordering a Locked Story. Estimate corrections compare the expected Accepted Estimate, while Votes are scoped to a Voting Round ID.

Keep server-side role checks, ballot projection, ID generation, and writes in the authoritative implementation. Use phase, vote presence, and viewer-visible facts for shared decisions. The [Voting Round discard spec](../voting-round-discard-policy-spec.md) remains the reference for when to prompt and how to handle stale confirmations.

## Verification

Extend the [schema tests](../../src/lib/poker-schemas.test.ts), [controller tests](../../src/lib/poker-controller.test.tsx), and [server Story queue tests](../../src/server/poker/story-queue.test.ts) around the affected interfaces. Cover invalid structured choices, unchanged presets and custom Decks, an empty unresolved round, a confirmed discard with votes, and a stale confirmation. Check the optimistic view during the write as well as the committed result. Keep rollback, role checks, and ballot privacy covered at their existing interfaces.
