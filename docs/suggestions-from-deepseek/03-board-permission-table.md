# Board Permission Decisions

> Status: open. The unified command channel and controller guard are in place.

## Current checkout

The [Board controller](../../src/lib/board-controller.ts) already centralizes mutation preflight in `authorizeMutation`. It composes the [projected Board predicates](../../src/lib/board-permissions.ts) that also guide rendered controls. Authoritative enforcement is still distributed across [Board SQL operations](../../src/server/db/sql-board-operations.ts), [Card permission checks](../../src/server/domain/card-permissions.ts), [Voting SQL operations](../../src/server/db/sql-voting-operations.ts), and the [Board deletion handler](../../src/server/services/board-service.ts).

Some rules can share a decision once the two callers derive equivalent facts. Others have deliberate differences. For example, during Private Mode the client disallows Facilitator deletion of someone else's comment. The server can allow that deletion when the containing Card passes its privacy check. Pending optimistic Cards are also a client-only state.

## Remaining proposal

As a Participant or Facilitator, I want controls and write attempts to honor the same rules whenever both have the facts needed to decide. As a maintainer, I want to change those rules in one place.

1. Start with Locked-state and Card-management decisions. Move the shared role, lock, authorship, and visibility checks into a pure module. Derive facts from the viewer projection in the client and from rows and the authenticated actor in the transaction. Keep client handling of pending objects and intentionally conservative affordances in the projected predicates.
2. Preserve the Locked exceptions. A Facilitator can delete or unlock the Board and follow up on existing Action Items without re-flagging them. Capability rotation follows its existing path and authorization. In Private Mode, management of another Participant's hidden Card stays blocked for Facilitators too.
3. Extend the module to grouping, Column deletion, and Vote eligibility only where authoritative and projected facts align. Model Card and Card Group Vote limits using the actor's own balance and target count. Keep grouped Card routing, aggregation and removal of existing member Votes, SQL lookups, missing-entity handling, and transactional writes at the authoritative seam. Blind Voting affects projection.
4. Reuse decision reasons where semantics match. Keep server error codes, messages, and precedence stable. The UI can present its existing control-specific feedback. Remove stale SQL line-number references as their rules move.

The [Board command channel](02-board-command-interface.md) already provides the mutation entry point. This proposal can use it without changing the workspace interface or exposing hashes or hidden content.

## Verification

Drive the first extracted rules through a shared decision matrix, then exercise the client and server adapters with representative scenarios. Cover Facilitator and author access, hidden Cards, Locked exceptions, pending Cards, and the intentional comment moderation difference. For later Vote cases, include plus and minus changes, the Board balance, the per-target cap, and combined group Votes. Use the existing [permission](../../src/lib/board-permissions.test.tsx), [controller](../../src/lib/board-controller.test.tsx), and [server command](../../src/server/services/board-command.test.ts) suites.
