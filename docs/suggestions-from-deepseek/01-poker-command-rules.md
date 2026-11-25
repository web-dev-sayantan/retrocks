# Pointing Poker Command Rules

> Status: ready-for-agent
> Source: architecture review, 24 November 2026

## Problem Statement

A Facilitator acts on a Story from several controls in a Room, and the Room answers in two ways: the interface applies an optimistic change immediately, while the server decides the authoritative result. Today those two answers come from separate implementations of the same rules. A Story switch, lock, delete, Deck change, or title edit can be confirmed under one reading of the Voting Round and rejected under another. Custom Deck choices are validated in four places, and five discard failures share one error code with different copy. Participants see avoidable rollbacks, and maintainers must change a rule twice.

## Solution

Give Pointing Poker one command-rule module. It receives the facts that matter for a command, decides whether the command is allowed, and returns the semantic effects the command has on the Room. The server uses the decision to authorize and persist; the client uses the same decision to apply the optimistic part of the result to the redacted Room view. Story transitions, Locked Story rules, Deck choices, Voting Round discard, and text defaults live in one place and are tested once.

## User Stories

1. As a Facilitator, I want switching Stories during an unresolved Voting Round to prompt for confirmation under the same rule the server enforces, so that I cannot lose votes through a stale or inconsistent prompt.
2. As a Facilitator, I want publishing a new active Story to lock the previous Story and discard an unresolved round only when the policy says so, so that the Story queue and the stage agree.
3. As a Facilitator, I want retitling the active Story to restart unresolved voting exactly when the authoritative command does, so that Participants never vote into a superseded Voting Round.
4. As a Facilitator, I want locking or deleting the active Story to clear the active stage under the same conditions, so that the Room does not show a stage the server has already cleared.
5. As a Facilitator, I want a Deck change to validate preset and custom choices identically on both sides, so that I see the same error before and after the write.
6. As a Facilitator, I want a Deck change with cast votes to restart the Voting Round when the command is accepted, so that old ballots cannot survive into a new Deck.
7. As a Facilitator, I want every discard confirmation tied to the Voting Round I reviewed, so that a round that changed while the dialog was open cannot be discarded by my confirmation.
8. As a Facilitator, I want closing a Room with an unresolved Voting Round to warn about discarding votes, and closing without one to skip the warning, so that the prompt matches the consequence.
9. As a Facilitator, I want Locked Stories to reject title edits, moves, selection, estimate corrections, and deletion with the same reason, so that locked behavior is predictable.
10. As a Participant, I want my vote selection and clearing to appear immediately and revert automatically on rejection, so that voting stays responsive without lying about the result.
11. As a Participant, I want estimate corrections, Story reordering, and Story return actions to apply optimistically only when the server would accept them, so that the queue does not flicker.
12. As a Participant, I want my ballot privacy preserved: the client rule module must never require another Participant's ballot, so that optimistic behavior cannot weaken Blind Voting or reveal-before-reveal.
13. As a Participant, I want a blank Room name to default to Poker Room, Story titles to be trimmed, and invalid Deck choices to be rejected with clear messages, so that text rules match everywhere.
14. As a Participant, I want an optimistic update that the server rejects to roll back to the last authoritative Room snapshot, so that I can trust the stage after an error.
15. As a Participant, I want a Vote or estimate correction that targets a replaced Voting Round to be rejected rather than applied to the new round, so that my action cannot change the wrong voting state.
16. As a Facilitator, I want a Story that is missing or already Locked to produce the same rejection in the interface and on the server, so that a stale queue row cannot cause a misleading optimistic update.
17. As a Facilitator, I want an unchanged Deck or unchanged Story title to be a no-op on both sides, so that saving without edits does not restart voting or bump the Room.
18. As a maintainer, I want one command table to change when a Room command changes, so that I do not have to edit a client reducer and a server switch in lockstep.
19. As a maintainer, I want one shared decision matrix to test both client optimism and server authority, so that the two cannot pass separate tests while disagreeing.
20. As a maintainer, I want server-only facts such as participant hashes, rate limits, and persistence to stay outside the shared rules, so that sharing semantics does not leak authority to the client.
21. As a maintainer, I want the five near-identical ROUND_CHANGED messages to become one decision per command, so that copy and code stay aligned.
22. As a maintainer, I want the rule module to be pure and I/O-free, so that both adapters can test it without SQLite, a browser, or a network.

## Implementation Decisions

- Introduce a Pointing Poker command-rule module whose interface accepts the command, the acting Participant's role and viewer facts, and a command-relevant Room state. It returns either a rejection (code and message) or an accepted decision with semantic effects.
- Semantic effects are expressed in domain terms: rename the Room, set the Deck, add/move/edit/lock/delete/select/return a Story, start/restart/reveal/accept/skip a Voting Round, record/clear a ballot, close/reopen the Room, and apply text defaults. Storage details stay in the server adapter.
- The shared state exposes only the facts needed to decide: open/closed, viewer role and identity, Stories with status, Locked state and Accepted Estimate, active Story id, Deck and Deck type, Voting Round id and phase, whether the round has votes, and the viewer's own choice. It must not require another Participant's ballot.
- The server adapter loads the stored Room, supplies authoritative facts, calls the rule module, then persists the accepted effects inside the existing transaction. Authorization, rate limits, entity id generation, and viewer projection remain server-side.
- The client adapter calls the same rule module against the projected Room, applies the optimistic subset of effects to the keyed optimistic store, and leaves authoritative effects that cannot be represented in the view, such as new ids and participant rosters, to the server response.
- Canonicalize discard policy in the rule module: switching Stories and closing a Room account for an unresolved Voting Round even when empty; publishing an active Story, retitling, locking, or deleting the active Story, and changing the Deck require discard confirmation when the unresolved round has votes. Keep the command-specific effects.
- Canonicalize Locked Story rules: a Locked Story cannot be edited, moved, selected, deleted, or have its estimate corrected; locking an active Story clears the active stage and Voting Round when the policy allows it.
- Canonicalize Deck validation: presets come from one definition; custom choices are trimmed, non-blank, at least two, and unique; an unchanged Deck is a no-op; an accepted change restarts the Voting Round only under the discard policy.
- Canonicalize text defaults: a blank Room name becomes Poker Room, Story titles are trimmed and must be non-blank, and both sides surface the same validation message.
- Keep command identity explicit. Every decision carries the command type and, when relevant, the Voting Round id it was based on. A decision made against a replaced round is rejected as ROUND_CHANGED rather than applied.
- Preserve the existing public result shape: a Room command still returns either an authoritative Room or a typed failure, and the client still exposes one command entry point.
- Keep the server's global properties intact: rate limiting, closed-Room behavior, facilitator capability checks, and the 90-day expiry rule do not move into the shared module.

## Testing Decisions

- Primary seam: the command-rule module's decision interface. The server and client adapters are contract-tested around that one seam.
- A good test crosses the rule module's interface with a command and facts, then asserts the decision and semantic effects. It must not assert the shape of internal predicates or helper calls.
- Build one table-driven matrix covering every command: role, Room open/closed, Story status and Locked state, active Story, Voting Round phase, votes present or absent, discard id matching or mismatched, Deck preset, custom, or unchanged. Assert accepted effects and rejection codes and messages.
- Test the server adapter end-to-end through the existing Room command module against the in-memory Node SQLite adapter, preserving coverage for authorization, atomic writes, rate limits, and live publication.
- Test the client adapter through the Room controller with a fake command executor and fake live transport, asserting optimistic application, rollback on rejection, and no optimistic effect when the rule module rejects.
- Test privacy at the seam: vote, reveal, and estimated-Story decisions must not receive another Participant's ballot.
- Delete duplicated per-side tests that only restate the same rule matrix. Keep UI integration tests that prove controls are wired and confirmations are shown.
- Prior art: the existing Story queue server suite, the Room controller suite, and the Story queue UI suite. Discard-policy cases already exercised there become rows in the shared matrix.

## Out of Scope

- Changing the Pointing Poker storage schema, stored Room shape, or runtime adapters.
- Changing the live-stream wire format, reconnect policy, or presence.
- Redesigning the Story queue, stage, Deck settings, or Room summary.
- Changing ADR-0003 Display Name rules or ADR-0004 reopening semantics.
- Deriving wire types from schemas, a separate protocol hygiene concern.
- Consolidating the Room route lifecycle and version precedence, a separate session concern.
- Authorization beyond the facts needed for command decisions; session and facilitator capability checks stay where they are.
- Changing the client's optimistic store implementation or the server's transaction implementation.

## Further Notes

- This spec generalizes the discard-policy spec already drafted as a companion. That spec remains the detailed confirmation and round-identity reference if both are adopted.
- The rule module is an in-process module: no adapter is needed to test it. Two adapters justify the seam because server and client genuinely differ in facts and effects.
- If the client cannot represent an effect without new server data, the rule module should mark it as a server-only effect rather than widening the Room view. Do not weaken Private Mode, Blind Voting, or Locked semantics to make optimism easier.
- Additive command evolution should require one decision branch and one matrix row, not a new client case plus a new server case plus a new error constant.
