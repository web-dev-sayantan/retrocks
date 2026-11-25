# Browser History

> Status: ready-for-agent
> Source: architecture review, 24 November 2026

## Problem Statement

The home page keeps recent Boards and recent Rooms in browser storage. The two histories repeat sanitizing, deduplication, a 20-entry cap, and guarded writes. A malformed entry can be handled differently by each list, and a storage failure can surface differently. A relative-time formatter lives inside the Board history module and is imported by Cards and comments, so presentation depends on a persistence module. Maintaining one history means changing two modules with separate tests.

## Solution

Make browser history one small factory. It takes a storage key, a maximum, and a sanitizer, and returns read, record, and remove operations over a list of entries. Instantiate it for recent Boards and recent Rooms. Move relative-time formatting beside the other time helpers. The existing recent-links list renders either history through a small entry adapter.

## User Stories

1. As a Participant, I want recently visited Boards to appear in last-visited order, so that I can return to a retrospective quickly.
2. As a Participant, I want recently visited Rooms to appear in last-visited order, so that I can return to an estimation session quickly.
3. As a Participant, I want each history capped at twenty entries, so that the list stays useful and storage stays small.
4. As a Participant, I want duplicate entries collapsed by id, so that revisiting a Board or Room moves it to the top instead of adding a second row.
5. As a Participant, I want invalid or corrupted entries dropped, so that one bad stored value cannot break the whole list.
6. As a Participant, I want a non-array or unreadable stored value treated as empty, so that the page still loads.
7. As a Participant in a browser that blocks storage, I want history writes to fail silently, so that the app remains usable in restricted browsing modes.
8. As a Participant, I want to remove an entry from either history, so that the list reflects what I want to keep.
9. As a Participant, I want a Board title or Room name update to refresh the stored label, so that the list does not show a stale name.
10. As a Participant, I want a Facilitator hint preserved on recent Boards, so that I can recognize Boards I can manage.
11. As a Participant, I want a closed Room recorded only if it was already saved, so that browsing a closed link does not add an unwanted entry.
12. As a Participant, I want relative times on Cards, comments, and history rows to read consistently, so that "Just now", minutes, hours, and days mean the same everywhere.
13. As a Participant, I want relative times to keep updating on the Board's existing clock, so that the new time module does not introduce a second timer.
14. As a Participant, I want no tokens or secrets stored in history, so that sharing a browser does not expose a Co-Facilitator Link.
15. As a maintainer, I want one sanitize, dedupe, cap, and write policy, so that the two histories cannot drift.
16. As a maintainer, I want to add a future history type by instantiating the factory with a key and sanitizer, so that I do not copy storage code.
17. As a maintainer, I want the relative-time formatter in a time module, so that Cards do not import a history module for presentation.
18. As a maintainer, I want one in-memory storage adapter for tests, so that browser history cases are tested without a real localStorage.
19. As a maintainer, I want the existing storage keys preserved, so that current users keep their saved lists.
20. As a maintainer, I want the list UI to receive a normalized entry shape, so that Boards and Rooms share one renderer without leaking their storage types.

## Implementation Decisions

- Introduce a local-history factory parameterized by storage key, maximum entries, and a sanitizer. It returns read, record, and remove operations. Record returns the updated list; remove returns the updated list.
- The factory guards browser availability, catches storage and JSON errors, drops invalid entries, deduplicates by id, caps at the maximum, and writes an empty list by removing the key. It never throws to the caller.
- Keep the existing storage keys for recent Boards and recent Rooms. Do not migrate or rewrite stored data.
- Instantiate one history for recent Boards and one for recent Rooms. Keep their entry types distinct until the adapter seam: a Board entry has title and optional Facilitator hint; a Room entry has name.
- Define one normalized recent-entry shape for the shared list: id, label, lastVisitedAt, optional Facilitator hint, and href. Adapt both histories into it in their list wrappers.
- Preserve the existing sanitizers: a Board entry needs a non-empty id and title and a finite timestamp; a Room entry needs a valid Room id and uses the default Room name when the stored name is blank.
- Preserve the closed-Room rule: record only if the Room was already saved when the caller asks for that behavior.
- Move relative-time formatting into a time module used by recent lists, Cards, and comments. Keep the existing thresholds and copy: just now, minutes, hours, days. Do not add a timer; callers keep passing their existing clock value.
- Keep history writes free of raw capability tokens, hashes, and secrets. Only id, label, timestamp, and the Facilitator hint are stored.
- Keep the shared list's remove action and accessible labels unchanged. The list should not know whether the entry came from Boards or Rooms.
- Do not add cross-tab synchronization, server persistence, or a new history type in this change.

## Testing Decisions

- Primary seam: the local-history factory's read, record, and remove interface with an in-memory storage adapter.
- A good test drives the factory through its public operations with an in-memory storage adapter and asserts the returned list and the stored value. It should not assert internal key iteration.
- Cover empty storage, invalid JSON, a non-array value, entries missing id or label, duplicate ids, the cap, record at the front, remove, and an unavailable storage adapter.
- Test both Board and Room sanitizers at the factory interface: blank titles, blank names, invalid ids, non-finite timestamps, and the closed-Room only-if-saved option.
- Test the relative-time formatter directly at its thresholds and with a supplied clock. Keep the shared list and Card/comment integration tests for visible labels.
- Test the shared list through its normalized entry interface, asserting order, remove behavior, accessible names, and the Facilitator hint. Keep the existing Board and Room list wrappers as thin wiring tests.
- Delete duplicate storage tests that only restate the factory behavior for one history.
- Prior art: the existing recent-Boards tests and recent-Rooms tests, plus the home recent-links list coverage.

## Out of Scope

- Server-side history, accounts, or cross-device synchronization.
- Changing the home page layout or the recent-links list design.
- Adding a new history type beyond Boards and Rooms.
- Changing storage keys, cookies, or capability-token handling.
- Reworking the Board or Room clock, or adding a second relative-time timer.
- Analytics, recommendations, or history search.
- Migrating or rewriting existing localStorage payloads.

## Further Notes

- This is the smallest and most speculative spec. It is independent and can land first or last.
- The factory is an in-process module over a local-substitutable storage dependency: tests inject an in-memory storage adapter.
- The main risk is accidental key or shape drift. Preserve the keys and sanitizers exactly, and treat any stored-data change as a separate migration.
- The relative-time move is a locality fix: time formatting should not be reachable only through Board history.
