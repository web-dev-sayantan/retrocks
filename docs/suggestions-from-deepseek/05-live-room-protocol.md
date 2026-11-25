# Live Room Protocol

> Status: partially implemented. Shared SSE framing remains open. A cross-runtime hub is deferred.

## Current checkout

- [The client live-stream module](../../src/lib/live-stream.ts) already owns connection setup, heartbeat, and reconnect. Board and Pointing Poker controllers supply their own parsing, handshake, terminal detection, and message callbacks directly. Poker protocol types are inferred from [Valibot schemas](../../src/lib/poker-schemas.ts).
- [Poker publication](../../src/server/poker/publication.ts) already shares commit eligibility, viewer projection, and terminal classification across Node and Cloudflare. [Board live projection](../../src/server/domain/live-projection.ts) likewise provides the feature's viewer-specific message construction.
- [Node Board realtime](../../src/server/adapters/node/sse-board-realtime.ts) and [Node Poker realtime](../../src/server/poker/node.ts) still write the same SSE JSON framing independently. Integration tests also extract the payload directly.
- Connection handling remains runtime-specific. The Node implementations use streams, timers, and authenticated heartbeat requests. The [Board Durable Object](../../src/server/adapters/cloudflare/board-room.ts) and [Poker Durable Object](../../src/server/poker/durable-room.ts) enumerate hibernatable sockets and read attachments. All four already deduplicate presence. Board reports a count and Poker reports Participant IDs.

## Remaining proposal

As a maintainer, I want both Node adapters and their tests to use one SSE framing implementation so they agree on what goes on the wire.

1. Extract an encoder for JSON `data:` records and reuse it in both Node adapters. For tests, use a reader that handles complete records across stream chunks and hands payloads to the existing feature parsers. Keep the browser's native `EventSource` flow.
2. Preserve each feature's initial and terminal messages. Board Node subscribes before its asynchronous snapshot read and replays queued messages newer than the snapshot. Poker sends a closed summary on closure or `room:missing` on deletion or expiry. Preserve terminal delivery and teardown for healthy connections, and preserve the existing pressure handling for stalled connections.
3. Reassess fan-out helpers only after the framing slice. Candidate reuse should account for hibernation, runtime-owned cleanup, and existing version guards. Keep the Durable Object socket inventory in the runtime and the Node stream registries in Node. A single in-memory hub would need to demonstrate that it preserves those contracts before adoption.

Keep the HTTP-write and live-read split from [ADR-0002](../adr/0002-dual-runtime-adapters-and-http-mutations.md). Use the landed parts of the [Poker protocol and live-stream spec](../poker-protocol-and-live-stream-spec.md) and [Room publication spec](../room-mutation-publication-spec.md) as the starting point.

## Verification

Check the serialized record separator and JSON payload. Test the reader with split and coalesced records. Reuse [Board live-handler](../../src/server/live-handler.test.ts), [Poker Room](../../src/server/poker/room.test.ts), and [Story queue](../../src/server/poker/story-queue.test.ts) integration coverage for initial snapshots, viewer-specific frames, and terminal delivery. Any later lifecycle extraction should also cover heartbeat ownership, duplicate connections, timeout and abort cleanup, pressure, and the Board snapshot replay and stale-publication guards in the appropriate runtime tests.
