# Board Workspace Ambient Context

## Problem Statement

Eleven Board-level values and mutation callbacks—including Column list, Voting settings, Facilitator status, Locked state, Private Mode state, grouping eligibility, current timestamp, transfer state, mutation actions, and Card detail drawer opening—are currently prop-drilled across three to four levels from the Board workspace through Column panels and Card Groups down to individual Cards and the Card detail drawer. Intermediate modules carry fourteen to twenty-two props and re-declare narrow slices of the Board mutation interface solely to relay ambient Board state to their children.

## Solution

Introduce a Solid 2.0 Board workspace context seam provided at the Board workspace root that exposes read-only ambient Board state, facilitation flags, voting rules, timing, transfer state, and Board mutations. Narrow Column, Card Group, Card, and Card detail drawer interfaces so each module accepts only its local entity and slot props.

## User Stories

1. As a Participant viewing a Board, I want Columns, Card Groups, Cards, and the Card detail drawer to react immediately to Private Mode, Blind Voting, Locked state, and Vote count changes, so that fine-grained reactivity is preserved with zero regressions.
2. As a Facilitator toggling Locked state, Private Mode, Blind Voting, or Voting settings, I want every nested Card and Card Group control to update consistently, so that permissions never fall out of sync between a Column and its Cards.
3. As a Participant dragging or transferring Cards between Columns or into Card Groups, I want transfer state and grouping eligibility reflected seamlessly across all Columns and Cards, so that drag-and-drop and keyboard moves stay responsive.
4. As a Participant opening a Card detail drawer, I want comments, Votes, and Action Item controls to reflect live Board updates without stale prop snapshots, so that drawer interactions stay accurate.
5. As a maintainer adding a new Board-level flag or mutation capability, I want leaf modules to read it directly from the workspace context, so that I do not have to thread new props through Column and Card Group interfaces.
6. As a maintainer writing tests for a Card, Card Group, Column, or Card detail drawer, I want to render the module inside one lightweight workspace context test helper, so that tests do not need to fabricate fourteen to twenty-two unrelated props per render.

## Implementation Decisions

- Define a dedicated Board workspace context module using Solid 2.0's `<Context value={...}>` syntax and a strict consumer accessor that throws a clear developer error if called outside a Board workspace provider.
- Expose reactive getters (not unwrapped static values) on the context value for ambient Board state: Board metadata/columns, voting rules and remaining ballots, Facilitator role, Locked state, Private Mode / blurred state, card-grouping eligibility, live clock timestamp, card transfer state, Board mutation actions, and Card detail drawer opener.
- Preserve Solid 2.0 reactivity rules: never destructure props or read reactive accessors at the top of a module body; read context getters inside JSX, memos, or event handlers.
- Remove relayed ambient props and narrow `Pick` mutation prop slices from Column, Card Group, Card, and Card detail drawer interfaces, leaving only entity-specific props (such as the Column, Card Group, Card, local neighbor lists, and reveal index).
- Provide a small, reusable test context helper for Board UI tests with sensible defaults and selective overrides so tests remain concise and resilient to new ambient fields.

## Testing Decisions

- Test Column, Card Group, Card, and Card detail drawer modules through their narrowed interfaces inside the workspace context helper, asserting visible DOM output, ARIA attributes, permission gating (Facilitator, Locked, Private Mode, Blind Voting), and emitted mutation calls.
- Verify reactive propagation by updating signals backing the workspace context (e.g., toggling Locked or Private Mode) and asserting nested Card and drawer controls update without remounting.
- Preserve existing Board workspace, Column, Card, and Card detail drawer integration tests; simplify their test setup to use the context helper rather than repeating full prop bags.
- Follow existing Solid 2.0 component testing conventions in the codebase.

## Out of Scope

- Splitting or rewriting the Board controller's internal state management or server mutation channel (covered separately by the Board Command Channel spec).
- Changing any visual design, drag-and-drop semantics, or keyboard accessibility behavior on the Board.
- Introducing a similar context for Pointing Poker Rooms (where the route-level Room session spec addresses panel coupling directly).

## Further Notes

- If implemented alongside the Board Command Channel spec, the workspace context can expose the simplified command seam directly without touching intermediate Column or Card Group interfaces twice.
