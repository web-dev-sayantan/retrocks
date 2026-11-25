# Board Command Channel

## Problem Statement

Adding, inspecting, or changing a single Board mutation currently requires bouncing across six or more shallow modules: standalone input schemas, twenty-three individual server pass-through functions, a twenty-five-method action bag injected into the Board controller, and three thin server request modules that each parse input and forward straight into the already-unified Board mutation executor. This wide, shallow surface inflates boilerplate, complicates controller test doubles, and contrasts sharply with Pointing Poker's single discriminated command seam.

## Solution

Collapse the Board mutation channel into a single discriminated Board command schema, a single server mutation entry point, and one server command dispatcher that validates the command variant, generates server-side entity identifiers where needed, and delegates to the existing Board mutation executor and store adapters. Shrink the Board controller's injected mutation seam from twenty-five methods to one command-dispatch function.

## User Stories

1. As a Participant, I want creating, editing, deleting, commenting on, and voting on Cards and Card Groups to behave identically after the channel consolidation, so that retrospective collaboration is uninterrupted.
2. As a Facilitator, I want Board settings, Column management, Private Mode, Blind Voting, Locked state, Card Group merges, Action Item updates, vote resets, and Board deletion to work through the same reliable HTTP mutation seam, so that all facilitation controls remain consistent.
3. As a Participant or Facilitator, I want invalid or malformed mutation payloads rejected with clear, structured domain errors, so that the Board workspace can display accurate feedback and roll back optimistic updates.
4. As a Participant or Facilitator, I want authentication, capability-cookie verification, CSRF checks, and Viewer-specific redaction (Private Mode and Blind Voting) enforced uniformly for every Board command, so that no command can bypass access control.
5. As a Participant, I want committed Board mutations to broadcast live updates to all connected Participants on both Cloudflare Durable Objects and Node SQLite runtimes, so that real-time synchronization remains intact.
6. As a maintainer, I want to add or evolve a Board mutation by updating one discriminated command schema and the core store operation, so that I do not have to wire five pass-through modules per command.
7. As a maintainer, I want the Board controller to accept a single injectable command-dispatch adapter in tests, so that controller tests do not have to construct a twenty-five-method mock bag.

## Implementation Decisions

- Define a single discriminated Board command Valibot schema (covering Board, Column, Card, Card Group, Comment, Action Item, Vote, Voting settings, and Board deletion variants) as the single source of truth for both runtime validation and inferred TypeScript command types.
- Replace the twenty-three individual server action pass-through functions and the separate voting action module with one server mutation entry point accepting a Board identifier and a Board command, returning the existing structured mutation response shape.
- Consolidate the three thin server request modules (Board, grouping, and voting request wrappers) and the response helper into one server command dispatcher module that validates input, enforces Facilitator/Participant authorization, generates server-side IDs for creation/merge commands, executes the mutation through the existing Board store seam, and triggers live broadcast.
- Handle Board deletion within the same command dispatcher (preserving its Facilitator-only authorization and terminal broadcast/cleanup semantics) or as the single lifecycle exception if its return shape differs materially.
- Replace the twenty-five-method Board workspace actions interface on the Board controller with a single injectable command-dispatch adapter seam (preserving read/query and Co-Facilitator Link retrieval/rotation seams separately since they are not state-mutating commands).
- Preserve ADR-0002 completely: the HTTP-write / push-read split, the dual-runtime Board store and realtime adapters, and the shared SQL Board operations core remain unchanged.
- Preserve ADR-0001 completely: anonymous Participant cookies and Facilitator capability verification remain identical at the server dispatcher seam.

## Testing Decisions

- Test the server command dispatcher end-to-end against the in-memory Node SQLite store adapter (local-substitutable seam), asserting observable persisted state, viewer-projected responses, Private Mode / Blind Voting redaction, authorization rejections, and published realtime events.
- Test the Board controller by injecting a single fake command-dispatch adapter, asserting the exact discriminated commands emitted, optimistic UI state, and rollback on structured error responses.
- Delete redundant unit tests that only verified pass-through forwarding in the removed shallow action and request modules; replace them with contract coverage at the consolidated dispatcher seam.
- Follow existing Pointing Poker command-dispatcher and Node SQLite Board server test suites as prior art.

## Out of Scope

- Changing any Board domain rules, SQLite table schemas, or realtime wire protocols.
- Modifying the dual-runtime Board store or realtime adapter seams established by ADR-0002.
- Consolidating Board read/load queries or Co-Facilitator Link sharing endpoints into the mutation command channel.

## Further Notes

- This brings the Board mutation architecture into parity with the Pointing Poker Room command channel already proven in the codebase.
