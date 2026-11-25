# Suggestions from DeepSeek

Reconciled the six proposals from the 24 November 2026 architecture review against checkout `e8ee04b` on 25 November 2026. Status describes what is present in that checkout.

1. [Pointing Poker command rules](01-poker-command-rules.md) — **Partially implemented.** Discard decisions and Deck equality are shared. Deck input and selected Story transitions still benefit from focused parity work.
2. [Board command interface](02-board-command-interface.md) — **Command channel implemented.** The server entry point and injected controller dispatcher have shipped. Keep the named workspace methods while they provide behavior callers use.
3. [Board permission table](03-board-permission-table.md) — **Still open.** The controller has one guard, and SQL still makes independent authoritative decisions. Share rules where both sides can derive equivalent facts.
4. [Pointing Poker Room session](04-poker-room-session.md) — **Implemented.** The route mounts one lifecycle controller that also coordinates live Room mutations and confirmations.
5. [Live Room protocol](05-live-room-protocol.md) — **Partially implemented.** Shared client transport and Poker publication have shipped. Start the remaining server work with SSE framing and keep runtime-specific lifecycle contracts.
6. [Browser history](06-browser-history.md) — **Implemented.** Both histories use the shared storage factory, list, and relative-time formatter.

For follow-up implementation, start with [Poker Deck parity](01-poker-command-rules.md) or [Board permission facts](03-board-permission-table.md). Both can land independently. [SSE framing](05-live-room-protocol.md) is a separate, smaller change. The larger registry and cross-runtime hub are deferred pending evidence from those narrower changes.
