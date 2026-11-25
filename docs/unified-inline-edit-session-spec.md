# Unified Inline-Edit Session

## Problem Statement

A Participant or Facilitator can edit text in place across six surfaces: a Room name, a Story title, a Board title, a Column title, a Card, and a Card Group title (plus the Action Item owner field in the Card detail drawer). Today each surface manually stitches together multiple shallow editing helpers, a mount-only wrapper, double-tap handling, and two local reactive effects. Because every surface coordinates keyboard, focus, and async save lifecycles independently, Board surfaces have drifted behind Pointing Poker surfaces—lacking IME composition guards on Enter, container-aware focus-out checks when clicking Save or Cancel, and full in-flight save cancellation on Escape or entity change.

## Solution

Deepen the inline-edit session module so a single module owns input binding and cleanup, double-click and double-tap activation, IME-safe keyboard handling, container-aware focus-out, automatic cancellation on permission loss or lock or target change or unmount, stale-save invalidation, and fallback focus restoration. Every Board and Pointing Poker editing surface becomes a thin caller supplying only its current value, target identity, disabled rule, async save handler, and fallback focus target.

## User Stories

1. As a Facilitator, I want to rename a Board, Column, Card Group, Room, or unlocked Story in place, so that I can update titles without opening a separate modal.
2. As a Participant, I want to edit my own Card in place, so that I can refine my note directly inside its Column.
3. As a Participant using an IME keyboard (such as CJK input), I want pressing Enter to confirm composition rather than prematurely submitting my edit on every Board and Room surface, so that I do not save half-composed text.
4. As a Participant or Facilitator, I want clicking the Save or Cancel control inside an inline editor not to trigger a competing focus-out commit, so that my explicit button click is honored cleanly.
5. As a Participant or Facilitator, I want pressing Escape or clicking Cancel during an in-flight save to discard the pending session, so that a slow response cannot unexpectedly close or corrupt a newly reopened edit session.
6. As a Participant or Facilitator, I want double-clicking on desktop and double-tapping on touch devices to open inline editing consistently across editable surfaces, so that touch and pointer interactions feel uniform.
7. As a Participant or Facilitator, I want an active inline edit to cancel automatically when the Board becomes Locked, a Story becomes a Locked Story, my Facilitator role is lost, or the target entity changes, so that stale drafts cannot be submitted against an invalid target.
8. As a Participant or Facilitator, I want my draft to remain open with a visible error message when a save fails, so that I can fix or retry without retyping.
9. As a keyboard Participant, I want focus to return predictably to the trigger control or surface fallback when an inline edit finishes or cancels, so that I do not lose my place on the page.
10. As a Facilitator editing an Action Item owner field in the Card detail drawer, I want the same stale-save invalidation and retry guarantees, so that drawer edits never race with closing or switching Cards.
11. As a maintainer, I want all inline-edit lifecycle invariants implemented in one deep module, so that fixing an editing bug fixes all Board and Pointing Poker surfaces simultaneously.

## Implementation Decisions

- Deepen the shared inline-edit session module to absorb the mount-binding helper, double-tap activation, asynchronous save serialization, and focus-restoration logic; delete the standalone mount-only module once absorbed.
- Accept declarative inputs at the session interface: current persisted value, target identity key, disabled/locked predicate, optional double-tap configuration, async save callback returning a typed outcome, and optional fallback focus target.
- Own IME composition detection on Enter, Escape cancellation, container-aware focus-out detection (ignoring focus transitions that stay inside the editor container), and draft-length/non-empty tracking inside the session module.
- Track a monotonic session token alongside target identity, disposal state, and disabled state so any late async save resolution, rejection, or focus restoration from an invalidated session is ignored.
- Serialize commits while a save is in flight so repeated Enter presses or blur-plus-click sequences issue at most one save call.
- Eliminate the duplicated per-surface reactive effects for focus restoration and mount binding by handling ref attachment/cleanup and transition-end focus restoration inside the session module.
- Keep domain-specific rules—such as blank-title normalization, default Room name fallback, Story title validation, and Voting Round discard confirmation—inside each domain caller rather than in the generic session module.
- Migrate all six primary inline-edit surfaces (Room name, Story title, Board title, Column title, Card text, Card Group title) and align the Action Item owner editor with the same session invalidation seam.

## Testing Decisions

- Treat the inline-edit session module's public interface as the primary test surface, exercising observable state transitions, emitted save calls, DOM focus outcomes, and keyboard/pointer/IME events rather than internal flags or effect ordering.
- Write one comprehensive in-process test suite covering: double-click/double-tap start, IME Enter suppression, Escape cancellation during idle and in-flight saves, focus-out into editor controls vs outside the editor, automatic invalidation on lock/disable/target-change/unmount, save failure draft retention and retry, and fallback focus restoration.
- Retain high-level integration tests on rendered Room name, Story Queue, Board title, Column, Card, and Card Group surfaces to verify domain wiring and discard confirmations, while deleting redundant per-surface plumbing assertions that duplicate session-module coverage.
- Follow existing inline-edit and Story Queue test patterns in the codebase (in-process DOM testing with explicit flush before assertions).

## Out of Scope

- Changing visual styling, layout, or copy of inline editors.
- Introducing new edit gestures or changing which roles can edit which entities.
- Changing server-side validation rules or persistence schemas.

## Further Notes

- This spec broadens the scope of the earlier Pointing Poker inline editor session spec to unify all Board and Pointing Poker inline-editing surfaces under one deep module, closing the existing behavioral drift on Board surfaces.
