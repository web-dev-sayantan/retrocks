# Pointing Poker Room Session

> Status: ready-for-agent
> Source: architecture review, 24 November 2026

## Problem Statement

A Pointing Poker Room can be unjoined, live, closed, reopened, or unavailable, and the same Room can arrive from a route snapshot, a Co-Facilitator Link claim, a live frame, or a reopen response. Today that lifecycle is spread across nested route modules and the Room controller. Three local caches compare versions with different tie-breaks, two paths reopen a closed Room, and the unavailable callback is passed down several layers. A Participant can see a stale Room after a live update, and a Facilitator can reopen into a screen that disagrees with the Room the server just returned.

## Solution

Put the Room lifecycle in one route-level session. The session owns one authoritative Room snapshot, the live subscription, presence, command execution, Co-Facilitator Link claiming, reopen, and unavailable transitions. It applies one precedence rule to every source. The route and its panels render the session's current phase and Room; they no longer keep their own version caches or reopen paths.

## User Stories

1. As a Participant opening a Room link, I want the Room to load into the join screen when I have no Display Name, so that I can enter a Room without a reload.
2. As a Participant with a Display Name, I want to enter the live Room and see the current Stories, Deck, and Voting Round, so that I can estimate immediately.
3. As a Facilitator opening a Co-Facilitator Link, I want the URL fragment claimed once and scrubbed from the address bar, so that the capability does not linger in browser history.
4. As a Facilitator claiming a link before joining, I want the claim to persist through the join screen, so that entering my Display Name completes the role.
5. As a Facilitator claiming a link on a closed Room, I want the closed summary to reflect my role without exposing stale live controls, so that I can reopen or delete deliberately.
6. As a Facilitator claiming a link on an unavailable Room, I want the fragment scrubbed and the unavailable state shown, so that a dead link does not leave a secret in the URL.
7. As a Participant, I want a newer live Room snapshot to replace the current Room, so that Stories, votes, and presence stay current.
8. As a Participant, I want an older live snapshot or a snapshot for a different Room to be ignored, so that out-of-order frames cannot regress the Room.
9. As a Participant, I want a closed snapshot at the same version as an open snapshot to win, so that a Room closing while I am connected cannot be undone by a late open frame.
10. As a Facilitator, I want a claim result to replace a viewerless snapshot at the same version, so that my newly claimed role is visible without waiting for a version bump.
11. As a Facilitator, I want closing a Room from the workspace to move every connected viewer to the closed summary, so that the final Accepted Estimates are the only live state.
12. As a Facilitator, I want reopening a closed Room to use one path whether I reopen from the summary or after a live close, so that the result is the same.
13. As a Facilitator reopening a closed Room, I want prior Stories marked as Locked Stories, the Participant roster cleared, and pending Facilitator claims restored per ADR-0004, so that the prior session is protected.
14. As a Participant rejoining a reopened Room, I want to see the Display Name join screen rather than stale participants, so that the new session starts clean.
15. As a Participant, I want a deleted or expired Room to move to the unavailable state and dispose the live stream, so that I am not left on stale controls.
16. As a Participant, I want presence to clear when I leave, when the Room closes, or when the stream is disposed, so that the online count does not include me after I am gone.
17. As a Participant, I want the join screen heading to receive focus after a reopen, so that keyboard and screen-reader users land on the next action.
18. As a Participant, I want my recent-Rooms list to record the current Room once per name change, so that navigation history stays accurate without duplicate writes.
19. As a maintainer, I want one `PokerRoomSession` interface that exposes the current Room, phase, presence, and commands, so that lifecycle bugs have one place to live.
20. As a maintainer, I want one version-precedence function applied to route snapshots, claims, live frames, and reopen results, so that the sources cannot disagree.
21. As a maintainer, I want one reopen path and one unavailable path, so that the closed and live branches cannot diverge.
22. As a maintainer, I want the route to render from session phases instead of three nested lifecycle wrappers, so that App tests do not have to drive the whole tree.
23. As a maintainer, I want to delete the separate reopened, claimed, and controller version caches, so that the Room has one source of truth.
24. As a maintainer, I want the session to accept injected command, live, fragment, and history adapters, so that the full lifecycle is testable without a browser router or network.

## Implementation Decisions

- Promote the existing Room controller to a route-level session. The session owns the single authoritative Room snapshot; do not keep a separate reopened cache, claimed cache, or controller store.
- Define a session interface with `room()`, `phase()`, `online()`, `status()`, `change(command)`, `claim(token)`, `reopen()`, `markUnavailable()`, and `dispose()`. Expose claim pending and claim error as part of the session state.
- Derive the phase from the snapshot and viewer: `unavailable`, `join` when there is no viewer, `live` when the Room is open and a viewer exists, and `closed` when the Room is closed and presents the summary.
- Apply one precedence function to every incoming snapshot: ignore a different Room id; a higher version wins; at the same version, a closed Room wins over an open Room on live snapshots; a claim result may replace a viewerless snapshot at the same version; otherwise keep the current Room. Explicit reopen results arrive at a higher version and follow the normal rule.
- Keep one reopen path. The summary and the live-closed transition both call `reopen()`; the session applies the result through the same precedence function and transitions to `join` when the reopened Room has no viewer.
- Preserve ADR-0004 on reopen: the server clears the Participant roster, turns prior Stories into Locked Stories, restores pending Facilitator claims, and issues a new Co-Facilitator Link on demand. The session must not resurrect a closed roster or cached Facilitator capability.
- Centralize Co-Facilitator Link claiming and fragment scrubbing in the session. Subscribe to hash changes once, take the fragment once, exchange it through the injected claim adapter, and scrub the URL before or as the exchange begins. Keep ADR-0001 semantics.
- Subscribe to the live stream only in the `live` phase with a viewer. Dispose it on close, unavailable, navigation, or session disposal; clear presence on every dispose.
- Execute commands against the session's store using the shared command rules; do not mount a second Room controller. Command results and live frames enter through the same precedence function.
- Record the current Room in local history once per id or name change, and remove it when the Room becomes unavailable. Do not duplicate the write in route branches.
- Expose phase transitions so the route can focus the join heading after reopen and the closed heading on a closed Room. Focus remains a route concern; the session does not touch the DOM.
- Accept injected adapters for command execution, live transport, fragment/history access, local history, and timers so the session is testable without a browser.

## Testing Decisions

- Primary seam: the `PokerRoomSession` interface with injected command, live, fragment, and history adapters. Route tests cover wiring only.
- A good test crosses the session interface with an initial snapshot and controlled adapters, then asserts the current Room, phase, presence, and emitted commands. It should not assert which internal cache or version branch handled a frame.
- Cover every phase transition: join, live, close from command, close from live frame, reopen from summary, reopen after live close, delete, expiry, and unavailable.
- Cover precedence: newer version, older version, different id, same-version open versus closed, same-version claim over a viewerless snapshot, and a stale claim result.
- Cover ADR-0004: reopen clears the roster, returns to the join screen, preserves prior Stories as Locked Stories, and does not restore a stale viewer or capability.
- Cover fragment claiming and scrubbing once across live, closed, and unavailable initial states, including a hash change while mounted.
- Cover live disposal and presence clearing on close, unavailable, navigation, and session disposal.
- Keep route-level App tests for wiring, visible headings, and focus outcomes. They should not re-test version precedence or reopen internals.
- Delete duplicate precedence and reopen tests from the route wrappers and controller once the session matrix exists.
- Prior art: the existing Room controller suite and the App reopen and live-name tests.

## Out of Scope

- Panel-level busy, error, and single-flight coordination across Story queue, Deck settings, Voting Round, and title editors.
- Inline title editing or focus behavior inside a panel.
- Changing server-side Room storage, SQL, Durable Object/Node adapters, or the 90-day expiry rule.
- Changing ADR-0003 Display Name rules or ADR-0004 reopening semantics.
- Consolidating Pointing Poker command semantics; the session consumes a command interface and does not define a second rulebook.
- Consolidating live protocol framing, presence, or heartbeat mechanics across Board and Poker.
- Redesigning the Room workspace, summary, or join form.
- Cross-device history or server-side recent Rooms.

## Further Notes

- A broader Room session draft also covers panel-level single-flight, inline editing, and recent-Room side effects. This spec is the lifecycle and precedence slice. If both are adopted, merge them into one session rather than nesting a second controller.
- If the shared command-rules spec is adopted, the session should call that module for optimistic and authoritative decisions instead of reintroducing command logic.
- If the shared live protocol spec is adopted, the session should consume the hub through the existing live transport interface; the session's phase rules stay the same.
- The session is a deep module: a small interface, a large lifecycle implementation, and one test surface. The route becomes a renderer.
