# Board Permission Table

> Status: ready-for-agent
> Source: architecture review, 24 November 2026

## Problem Statement

A Participant can see a control enabled for an action the server will reject, or disabled for an action the server would allow. The client permission module is a hand-written mirror of server enforcement, and its comments cite server line numbers. The controller then recomposes the same predicates in a mutation gate. Three test suites verify one policy from three directions. When a rule changes, the interface and the server can disagree without either suite failing, because both suites were written against their own copy.

## Solution

Put the Board permission policy in one table. Each rule receives a small set of facts, not raw storage rows: whether the actor is a Facilitator, whether the Board is Locked or in Private Mode, whether the actor authored a Card or comment, whether the actor can see it, pending state, Action Item state, Column counts, and Vote balances. The server adapter computes those facts from authoritative rows and hashes; the client adapter computes them from the projected Board. Both call the same decision. The server still enforces; the client uses the same decision to gate controls and optimistic attempts.

## User Stories

1. As a Participant, I want to edit, move, and delete my own Cards on an unlocked Board, so that I can refine my contribution.
2. As a Participant, I want to be unable to edit or delete another Participant's revealed Card, so that authorship is respected.
3. As a Facilitator, I want to manage any revealed Card on an unlocked Board, so that I can facilitate cleanup.
4. As a Facilitator in Private Mode, I want to be unable to manage another Participant's redacted Card, so that zero-peeking applies to me too.
5. As a Participant, I want a redacted Card to reject reactions, comments, Votes, and grouping until reveal, so that Private Mode cannot be bypassed through a side action.
6. As a Participant on a Locked Board, I want every content-changing control disabled and every write rejected, so that the retrospective stays read-only.
7. As a Facilitator on a Locked Board, I want to check off and annotate existing Action Items, so that follow-up can continue without unlocking the Board.
8. As a Facilitator, I want to toggle Board settings, Column controls, Private Mode, Blind Voting, the timer, and Locked state under one consistent Facilitation rule, so that controls do not disagree about my role.
9. As a Facilitator, I want to delete a Column only when it is not the last Column and contains no redacted Cards, so that Private Mode and empty-Board rules are enforced in one place.
10. As a Participant, I want grouping to be available only when the Facilitator allows participant grouping, so that the Board setting is honored everywhere.
11. As a Participant, I want a Card Group with another Participant's Card to stay non-manageable in Private Mode, so that a group cannot reveal or delete somebody else's Card.
12. As a Participant, I want to delete my own comment, and a Facilitator to delete any revealed comment, so that moderation works without exposing author hashes.
13. As a Participant, I want a Vote cast to respect the remaining Board balance and the per-Card cap, so that the interface does not offer a Vote the server will reject.
14. As a Participant, I want Blind Voting to hide totals without blocking my own Vote, so that the permission rule does not confuse visibility with eligibility.
15. As a Participant, I want a pending optimistic Card to reject interactions until the server confirms it, so that I cannot act on a placeholder.
16. As a Participant, I want a Facilitator to add a Column only below the Column cap, so that the cap is visible before the attempt.
17. As a Participant, I want a rejected action to produce the same code and message no matter which control sent it, so that feedback is predictable.
18. As a Participant, I want a disabled control to explain why it is disabled when the reason is not obvious, so that I know whether to reveal, unlock, or ask a Facilitator.
19. As a maintainer, I want one permission table keyed by action intent, so that the client gate, the controller gate, and the server checks cannot drift.
20. As a maintainer, I want the table to receive computed facts instead of raw hashes, so that the client never needs a secret to evaluate a rule.
21. As a maintainer, I want the client and server adapters to prove parity with the same scenario matrix, so that Private Mode and Locked exceptions are tested once.
22. As a maintainer, I want the permission module to have no SQL, no reactivity, and no server imports, so that it is testable in isolation.
23. As a maintainer, I want to remove the line-number citations and the duplicated predicate comments, so that the source stops depending on server layout.

## Implementation Decisions

- Introduce a Board permission table keyed by action intent. Intents cover Board rename, timer, Private Mode, Locked state, Board deletion, Voting settings and reset, Vote change, Card create/update/move/delete, reaction, comment create/delete, Card Group merge/rename/ungroup/dissolve/move, Action Item patch, Column add/update/reorder/delete, and facilitator capability rotation.
- The table accepts a facts object with only the values a rule needs: actor role, Board Locked and Private Mode state, participant-grouping setting, Card authorship and visibility, Card pending and Action Item state, comment authorship and Card visibility, Card Group visibility and all-members-authored state, Column count, Cards in the target Column, redacted-Card presence, remaining Votes, per-Card cap, and current Votes on the target.
- The decision shape is an allow or a deny with a stable code and message. The table does not mutate state, load data, or publish events.
- The server adapter computes facts from raw rows and token hashes. The client adapter computes facts from the viewer-projected Board: `isMine` becomes authorship, `redacted` becomes visibility, and `isFacilitator`/`isLocked`/`isBlurred`/`remainingVotes` are already present. Raw hashes never enter the shared table.
- The controller's mutation gate and the UI predicates consume the shared table. Do not keep a second client mirror or recombine predicates in the controller.
- Preserve the existing policy. The locked gate, the Facilitator Action Item exception, Private Mode blinding of Facilitators, the participant-grouping setting, the Column-delete conditions, and the Vote balances are decisions to encode, not to re-litigate.
- Represent the Facilitator comment rule through `commentIsAuthor`, so the client can allow a Facilitator to delete any revealed comment without comparing hashes. Remove the old `!isBlurred` workaround that existed only because authorship was unavailable.
- Keep server enforcement after the table decision. The table is the shared policy; the server still validates the loaded state and rejects stale facts.
- Keep the table independent of the Board command channel. If the command channel is adopted, its registry gate field references a permission intent; if not, the controller and UI reference the same intent directly.
- Keep messages canonical. One denied intent has one message, regardless of whether it came from a disabled control, the controller gate, or the server.
- Preserve ADR-0001: anonymous capability tokens still supply server facts; the table never sees a token or hash.

## Testing Decisions

- Primary seam: the permission table's `decide(intent, facts)` interface. Client and server adapters prove parity around it.
- A good test calls the permission table with an intent and facts, then asserts allowed or denied and the message. It should not inspect internal predicate names.
- Build a table-driven matrix for every intent across role, Locked state, Private Mode, authorship, visibility, pending state, group membership, Column counts, and Vote balances.
- Add parity tests: for the same scenario, authoritative facts and projected facts produce the same decision. Include Private Mode Cards, Facilitator redaction, pending Cards, and group membership.
- Test the server adapter through the existing Board mutation dispatcher against the in-memory Node SQLite store, asserting that a denied intent performs no write and an allowed intent persists.
- Test the controller gate through the Board controller with a fake command dispatcher, asserting no command is sent for a denied intent and optimistic state does not change.
- Test UI controls through their rendered interfaces, asserting disabled and hidden states for the same scenarios. Keep these tests focused on wiring and labels, not on re-deriving the table.
- Delete duplicate permission assertions that only restate the same rule in a client suite and a server suite. Keep the shared matrix and adapter contract tests.
- Prior art: the existing Board permission tests, the Board authorization tests, and the Board controller gate tests.

## Out of Scope

- Changing the product permission policy or the Board permission matrix.
- Changing ADR-0001 anonymous capability tokens or the session shape.
- Changing SQL enforcement, transactions, or the Board store seam.
- Consolidating the Board command channel, although the two specs compose.
- Redesigning Board controls, drawers, or disabled-state visuals.
- Server-side Private Mode or Blind Voting projection; the table consumes its facts and does not perform redaction.
- Rate limits and Board expiry, which are not permission rules.

## Further Notes

- The table is the authoritative statement of policy, but the server adapter remains the enforcement point. A client decision never authorizes a write.
- If a rule genuinely differs between client and server, encode the difference as a fact or an explicit intent variant and test it. Do not fork the table.
- This spec removes the need for line-number citations in permission comments. The intent name and the matrix row become the traceability.
