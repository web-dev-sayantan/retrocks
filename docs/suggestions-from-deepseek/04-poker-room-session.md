# Pointing Poker Room Session

> Status: implemented by #114 and extended by #115.

## Delivered

The [Room route](../../src/routes/p/%5Bid%5D.tsx) mounts one [Room controller](../../src/lib/poker-controller.ts) for the route ID. It renders the join form, live workspace, closed summary, or unavailable page from the controller's state. The route owns join form submission and heading focus. The controller owns the phase, snapshot precedence, live subscription and presence, fragment claim flow, history updates, and reopening.

- Route snapshots, live frames, claim results, and successful Room changes use the same snapshot acceptance logic. Older and foreign snapshots are rejected. At equal versions a closed snapshot takes precedence over an open one. Equal-version open snapshots can add a viewer or upgrade a Facilitator role, and downgrade attempts are ignored.
- `reopenRoom()` is single-flight and uses the existing command flow. A successful reopen returns the view to `unjoined` when there is no viewer. Server-side reopen behavior follows [ADR-0004](../adr/0004-reopening-closed-pointing-poker-rooms.md).
- The stream follows the live Room and joined viewer. Closing, unavailability, or owner disposal tears it down and clears presence. Missing and deleted Rooms enter the unavailable phase.
- The controller uses the shared [Co-Facilitator Link helper](../../src/lib/facilitator-link.ts) for fragment claiming and scrubbing, and the recent-Room adapter for joined Room updates, closed Room updates when already saved, and removal when unavailable.
- `changeRoom()` coordinates a single in-flight Room mutation across panels, including time spent confirming discard. It exposes shared busy and error state and forwards the confirmed Voting Round ID. This also delivers the mutation coordination described in the broader Room session draft.

## Verification

The [controller suite](../../src/lib/poker-controller.test.tsx) exercises snapshot reconciliation, close and reopen, absence, fragment claims, recent Rooms, concurrent commands, and stale confirmation with injected dependencies. [App tests](../../src/App.test.tsx) exercise route wiring and visible transitions. Use these interfaces for future lifecycle changes.
