# Suggestions from DeepSeek

Six specs synthesized from the 24 November 2026 architecture review. Each spec is written for an agent to implement without re-deriving the architecture. Nothing in the application was changed for this review.

| # | Spec | Strength | Primary seam |
|---|------|----------|--------------|
| 1 | [Pointing Poker command rules](01-poker-command-rules.md) | Strong | One pure command-decision module over a shared Room state |
| 2 | [Board mutation interface](02-board-command-interface.md) | Strong | One Board command registry and dispatcher |
| 3 | [Board permission table](03-board-permission-table.md) | Strong | One permission table over authoritative and projected facts |
| 4 | [Pointing Poker Room session](04-poker-room-session.md) | Worth exploring | One route-level Room session owning lifecycle precedence |
| 5 | [Live Room protocol](05-live-room-protocol.md) | Worth exploring | One live-room hub and one SSE frame codec over thin runtime adapters |
| 6 | [Browser history](06-browser-history.md) | Speculative | One local-history factory plus a shared time formatter |

Recommended order: **1 → 3 → 2 → 4 → 5 → 6**. Specs 2 and 3 can be combined: the permission table becomes the gate column of the Board command registry. Spec 4 can be adopted independently of 1; if both are adopted, the session should consume the shared command rules rather than add a third copy.

All six are marked `ready-for-agent` by intent; this repository stores them as local specs rather than GitHub issues.
