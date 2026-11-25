# Board Command Interface

> Status: ready-for-agent
> Source: architecture review, 24 November 2026

## Problem Statement

A Facilitator can change a Board through twenty-five actions, but adding or evolving one action currently means touching input schemas, a server action, an action interface and its default object, a request wrapper, a controller method, a permission gate, and a test double. The same command is named in at least four registries, and the in-memory test adapter has to reimplement the whole Board mutation interface. The result is boilerplate, easy-to-miss wiring, and test doubles that drift from the real dispatcher.

## Solution

Collapse the Board mutation channel into one discriminated Board command schema, one server mutation entry point, one command registry, and one client controller entry. The registry holds each command's validation, permission intent, optimistic write, pending slot, and server mapping. Reads, live updates, and Co-Facilitator Link operations stay separate because they are not Board mutations.

## User Stories

1. As a Participant, I want creating, editing, moving, and deleting Cards to behave identically after the channel consolidation, so that retrospective collaboration is uninterrupted.
2. As a Participant, I want comments, reactions, Votes, and Action Items to keep their current behavior, so that the consolidated channel does not regress the small interactions I use most.
3. As a Facilitator, I want Board settings, Column management, Private Mode, Blind Voting, Locked state, Card Group merging, vote resets, and Board deletion to keep working through one reliable HTTP mutation seam, so that every facilitation control stays consistent.
4. As a Facilitator, I want each command to apply the same permission and Locked-state rules before the write, so that a control cannot bypass a gate by using a different entry point.
5. As a Participant, I want invalid or malformed command payloads rejected with clear, structured domain errors, so that the Board workspace can show accurate feedback and roll back optimistic updates.
6. As a Participant, I want authentication, capability-cookie verification, origin checks, and viewer-specific redaction enforced uniformly for every Board command, so that no command can bypass access control.
7. As a Participant, I want Private Mode and Blind Voting redaction to stay identical for every command response and live event, so that the consolidated channel never leaks a Card or Vote total.
8. As a Participant, I want committed mutations to broadcast live updates to all connected Participants on both Cloudflare and Node runtimes, so that real-time collaboration remains intact.
9. As a Participant, I want an optimistic Vote, reaction, Action Item toggle, or Card creation to revert automatically when the server rejects the command, so that the Board never keeps a guess the server refused.
10. As a Facilitator, I want Board deletion to retain its Facilitator-only rule, terminal broadcast, and storage wipe, so that the lifecycle exception does not disappear into the generic channel.
11. As a Facilitator, I want server-generated identifiers for new Cards, comments, Columns, and Card Groups, so that I do not have to trust a client-supplied id.
12. As a Participant, I want the same command to produce the same error code and message regardless of which control sent it, so that feedback is predictable.
13. As a maintainer, I want to add or change a Board command in one registry, so that I do not edit six pass-through modules.
14. As a maintainer, I want the server to expose one mutation action instead of twenty-five wrappers, so that the HTTP entry point has one contract to audit.
15. As a maintainer, I want the Board controller to accept one command-dispatch adapter in tests, so that controller tests do not construct a twenty-five-method fake.
16. As a maintainer, I want the in-memory test adapter to be one reducer over the command union, so that it cannot silently diverge from the real command set.
17. As a maintainer, I want command types inferred from the runtime schema, so that the schema and TypeScript cannot drift.
18. As a maintainer, I want the command registry to keep optimistic and pending metadata beside the command, so that adding a command does not require a separate controller method and gate entry.
19. As a maintainer, I want Board reads, live-stream handling, and Co-Facilitator Link retrieval to remain outside the mutation channel, so that the command union stays about writes.
20. As a maintainer, I want to delete the pass-through action and request modules rather than layer the new dispatcher on top of them, so that the interface actually shrinks.

## Implementation Decisions

- Define one discriminated Board command union covering Board rename, timer, Private Mode, Locked state, Board deletion, Voting settings and reset, Vote changes, Card create/update/move/delete, Action Item changes, reactions, comments, Card Group operations, and Column operations. Include the Board identifier in the command envelope.
- Define one Valibot command schema as the runtime source of truth and infer the TypeScript command type from it. Do not maintain a hand-written twin.
- Define one command registry keyed by command type. Each entry carries: the command schema or variant, the permission intent, the optimistic effect, the pending slot, the server command mapping, and the fallback failure message.
- The optimistic effect and pending slot are client concerns; the server imports only the command schema, permission intent, and server mapping. Keep the registry split along that seam so the server never imports the client store.
- Replace the twenty-five individual server actions with one mutation entry point that accepts the Board identifier and the command, validates the envelope, and delegates to the dispatcher.
- Replace the Board, grouping, and voting request wrappers with one dispatcher that validates the command, generates server-side identifiers for creation and merge commands, enforces authorization, executes through the existing Board store seam, and triggers live publication.
- Keep Board deletion in the same channel if its existing mutation response can carry the terminal `board:deleted` event; otherwise keep exactly one named lifecycle entry and document why it is the only exception. Do not create a second generic mutation path.
- Replace the Board controller's twenty-five mutation methods with one `mutate(command)` entry point. Keep read accessors, error state, live status, pending flags, and Co-Facilitator Link operations as separate interfaces.
- Map each command's optimistic effect to the existing optimistic store, and each pending declaration to the existing pending-slot mechanism. The dispatcher must preserve current serialization and rollback behavior.
- Preserve ADR-0002 completely: all writes still cross the Solid server-function HTTP seam, the Board store and realtime adapters still use their existing seams, and the shared SQL Board operations core is unchanged.
- Preserve ADR-0001 completely: anonymous Participant cookies and Facilitator capability verification remain identical at the server dispatcher.
- Preserve existing response shapes, live event ordering, and error codes. The command channel is a wiring change, not a domain change.

## Testing Decisions

- Primary seam: the Board command dispatcher's `mutate(command)` interface. The controller is tested through one fake dispatcher.
- A good test crosses the dispatcher's public command interface and asserts observable persisted state, returned events, viewer projection, and live publication. It must not assert which internal helper handled the command.
- Test the server dispatcher end-to-end against the in-memory Node SQLite store adapter, covering authorization, validation, server-generated ids, Board deletion, Private Mode and Blind Voting redaction, and published realtime events.
- Test the Board controller with one fake command-dispatch adapter. Assert the exact command objects emitted, optimistic state, pending slots, rollback on structured errors, and no call for a rejected guard.
- Test the command schema at the protocol seam with valid and invalid variants, including optional fields and server-only identifiers.
- Delete unit tests that only verified pass-through forwarding in the removed action and request modules. Replace them with contract coverage at the consolidated dispatcher seam.
- Keep UI integration tests that prove each control emits the right command and displays the right pending and error state.
- Prior art: the Pointing Poker command dispatcher and the existing Node SQLite Board server suite, plus the Board controller suite for optimistic behavior.

## Out of Scope

- Changing any Board domain rules, SQLite table schemas, or realtime wire protocols.
- Changing the Board permission policy or the shared permission table; the command registry consumes that policy as a gate intent.
- Redesigning the Board workspace, Column, Card, or drawer interfaces.
- Consolidating Board read/load queries, live-stream handling, or Co-Facilitator Link sharing into the mutation channel.
- Changing Vote-cap math, Action Item rules, or Private Mode redaction in the projection.
- Changing the Board deletion retention or expiry policy.

## Further Notes

- A prior Board command channel draft covers the same direction. This spec adds the command registry's optimistic and pending metadata, the single test double, and the explicit deletion decision.
- If the permission table spec is adopted, the registry's gate field should reference a permission intent rather than duplicate a predicate.
- Keep the command union as the audit interface: every Board write should be findable by command type in one place.
