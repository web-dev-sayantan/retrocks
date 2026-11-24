# Solid 2.0 effect verification

Issue [#96](https://github.com/web-dev-sayantan/retrocks/issues/96) verifies the combined implementation for [#88](https://github.com/web-dev-sayantan/retrocks/issues/88) from baseline `95aa0b4` through `0053afe8`.

## Production effect counts

Direct `createEffect(...)` call sites under `src`, excluding tests, fell from **48 to 31**. The count covers source call sites, so a call in a component that renders multiple instances counts once.

- Board Workspace went from 11 to 7, Group items from 3 to 1, Card items from 4 to 3, and Column panels from 4 to 3. Editor mounts handle initial input focus and cleanup. The workspace owns Board-scoped UI state and derives the active Column. Card reactions went from 1 to 0 by deriving effective visibility from availability.
- Action Items Drawer and Card Detail Drawer each went from 2 to 1. Drawer dismissal and focus cleanup follow the drawer lifecycle. Voting Settings stayed at 1 and samples the settings at open time.
- Countdown Timer went from 4 to 2. The mounted countdown owns its tick interval. Mute preference loads at setup and changes persist when the user toggles mute.
- Poker Story Queue went from 2 to 0. The mounted confirmation owns its pending draft and focus. Story title editing went from 4 to 2, and Poker Workspace stayed at 2. Mounted editors own input setup, and title drafts are seeded when editing starts.
- The nine live synchronization call sites remained in place. See [Live synchronization effects](live-synchronization-effects.md).

## Retained effects

Beyond the nine live synchronization effects, the other 22 call sites serve these purposes.

- **Board Workspace (6).** Restore focus after Board renaming, focus the new Column input when it opens, reset the workspace and focus its unavailable heading on Board deletion, cancel Board and Column creation edits when the Board locks, dismiss Card Detail if its Card disappears, and scroll the active mobile tab into view after layout.
- **Card Group, Card Item, and Column Panel (7).** Restore focus after each corresponding inline editor closes. On Cards, cancel transient interactions on redaction or locking and clear peek state when the Card becomes visible. On Columns, close the menu and cancel renaming on lock, and register and release the composer as contribution eligibility or Column identity changes.
- **Action Items Drawer and Card Detail Drawer (2).** Sync a live Action Item owner to each uncontrolled input while its local draft is inactive.
- **Board Voting Settings (1).** Seed the form and its initial comparison values at each open while preserving edits made during the open session.
- **Countdown Timer (2).** Play the expiry chime once for a deadline observed while running, and focus the settings panel when it opens.
- **Poker Workspace and Story title editor (4).** Cancel edits when room or Story identity or edit permission changes, including updates that arrive during an edit. Restore focus after editing ends if it has fallen back to the document body.

## Checks

The baseline passed 453 tests with two Vitest workers. At `0053afe8`, the same worker limit and a fixture-only `SESSION_SECRET` yielded **463 passing tests across 50 files**, with both the jsdom client and Node server projects enabled. The baseline had a navigation `SILENT_HOLD` with default worker settings. The reported combined run uses two workers. Solid diagnostics stayed enabled in the Vite configuration.

`pnpm typecheck`, `pnpm lint`, `pnpm knip`, and `git diff --check 95aa0b4 0053afe8` passed.

The automated suite covers editor draft and focus behavior, Action Item synchronization, Board navigation and Column fallback, timer expiry, Story deletion confirmation, and live persistence and claim cleanup. Browser SSR and hydration, real focus and dismissal, mobile rail geometry and touch behavior, and Node and Workers builds are pending the separate browser and build checks.
