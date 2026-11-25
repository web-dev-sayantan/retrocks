# Inline editor session

## Problem Statement

A Facilitator can rename a Room or edit a Story from the queue or stage. Each editor coordinates target identity, permission loss, disposal, focus, and cancellation around a shared save module. A late save or confirmation can interact with a newer editor session if any caller misses a lifecycle step.

## Solution

Deepen the existing inline editor session module so it owns save serialization and invalidation. Each editing surface supplies its domain rules and focus destination.

## User Stories

1. As a Facilitator, I want to rename a Room in place, so that I can keep working in it.
2. As a Facilitator, I want to edit an unlocked Story from the queue or stage, so that I can correct its title where I am working.
3. As a Facilitator, I want keyboard, pointer, touch, and text composition to behave consistently, so that I can edit with my preferred input.
4. As a Facilitator, I want to cancel a draft without submitting it, so that I can keep the existing name or title.
5. As a Facilitator, I want to see a save error and retry, so that I can recover without reentering the draft.
6. As a Facilitator, I want a replacement target or lost permission to invalidate my draft, so that an earlier action cannot affect the new session.
7. As a keyboard user, I want predictable focus when editing ends, so that I can continue from the same surface.
8. As a maintainer, I want to handle session lifetime in one module, so that all three surfaces follow the same ordering rules.

## Implementation Decisions

- Build on the existing inline edit and asynchronous save seam. Own target identity, cancellation, disposal, and eligibility to apply a save result there.
- Serialize submissions while a save is pending. Ignore outcomes from invalidated sessions, including late errors and focus changes. Recheck session validity after awaiting Story title confirmation and before issuing the mutation.
- Keep normalization, default Room name, Story title validation, and discard confirmation with the domain callers. Keep the destination for fallback focus specific to each surface.
- Preserve existing start gestures, keyboard and composition behavior, draft retention on failure, and focus behavior on save or cancel.

## Testing Decisions

- Use rendered Room name and Story title controls as the test surface. Assert visible drafts, errors, focus, and calls to the existing Room mutation interface.
- Extend the existing Room name late-save and Story Queue inline-edit tests for target replacement, permission loss, or unmount during pending work. Cover a late confirmation and verify repeated commit gestures send one mutation.
- Preserve the existing retry, cancellation, IME composition, and focus regression coverage.

## Out of Scope

New edit gestures, changes to Room or Story rules, a general dialog abstraction, and migration of Board editors.

## Further Notes

The shared editor module handles session validity. The Voting Round discard policy governs confirmation requirements.
