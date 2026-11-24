# Solid 2.0 effect verification

Verification covers the combined implementation from baseline `95aa0b4` through reviewed code at `ec32f51`. [Spec #88](https://github.com/web-dev-sayantan/retrocks/issues/88) · [Verification ticket #96](https://github.com/web-dev-sayantan/retrocks/issues/96)

## Production effect counts

Direct `createEffect(...)` call sites under `src`, excluding tests, fell from **48 to 30**. The count covers source call sites, so a call in a component that renders multiple instances counts once.

- Board Workspace went from 11 to 7, Group items from 3 to 1, Card items from 4 to 3, and Column panels from 4 to 3. Editor mounts handle initial input focus and cleanup. The workspace owns Board-scoped UI state and derives the active Column. Card reactions went from 1 to 0 by deriving effective visibility from availability.
- Action Items Drawer and Card Detail Drawer each went from 2 to 1. Drawer dismissal and focus cleanup follow the drawer lifecycle. Board Voting Settings went from 1 to 0 with a writable draft that follows the opening snapshot and preserves edits through live updates.
- Countdown Timer went from 4 to 2. The mounted countdown owns its tick interval. Mute preference loads at setup and changes persist when the user toggles mute.
- Poker Story Queue went from 2 to 0. The mounted confirmation owns its pending draft and focus. Story title editing went from 4 to 2, and Poker Workspace stayed at 2. Mounted editors own input setup, and title drafts are seeded when editing starts.
- The nine live synchronization call sites remained in place. See [Live synchronization effects](live-synchronization-effects.md).

## Retained effects

Beyond the nine live synchronization effects, the other 21 call sites serve these purposes.

- **Board Workspace (6).** Restore focus after Board renaming, focus the new Column input when it opens, reset the workspace and focus its unavailable heading on Board deletion, cancel Board and Column creation edits when the Board locks, dismiss Card Detail if its Card disappears, and scroll the active mobile tab into view after layout.
- **Card Group, Card Item, and Column Panel (7).** Restore focus after each corresponding inline editor closes. On Cards, cancel transient interactions on redaction or locking and clear peek state when the Card becomes visible. On Columns, close the menu and cancel renaming on lock, and register and release the composer as contribution eligibility or Column identity changes.
- **Action Items Drawer and Card Detail Drawer (2).** Sync a live Action Item owner to each uncontrolled input while its local draft is inactive.
- **Countdown Timer (2).** Play the expiry chime once for a deadline observed while running, and focus the settings panel when it opens.
- **Poker Workspace and Story title editor (4).** Cancel edits when room or Story identity or edit permission changes, including updates that arrive during an edit. Restore focus after editing ends if it has fallen back to the document body.

## Checks

The baseline passed 453 tests with two Vitest workers. `pnpm test --maxWorkers=2` yielded **465 passing tests across 50 files** on the reviewed implementation with both the jsdom client and Node server projects enabled. The baseline had a navigation `SILENT_HOLD` with default worker settings. The reported combined run used a fixture-only `SESSION_SECRET` and Solid diagnostics stayed enabled.

`pnpm typecheck`, `pnpm lint`, `pnpm knip`, `git diff --check 95aa0b4 ec32f51`, `pnpm build:node`, and `pnpm build` for Cloudflare Workers passed.

The automated suite covers editor draft and focus behavior, Action Item synchronization, Board navigation and Column fallback, timer expiry and announcement deduplication, Story deletion confirmation, and live persistence and claim cleanup.

Chrome smoke checks against local Node covered Board and Room SSR with JavaScript disabled, hydrated editing, drawer and timer focus, focus fallback after a desktop opener becomes hidden at a mobile width, a live Card update reaching a second Participant, Story deletion confirmation, and horizontal Column rail scrolling and Add Column focus with touch emulation. The browser checks used Chrome and Node. Workers runtime behavior is covered by its build and the adapter tests. Timer announcements were verified through live-region DOM updates.
