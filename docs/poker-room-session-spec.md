# Pointing Poker Room Session

## Problem Statement

Managing a Pointing Poker Room's client lifecycle currently requires navigating four nested route modules and five workspace panels that duplicate state and coordination. Three separate version caches track Room updates across route wrappers and the controller, two separate code paths reopen a closed Room, three separate places scrub the Co-Facilitator Link URL fragment, and five panels each run their own ad-hoc single-flight busy, error, and Voting Round discard confirmation loops without serializing against one another.

## Solution

Deepen the Pointing Poker Room controller into a single route-level Room session module that owns the complete Room lifecycle (unjoined, joined, closed, reopened, unavailable), Co-Facilitator Link fragment claiming and scrubbing, recent-room recording, unified single-flight command execution with shared busy and error state, and centralized Voting Round discard confirmation. Presentational Room panels read derived state from this session seam and dispatch high-level intents without drilling round-ID props or managing independent mutation locks.

## User Stories

1. As a Participant opening a Pointing Poker Room link, I want to enter my Display Name and join the live Room smoothly, so that I can start estimating immediately.
2. As a Facilitator opening a Co-Facilitator Link, I want the URL fragment claimed into my session cookie and scrubbed from the address bar once, whether the Room is live, closed, or unavailable, so that the secret never lingers in browser history.
3. As a Participant, I want Room updates from HTTP mutations and live stream frames reconciled through one monotonic version guard, so that out-of-order responses can never regress the visible Story, Deck, or Voting Round.
4. As a Facilitator closing a Room, I want the Room to transition cleanly to the closed summary view without stale live connections or competing local state, so that all Participants see the final Accepted Estimates.
5. As a Facilitator reopening a closed Room, I want a single consistent reopen flow that transitions the Room back into the Display Name join screen with prior Stories marked as Locked Stories (per ADR-0004), so that returning Facilitators and Participants re-enter cleanly.
6. As a Participant viewing a deleted or expired Room, I want the session to transition immediately to the unavailable state and scrub any sensitive URL fragment, so that I am not stuck on stale controls.
7. As a Facilitator triggering actions across the Story queue, Deck settings, Story title editor, Voting Round controls, or Room close button, I want mutations serialized through one single-flight coordinator, so that concurrent clicks across different panels cannot race or overwrite each other.
8. As a Facilitator, I want Voting Round discard confirmations derived automatically from the current session state, so that Story switching, Story publishing, retitling, locking, deleting, Deck changes, and Room closing all apply consistent discard prompts without prop-drilling round identifiers.
9. As a Participant or Facilitator, I want mutation errors surfaced consistently and cleared predictably on subsequent actions, so that failures never leave a panel stuck in a busy or stale error state.
10. As a Participant, I want recently visited Rooms recorded automatically when entering or renaming a Room, so that my recent-rooms list stays accurate without route-level side-effect duplication.
11. As a maintainer, I want the entire Pointing Poker Room client state machine concentrated in one deep module, so that lifecycle bugs and ADR-0004 transitions are fixed and tested in one place.

## Implementation Decisions

- Hoist the Room session controller to the top-level Room route seam so it lives across all Room phases (unjoined, live/joined, closed summary, reopening, unavailable) rather than mounting only inside an already-joined open Room.
- Consolidate the three competing version caches (reopened Room state, claimed Room state, and controller server Room state) into a single authoritative Room snapshot with monotonic version reconciliation.
- Unify the two reopen paths into one session command that updates the single Room snapshot and tears down or transitions live-stream subscriptions cleanly, respecting ADR-0004 (cleared Participant roster, pending Facilitator claims, and prior Stories marked as Locked Stories).
- Centralize `#f=` Co-Facilitator Link fragment claiming and scrubbing inside the session module (respecting ADR-0001) so route views and closed summaries no longer implement separate fragment scrubbers.
- Own single-flight mutation serialization, pending-command tracking, and error reporting inside the session module so Story queue, Deck settings, Voting Round, Story title editor, and Room close controls do not maintain independent busy/error state machines.
- Centralize Voting Round discard confirmation policy inside the session module by inspecting the current Room's active round state before dispatching commands that require confirmation, eliminating the three round-ID props drilled through workspace panels.
- Accept injectable adapters at the session seam for HTTP command execution, live-stream subscription, confirmation prompts, and fragment/history access so the full lifecycle is testable without a browser router or network.

## Testing Decisions

- Treat the Room session module's interface as the primary test surface, injecting local-substitutable adapters (fake command executor, controlled live stream, controllable confirmation adapter).
- Assert observable Room state transitions, emitted commands, optimistic updates and rollbacks, single-flight serialization across distinct intents, version-monotonicity under out-of-order frames, `#f=` claim/scrub behavior across open/closed/unavailable states, and ADR-0004 close-to-reopen-to-rejoin flows.
- Keep lightweight UI integration tests on rendered Room panels to verify user gestures wire cleanly to session intents and display session busy/error states; delete redundant per-panel busy/confirm/reopen unit tests that test past the session seam.
- Build on existing Pointing Poker controller and route tests as prior art.

## Out of Scope

- Changing server-side Pointing Poker storage, SQL schemas, or Durable Object / Node adapter contracts.
- Redesigning the visual layout of the Story queue, Voting Round stage, or Room summary.
- Changing ADR-0003 Display Name rules or ADR-0004 reopening semantics.

## Further Notes

- Coordinates naturally with the Voting Round discard policy spec (which defines the exact command-specific discard rules evaluated by this session module and the server) and the unified inline-edit session spec.
