# Attention to Detail & Micro-Interaction Opportunities

A living note for small, high-craft UX enhancements across Retrocks — moments where subtle motion, clear feedback, and spatial cues turn dead ends into effortless guidance.

## Principles

- **Point to the cause, not a dead end.** When a control is unavailable because of a prerequisite right next to it, a subtle nudge toward that prerequisite teaches the interface faster than an error message or silent no-op.
- **Subtle, physical, compositor-only.** Keep micro-interactions short (~250–400 ms), restrained, and driven by compositor properties (`transform`, `opacity`). Prefer shared, reusable primitives over one-off keyframes.
- **Accessible by default.** Opt into spatial motion inside `@media (prefers-reduced-motion: no-preference)`, and pair it with a non-motion visual cue (such as a brief accent border/tint) so users who prefer reduced motion still get clear feedback. Keep disabled controls focusable (`focusableWhenDisabled`) when users need to discover why they are unavailable.
- **Restraint builds trust.** Reserve attention cues for genuine moments of friction or confirmation. Over-animating trains people to tune everything out.

## Reusable Primitives

| Primitive | Location | Purpose |
| --- | --- | --- |
| `createWiggle` + `.ui-wiggle` | `src/lib/wiggle.ts`, `src/App.css` | Subtle damped wiggle + accent tint to nudge a related control (re-triggerable on rapid clicks, reduced-motion safe, forced-colors safe). |
| `.spring-press` | `src/App.css` | Tactile press-down + spring release for primary/secondary buttons. |
| `.spring-chevron` | `src/App.css` | Spring-settled rotation for disclosure chevrons. |

## Implemented

- **Locked Story `Select` → Unlock button wiggle** (`src/components/poker/PokerStoryQueue.tsx`): Clicking `Select` (or `Reconsider`) on a locked Story subtly wiggles the Unlock icon button beside it so the Facilitator immediately sees why selection is blocked and where to unlock it.

## Future Opportunities to Watch For

### Pointing Poker
- **Other locked Story row actions**: Clicking disabled `Edit title`, `Edit estimate`, `Delete`, or `Return to queue` on a locked Story could also nudge the Unlock button.
- **Disabled `Reveal votes` with zero votes**: Trying to click `Reveal votes` before anyone has voted could subtly nudge the voting deck or status pill.
- **Disabled `Confirm estimate` with no selection**: Trying to confirm after reveal without picking an Accepted Estimate could nudge the estimate choices.
- **Locked Deck cue**: After the first Voting Round locks the Deck, make the locked state feel intentional and immediately legible if a Facilitator looks for Deck settings.
- **Copy Room / Co-Facilitator link feedback**: Pair the status text with a crisp copy-to-checkmark icon swap.

### Retrospective Boards
- **Vote limit reached**: Clicking `+` / vote on a Card when a Participant has spent all their votes could subtly nudge the remaining-votes counter in the toolbar.
- **Private Mode / Hidden Cards**: Clicking or attempting to interact with a blurred/hidden element could gently highlight the Reveal / Private Mode toggle for Facilitators.
- **Timer completion**: Pair the chime with a gentle, reduced-motion-safe visual pulse on the timer pill (without exceeding flash limits).
- **Inline edits & focus continuity**: Keep focus anchored predictably after saving/canceling inline edits, reordering items, or dismissing confirmations.

## Quick Checklist Before Shipping a New Cue

1. Does it reuse an existing primitive (`createWiggle`, `.spring-press`, etc.) or introduce a clean reusable one?
2. Does it animate only compositor-friendly properties (`transform`, `opacity`)?
3. Does it degrade gracefully under `prefers-reduced-motion: reduce` and `forced-colors: active`?
4. Is it covered by a focused behavior test?
