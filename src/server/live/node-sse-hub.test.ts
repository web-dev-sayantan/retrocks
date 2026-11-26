import { describe, expect, it, vi } from 'vitest';

import { LIVE_HEARTBEAT_MS } from '../../lib/live-protocol';
import { parsePokerLiveMessage } from '../../lib/poker-schemas';
import { parseBoardLiveMessage } from '../../lib/wire-schemas';
import { createNodeBoardStore } from '../adapters/node/sqlite-board-store';
import { createNodeBoardRealtime } from '../adapters/node/sse-board-realtime';
import type { BoardStore, LiveViewerContext } from '../adapters/types';
import { generateEntityId } from '../crypto';
import { openNodePokerRooms } from '../poker/node';
import { readSseStream } from './sse-test-helper';

describe('readSseStream shared test helper', () => {
  it('parses split multi-byte UTF-8 chunks and coalesced SSE frames reliably', async () => {
    const encoder = new TextEncoder();
    const frame1 = encoder.encode('data: {"type":"heartbeat"}\n\n');
    const emojiFrame = encoder.encode('data: {"type":"room:missing"}\n\n');
    const utf8Text = JSON.stringify({ type: 'presence:count', count: 3 });
    const frame3 = encoder.encode(`data: ${utf8Text}\n\n`);

    // Split frame1 across bytes, coalesce part of frame1 + emojiFrame, and split a 4-byte UTF-8 payload.
    const emojiPayload = encoder.encode('data: {"type":"room:presence","online":["p-🚀"]}\n\n');
    const rocketByteIndex = emojiPayload.indexOf(0xf0); // start of 4-byte 🚀 UTF-8 sequence
    expect(rocketByteIndex).toBeGreaterThan(0);

    const chunks = [
      frame1.slice(0, 10),
      new Uint8Array([...frame1.slice(10), ...emojiFrame]),
      emojiPayload.slice(0, rocketByteIndex + 2),
      new Uint8Array([...emojiPayload.slice(rocketByteIndex + 2), ...frame3]),
    ];

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
    const response = new Response(body, {
      headers: { 'content-type': 'text/event-stream' },
    });

    const stream = readSseStream(response, (raw) => JSON.parse(raw) as { type: string; online?: string[]; count?: number });
    expect(await stream.next()).toEqual({ type: 'heartbeat' });
    expect(await stream.next()).toEqual({ type: 'room:missing' });
    expect(await stream.next()).toEqual({ type: 'room:presence', online: ['p-🚀'] });
    expect(await stream.next()).toEqual({ type: 'presence:count', count: 3 });
    await stream.expectClosed();
  });
});

describe('Node SSE Board realtime lifecycle', () => {
  it('buffers concurrent mutations during async snapshot load, replays in version order, checks Facilitator role on heartbeat, and tears down cleanly on close()', async () => {
    const store = await createNodeBoardStore(':memory:');
    const boardId = generateEntityId();
    const now = Date.now();
    await store.createBoard({
      id: boardId,
      title: 'Replay Board',
      subtitle: '',
      templateId: 'standard',
      columns: [{ id: 'col-1', title: 'Went Well', accent: 'sage', position: 0, isActionColumn: false }],
      isBlurred: false,
      voteLimit: 5,
      maxVotesPerCard: 3,
      retentionDays: 30,
      facilitatorTokenHash: 'fac-hash',
      facilitatorTokenEncrypted: 'fac-enc',
      tokenSalt: 'salt-1',
      createdAt: now,
    });

    let releaseSnapshot!: () => void;
    const snapshotGate = new Promise<void>((resolve) => {
      releaseSnapshot = resolve;
    });
    let snapshotStarted!: () => void;
    const snapshotBegan = new Promise<void>((resolve) => {
      snapshotStarted = resolve;
    });

    const deferredStore: BoardStore = {
      ...store,
      async getBoardSnapshot(id, at) {
        const snapshot = await store.getBoardSnapshot(id, at);
        snapshotStarted();
        await snapshotGate;
        return snapshot;
      },
    };

    const realtime = createNodeBoardRealtime(async () => deferredStore);
    const facilitator: LiveViewerContext = { participantHash: 'hash-fac', isFacilitator: true };
    const participant: LiveViewerContext = { participantHash: 'hash-part', isFacilitator: false };

    try {
      const response = await realtime.handleLiveConnection(
        boardId,
        new Request(`https://retrocks.app/api/boards/${boardId}/live`),
        facilitator,
      );
      expect(response.headers.get('cache-control')).toBe('no-store, no-transform');
      expect(response.headers.get('x-accel-buffering')).toBe('no');

      // Wait until getBoardSnapshot has read v1 and is paused before returning.
      await snapshotBegan;

      // Commit v2 and v3 while the initial snapshot is still in flight; also publish a stale v1
      // frame to verify only versions strictly newer than snapshot.board.version are replayed.
      const v1Snapshot = await store.getBoardSnapshot(boardId);
      if (!v1Snapshot) throw new Error('Expected initial snapshot');
      await realtime.publish(boardId, { snapshot: v1Snapshot, events: [] });

      const v2 = await store.mutateBoard(
        boardId,
        facilitator,
        { type: 'card:create', id: 'card-1', columnId: 'col-1', content: 'First concurrent card' },
      );
      if (!v2.ok) throw new Error('v2 failed');
      await realtime.publish(boardId, { snapshot: v2.snapshot, events: v2.rawEvents });

      const v3 = await store.mutateBoard(
        boardId,
        facilitator,
        { type: 'card:create', id: 'card-2', columnId: 'col-1', content: 'Second concurrent card' },
      );
      if (!v3.ok) throw new Error('v3 failed');
      await realtime.publish(boardId, { snapshot: v3.snapshot, events: v3.rawEvents });

      // Release v1 snapshot: stream must receive v1 snapshot, then v2, then v3, then presence:count.
      releaseSnapshot();
      const stream = readSseStream(response, parseBoardLiveMessage);

      const snapshotMsg = await stream.next();
      expect(snapshotMsg).toMatchObject({ type: 'board:snapshot', version: 1 });
      if (snapshotMsg.type !== 'board:snapshot' || !snapshotMsg.connectionId) {
        throw new Error('Expected board:snapshot with connectionId');
      }

      const replay2 = await stream.next();
      expect(replay2).toMatchObject({
        type: 'board:mutation',
        version: 2,
        events: [{ type: 'card:upserted', card: { content: 'First concurrent card' } }],
      });
      const replay3 = await stream.next();
      expect(replay3).toMatchObject({
        type: 'board:mutation',
        version: 3,
        events: [{ type: 'card:upserted', card: { content: 'Second concurrent card' } }],
      });
      expect(await stream.next()).toEqual({ type: 'presence:count', count: 1 });

      // Heartbeat verifies BOTH participantHash AND isFacilitator.
      expect(
        realtime.recordHeartbeat(boardId, snapshotMsg.connectionId, {
          participantHash: facilitator.participantHash,
          isFacilitator: false,
        }),
      ).toBe(false);
      expect(realtime.recordHeartbeat(boardId, snapshotMsg.connectionId, participant)).toBe(false);
      expect(realtime.recordHeartbeat(boardId, snapshotMsg.connectionId, facilitator)).toBe(true);
      expect(await stream.next()).toEqual({ type: 'heartbeat' });

      // Explicit close() tears down active streams and clears presence.
      realtime.close();
      expect(await realtime.getPresenceCount(boardId)).toBe(0);
      expect(realtime.recordHeartbeat(boardId, snapshotMsg.connectionId, facilitator)).toBe(false);
      await stream.expectClosed();
    } finally {
      realtime.close();
      store.close();
    }
  });

  it('cleans up cleanly without throwing when a connection aborts mid-snapshot or concurrently with publish', async () => {
    const store = await createNodeBoardStore(':memory:');
    const boardId = generateEntityId();
    await store.createBoard({
      id: boardId,
      title: 'Abort Board',
      subtitle: '',
      templateId: 'standard',
      columns: [{ id: 'col-1', title: 'Went Well', accent: 'sage', position: 0, isActionColumn: false }],
      isBlurred: false,
      voteLimit: 5,
      maxVotesPerCard: 3,
      retentionDays: 30,
      facilitatorTokenHash: 'fac-hash',
      facilitatorTokenEncrypted: 'fac-enc',
      tokenSalt: 'salt-1',
      createdAt: Date.now(),
    });

    let releaseSnapshot!: () => void;
    const snapshotGate = new Promise<void>((resolve) => {
      releaseSnapshot = resolve;
    });
    let snapshotStarted!: () => void;
    const snapshotBegan = new Promise<void>((resolve) => {
      snapshotStarted = resolve;
    });

    const deferredStore: BoardStore = {
      ...store,
      async getBoardSnapshot(id, at) {
        snapshotStarted();
        await snapshotGate;
        return store.getBoardSnapshot(id, at);
      },
    };

    const realtime = createNodeBoardRealtime(async () => deferredStore);
    const viewer: LiveViewerContext = { participantHash: 'hash-abort', isFacilitator: true };
    const abort = new AbortController();

    try {
      const response = await realtime.handleLiveConnection(
        boardId,
        new Request(`https://retrocks.app/api/boards/${boardId}/live`, { signal: abort.signal }),
        viewer,
      );
      await snapshotBegan;

      // Abort before snapshot finishes, then release snapshot and publish a mutation.
      abort.abort();
      releaseSnapshot();
      await Promise.resolve();
      await Promise.resolve();

      const mutation = await store.mutateBoard(
        boardId,
        viewer,
        { type: 'card:create', id: 'card-abort', columnId: 'col-1', content: 'After abort' },
      );
      if (!mutation.ok) throw new Error('mutation failed');
      await expect(
        realtime.publish(boardId, { snapshot: mutation.snapshot, events: mutation.rawEvents }),
      ).resolves.toBeUndefined();

      expect(await realtime.getPresenceCount(boardId)).toBe(0);
      const stream = readSseStream(response, parseBoardLiveMessage);
      await stream.expectClosed();
    } finally {
      realtime.close();
      store.close();
    }
  });

  it('evicts a stalled subscriber during mutation fan-out and broadcasts updated presence to healthy viewers', async () => {
    const store = await createNodeBoardStore(':memory:');
    const boardId = generateEntityId();
    await store.createBoard({
      id: boardId,
      title: 'Backpressure Board',
      subtitle: '',
      templateId: 'standard',
      columns: [{ id: 'col-1', title: 'Went Well', accent: 'sage', position: 0, isActionColumn: false }],
      isBlurred: false,
      voteLimit: 5,
      maxVotesPerCard: 3,
      retentionDays: 30,
      facilitatorTokenHash: 'fac-hash',
      facilitatorTokenEncrypted: 'fac-enc',
      tokenSalt: 'salt-1',
      createdAt: Date.now(),
    });

    const realtime = createNodeBoardRealtime(async () => store);
    const healthyViewer: LiveViewerContext = { participantHash: 'hash-healthy', isFacilitator: true };
    const stalledViewer: LiveViewerContext = { participantHash: 'hash-stalled', isFacilitator: false };
    const liveUrl = `https://retrocks.app/api/boards/${boardId}/live`;

    try {
      const healthy = readSseStream(
        await realtime.handleLiveConnection(boardId, new Request(liveUrl), healthyViewer),
        parseBoardLiveMessage,
      );
      await healthy.until('board:snapshot');

      // Open stalled connection and never read its body.
      const stalledResponse = await realtime.handleLiveConnection(boardId, new Request(liveUrl), stalledViewer);
      expect(stalledResponse.status).toBe(200);
      await healthy.until('presence:count', (m) => m.count === 2);

      const snapshot = await store.getBoardSnapshot(boardId);
      if (!snapshot) throw new Error('Expected Board snapshot');

      // Publish mutations while draining the healthy stream; stalled stream is evicted once queue depth hits threshold.
      for (let i = 0; i < 135; i += 1) {
        await realtime.publish(boardId, { snapshot, events: [] });
        await healthy.until('board:mutation');
        if ((await realtime.getPresenceCount(boardId)) === 1) break;
      }

      expect(await realtime.getPresenceCount(boardId)).toBe(1);
      expect(await healthy.until('presence:count', (m) => m.count === 1)).toEqual({
        type: 'presence:count',
        count: 1,
      });
      await healthy.close();
      await stalledResponse.body?.cancel();
    } finally {
      realtime.close();
      store.close();
    }
  });
});

describe('Node SSE Pointing Poker Room lifecycle', () => {
  it('prunes timed-out Room peers, deduplicates Participant tabs, and broadcasts updated room:presence', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const rooms = await openNodePokerRooms(':memory:');
    const streams: Array<{ close(): Promise<void> }> = [];
    try {
      const roomId = generateEntityId();
      const created = rooms.create(roomId, 'facilitator', 'Alex');
      const join = rooms.mutate(roomId, 'participant', { type: 'join', displayName: 'Sam' });
      if (!join.ok || join.room.closed || created.closed || !created.viewer || !join.room.viewer) {
        throw new Error('Expected open Room with two Participants');
      }
      const alexId = created.viewer.id;
      const samId = join.room.viewer.id;

      const alexTab1 = readSseStream(
        rooms.connect(roomId, 'facilitator', new Request('https://retrocks.app/live')),
        parsePokerLiveMessage,
      );
      const alexTab2 = readSseStream(
        rooms.connect(roomId, 'facilitator', new Request('https://retrocks.app/live')),
        parsePokerLiveMessage,
      );
      const samTab = readSseStream(
        rooms.connect(roomId, 'participant', new Request('https://retrocks.app/live')),
        parsePokerLiveMessage,
      );
      streams.push(alexTab1, alexTab2, samTab);

      const alex1Snap = await alexTab1.until('room:snapshot');
      const alex2Snap = await alexTab2.until('room:snapshot');
      await samTab.until('room:snapshot');

      // Duplicate tabs from Alex are deduplicated into one Participant ID.
      const presence = await alexTab1.until('room:presence', (m) => m.online.length === 2);
      expect(presence.online).toEqual([alexId, samId]);

      // Close Alex's second tab: Alex remains online because tab 1 is still active.
      await alexTab2.close();
      expect(await alexTab1.until('room:presence')).toEqual({
        type: 'room:presence',
        online: [alexId, samId],
      });
      expect(rooms.heartbeat(roomId, 'facilitator', alex2Snap.connectionId!)).toBe(false);

      // Keep Alex's tab 1 alive while Sam stops sending heartbeats.
      for (let i = 0; i < 2; i += 1) {
        vi.advanceTimersByTime(LIVE_HEARTBEAT_MS);
        expect(rooms.heartbeat(roomId, 'facilitator', alex1Snap.connectionId!)).toBe(true);
        expect(await alexTab1.until('heartbeat')).toEqual({ type: 'heartbeat' });
      }

      // On the 3rd sweep (90s > 65s timeout), Sam is pruned and Alex receives updated presence.
      vi.advanceTimersByTime(LIVE_HEARTBEAT_MS);
      expect(await alexTab1.until('room:presence', (m) => m.online.length === 1)).toEqual({
        type: 'room:presence',
        online: [alexId],
      });
      await samTab.until('room:presence');
      // Drain remaining buffered frames on Sam's stream and confirm it closed.
      while (true) {
        try {
          await samTab.next();
        } catch {
          break;
        }
      }
    } finally {
      await Promise.all(streams.map((stream) => stream.close()));
      rooms.close();
      vi.useRealTimers();
    }
  });

  it('detects Room expiry during POST heartbeat and heartbeat sweep, delivering room:missing before closing', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: Date.UTC(2026, 0, 1) });
    const rooms = await openNodePokerRooms(':memory:');
    const day = 24 * 60 * 60 * 1000;
    try {
      // Case 1: Expiry detected on incoming POST heartbeat.
      const room1 = generateEntityId();
      rooms.create(room1, 'facilitator', 'Alex');
      const stream1 = readSseStream(
        rooms.connect(room1, 'facilitator', new Request('https://retrocks.app/live')),
        parsePokerLiveMessage,
      );
      const snap1 = await stream1.until('room:snapshot');
      await stream1.until('room:presence');

      // Advance Date past the 90-day Room TTL without firing sweep intervals.
      vi.setSystemTime(Date.UTC(2026, 0, 1) + 91 * day);
      expect(rooms.heartbeat(room1, 'facilitator', snap1.connectionId!)).toBe(true);
      expect(await stream1.next()).toEqual({ type: 'room:missing' });
      await stream1.expectClosed();

      // Case 2: Expiry detected during periodic heartbeat sweep.
      const baseTime = Date.UTC(2026, 6, 1);
      vi.setSystemTime(baseTime);
      const room2 = generateEntityId();
      rooms.create(room2, 'facilitator', 'Alex');
      const stream2 = readSseStream(
        rooms.connect(room2, 'facilitator', new Request('https://retrocks.app/live')),
        parsePokerLiveMessage,
      );
      await stream2.until('room:snapshot');
      await stream2.until('room:presence');

      // Jump clock past expiry and advance one heartbeat interval so the sweep fires.
      vi.setSystemTime(baseTime + 91 * day);
      vi.advanceTimersByTime(LIVE_HEARTBEAT_MS);
      expect(await stream2.next()).toEqual({ type: 'room:missing' });
      await stream2.expectClosed();
    } finally {
      rooms.close();
      vi.useRealTimers();
    }
  });
});
