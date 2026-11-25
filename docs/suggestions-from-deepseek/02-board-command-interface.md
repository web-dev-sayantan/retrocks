# Board Command Interface

> Status: command channel implemented by #105–#107. Broader registry deferred.

## Delivered

- [BoardCommandSchema](../../src/lib/schemas.ts) defines the discriminated command variants and the inferred `BoardCommand` input type. The Board ID is a separate argument.
- [dispatchBoardCommand](../../src/lib/board-actions.ts) is the single HTTP entry point for existing Board mutations. [The server dispatcher](../../src/server/services/board-service.ts) validates the ID and the command, generates server-side IDs for creation and merge commands, and delegates to the Board store. Board deletion travels through the same entry point and uses a dedicated implementation for authorization, storage removal, and the terminal event.
- The [Board controller](../../src/lib/board-controller.ts) takes one injected `dispatchCommand(boardId, command)`. Its named workspace methods construct commands and use a common guarded mutation flow for optimistic updates, rollback, and versioned responses. The old per-operation forwarding modules have been removed. Reads and Co-Facilitator Link operations retain their own interfaces.
- [Server dispatcher tests](../../src/server/services/board-command.test.ts) and [controller tests](../../src/lib/board-controller.test.tsx) exercise the dispatched commands and their observable effects.

## Remaining design decision

The original proposal also called for a workspace-facing `mutate(command)` and a registry combining validation, server mapping, permissions, optimistic effects, and pending state. The delivered command channel already removed the repeated transport wiring. The named workspace methods still provide caller-specific results, such as a newly created Column, and behavior such as Private Mode reveal. Keep those methods while they serve those callers. The [Board command channel spec](../board-command-channel-spec.md) describes the delivered scope.

For future changes, use the existing schema, dispatcher, and guarded mutation flow. If repeated command-to-permission mapping warrants an extraction, address it through the [Board permission proposal](03-board-permission-table.md) with the authoritative transaction and client projection in view.
