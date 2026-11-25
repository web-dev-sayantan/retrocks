# Browser History

> Status: implemented. Storage injection deferred.

## Delivered

[createRecentStorage](../../src/lib/recent-storage.ts) provides `read`, `record`, and `remove` using a storage key, entry parser, and optional cap. It deduplicates entries by ID, defaults to 20 entries, promotes revisits, removes the key when the list becomes empty, and tolerates malformed data and blocked browser storage.

- [Board history](../../src/lib/recent-boards.ts) uses `retrocks:recent-boards` and keeps the Board ID, title, timestamp, and optional Facilitator display hint.
- [Poker history](../../src/lib/recent-poker-rooms.ts) uses `retrocks:recent-poker-rooms`, validates the Room ID, accepts legacy entries without a name, and defaults blank names to `Poker Room`. The closed Room flow uses `onlyIfSaved`.
- [RecentLinksList](../../src/components/RecentLinksList.tsx) renders the normalized entries supplied by the [Board](../../src/components/RecentBoardsList.tsx) and [Poker](../../src/components/poker/RecentPokerRoomsList.tsx) wrappers. The [relative-time formatter](../../src/lib/relative-time.ts) is shared by recent links, Cards, and comments. Board views pass their existing clock.

The factory uses browser `localStorage` directly. The original in-memory adapter is optional because the [storage tests](../../src/lib/recent-storage.test.ts) already exercise the factory through the test environment's storage, including denied access. [Poker history tests](../../src/lib/recent-poker-rooms.test.tsx) and [Board workspace tests](../../src/components/BoardWorkspace.test.tsx) cover feature-specific behavior.
