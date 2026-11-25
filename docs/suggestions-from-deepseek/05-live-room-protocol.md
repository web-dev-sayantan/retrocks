# Live Room Protocol

> Status: ready-for-agent
> Source: architecture review, 24 November 2026

## Problem Statement

Board and Pointing Poker both keep Participants live, and both run on Cloudflare WebSockets and Node SSE. Today each feature implements presence, heartbeat timeout, fan-out, terminal frames, and SSE framing separately for each runtime. A Participant can see a stale presence count, a closed Room can keep a connection open, or a deleted Board can miss its terminal frame because one adapter applied a different policy. Frame writing is also reimplemented in tests with different offsets, so protocol changes are verified differently depending on the suite.

## Solution

Extract one LiveRoom hub over a small connection adapter. The hub owns the connection registry, presence, heartbeat timeout, fan-out, backpressure, terminal-frame delivery, and frame ordering. One shared SSE codec owns the wire framing. A feature supplies its message type, viewer projection, and terminal predicate; a runtime supplies the transport that opens and closes connections. Board and Poker keep their own projections and wire formats, but stop rewriting the lifecycle around them.

## User Stories

1. As a Board Participant, I want live snapshots, mutations, presence, and deletion notices delivered as before, so that collaboration does not regress.
2. As a Pointing Poker Participant, I want live Room snapshots, presence, missing notices, and closed summaries delivered as before, so that estimation stays live.
3. As a Participant, I want presence to count unique Participants rather than connections, so that a reconnect or second tab does not inflate the online count.
4. As a Participant, I want a stale connection to be closed after the heartbeat timeout, so that presence does not include a Participant who is gone.
5. As a Participant, I want my heartbeat to refresh only my own connection, so that I cannot keep another Participant's connection alive.
6. As a Participant on a slow or stalled connection, I want the server to close it rather than buffer without bound, so that one client cannot exhaust server memory.
7. As a Participant reconnecting, I want the first message to be a fresh viewer-projected snapshot, so that I catch up before applying mutations.
8. As a Participant, I want a deleted Board to receive its terminal frame and then close, so that I am not left on a dead Board.
9. As a Participant, I want a closed Room to receive its closed summary, so that the final Accepted Estimates remain visible.
10. As a Participant, I want an expired or missing Room to receive a terminal notice and close, so that stale controls disappear.
11. As a Participant, I want Board and Poker to behave the same on both runtimes, so that deployment choice does not change live behavior.
12. As a Participant, I want a terminal frame to be the last message on a connection, so that no later mutation can reanimate a closed Room or deleted Board.
13. As a Participant, I want reconnect and presence behavior to remain unchanged on the client, so that the protocol extraction is invisible.
14. As a maintainer, I want one SSE frame codec, so that tests and adapters cannot disagree about the `data:` prefix or double newline.
15. As a maintainer, I want to add a live feature by supplying a message type, projection, and terminal predicate, so that I do not copy presence and timeout logic.
16. As a maintainer, I want to add a runtime by implementing one connection adapter, so that the hub and feature logic stay unchanged.
17. As a maintainer, I want one presence and timeout policy, so that a fix lands in both Board and Poker at once.
18. As a maintainer, I want the hub to be testable with an in-memory connection adapter, so that lifecycle cases do not need a real WebSocket or SSE stream.
19. As a maintainer, I want feature projections to stay separate, so that Board Private Mode and Poker ballot privacy are not generalized into a leaky shared message type.
20. As a maintainer, I want the existing Board and Poker realtime seams preserved, so that ADR-0002's HTTP-write and push-read split does not move.

## Implementation Decisions

- Introduce a runtime-agnostic LiveRoom hub parameterized by message type. Its interface covers join, leave, heartbeat, publish, presence count, terminal close, and dispose. It owns the connection registry, last-seen timestamps, timeout, unique-Participant presence, fan-out, backpressure, and terminal-frame ordering.
- The hub takes a connection adapter per connection: send a serialized frame, close with a code and reason, and report open state or pressure. It does not know whether the transport is a WebSocket or an SSE stream.
- A feature adapter supplies: the viewer context, a stable Participant identity for presence, a viewer projection for each message, a terminal predicate, and a first-message snapshot. Board and Poker keep their own message unions and projections.
- Define one SSE frame codec for serializing and parsing a frame. Both Node adapters and their tests use it; no suite slices the `data:` prefix by hand.
- The Cloudflare adapters keep their Durable Object entry points and hibernatable WebSocket concerns. The hub sits inside each object and receives accepted sockets through the connection adapter; attachment serialization remains runtime-specific.
- The Node adapters keep their readable-stream and abort-signal concerns. The hub receives stream controllers through the connection adapter; SSE headers and HTTP response construction remain runtime-specific.
- Presence is computed from the feature's Participant identity, not from the connection id. A reconnect with the same identity replaces presence; leaving removes only that connection.
- Heartbeat policy: a ping refreshes only the matching connection; a connection older than the timeout is closed and removed from presence; the hub sends the heartbeat acknowledgement through the feature's message type.
- Terminal policy: the feature decides when a message is terminal; the hub sends it, then closes the connection and skips any later publish for that connection. A terminal message must not be followed by a mutation.
- Backpressure policy: a connection that exceeds the queue limit is closed and removed from presence; do not buffer unbounded.
- Keep the existing Board realtime and Poker room-access seams at the feature interface. The hub is an internal shared module; callers still publish through the same feature interface.
- Do not change any wire format, viewer projection, redaction rule, or terminal message shape. This is a protocol lifecycle extraction, not a protocol redesign.
- Preserve ADR-0002's split: hub work happens only in the server-to-client live fan-out; HTTP mutations and the client reconnect strategy are unchanged.

## Testing Decisions

- Primary seam: the `LiveRoomHub` interface with an in-memory connection adapter. Runtime adapters are contract-tested around it.
- A good test drives the hub through its interface with an in-memory connection adapter and asserts observable frames, presence, and closes. It should not assert which internal map or timer handled a connection.
- Test the hub for join, leave, duplicate identity, heartbeat refresh, timeout close, backpressure close, fan-out to multiple viewers, terminal ordering, and no publish after terminal.
- Test the SSE codec with round-trip and malformed frames, including multi-line data and the exact separator. Use it in the adapter tests instead of hand-slicing.
- Test each runtime adapter as a contract test: open a connection, receive a snapshot, send a heartbeat, close, and observe the transport-specific cleanup.
- Keep feature projection tests unchanged: Board Private Mode and Blind Voting, Poker ballot privacy and closed summaries. The hub must not become the place where redaction is tested.
- Keep Board and Poker controller tests using the injected live transport; assert that the client behavior is unchanged.
- Delete duplicate presence, timeout, and frame-parsing tests from the four old adapter suites once the hub and codec tests cover the policy.
- Prior art: the existing Board live handler suite, the Board Room tests, the Pointing Poker Node live tests, and the Durable Object tests.

## Out of Scope

- Changing Board or Pointing Poker wire formats, message shapes, or viewer projections.
- Changing Private Mode, Blind Voting, or ballot privacy rules.
- Changing HTTP mutation handling, persistence, storage schemas, or the Board store seam.
- Changing the client live-stream reconnect, visibility, or heartbeat strategy.
- Redesigning presence UI, Room summaries, or Board status indicators.
- Changing ADR-0004 reopening semantics or Room retention.
- Merging Board and Poker projections or message types into one feature-agnostic payload.
- Replacing the runtime choice or the Durable Object and Node deployment model.

## Further Notes

- A prior Pointing Poker protocol and live-stream draft explicitly parked realtime fan-out consolidation as out of scope. This spec deliberately revisits that scope decision because the duplication now spans four adapters, not two.
- If the protocol hygiene spec lands first, reuse its shared frame parser and keep this hub as the lifecycle layer.
- The hub is a ports-and-adapters module: two feature adapters and two runtime adapters justify the seam. A single adapter would not.
- The hub should not own feature authorization or projection. It moves frames; it does not decide what a Participant may see.
