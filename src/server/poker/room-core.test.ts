import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { wrapDatabaseSync } from '../adapters/node/sqlite';
import { createBoardWriteRateLimiter } from '../rate-limit';
import { PokerRoomStorage } from './room';
import {
  bindPokerRoomAccess,
  createPokerRoomCore,
  missingPokerRoom,
  projectPokerPublication,
  type PokerRoomCore,
  type PokerRoomPublication,
  type PokerRoomRuntime,
  type PokerWriteRateLimiter,
} from './room-core';

const DAY_MS = 24 * 60 * 60 * 1000;
const START_MS = Date.UTC(2026, 0, 1);

describe('PokerRoomCore', () => {
  let db: DatabaseSync;
  let now: number;
  let publications: Array<{ id: string; publication: PokerRoomPublication }>;
  let scheduledExpiries: Array<{ id: string; expiresAt: number }>;
  let clearedExpiries: string[];
  let core: PokerRoomCore;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    now = START_MS;
    publications = [];
    scheduledExpiries = [];
    clearedExpiries = [];
    core = createPokerRoomCore(wrapDatabaseSync(db), {
      now: () => now,
      publisher: {
        publish(id, publication) {
          publications.push({ id, publication });
        },
      },
      scheduleExpiry(id, expiresAt) {
        scheduledExpiries.push({ id, expiresAt });
      },
      clearExpiry(id) {
        clearedExpiries.push(id);
      },
    });
  });

  afterEach(() => {
    db.close();
  });

  test('creates a Room, schedules 90-day expiry using the injected clock, and projects views for Facilitator vs unjoined visitor', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(0);
    try {
      const created = await core.create('room-1', 'fac-hash', 'Alex', '  Sprint 14  ');

      expect(created).toMatchObject({
        closed: false,
        id: 'room-1',
        name: 'Sprint 14',
        version: 1,
        viewer: { displayName: 'Alex', isFacilitator: true },
        participants: [{ displayName: 'Alex', isFacilitator: true }],
        stories: [],
        activeStoryId: null,
        deckType: 'fibonacci',
        round: null,
      });
      expect(scheduledExpiries).toEqual([{ id: 'room-1', expiresAt: START_MS + 90 * DAY_MS }]);
      expect(publications).toEqual([]);
      expect(dateNowSpy).not.toHaveBeenCalled();

      const visitorView = await core.read('room-1', 'visitor-hash');
      expect(visitorView).toEqual({
        closed: false,
        id: 'room-1',
        name: 'Sprint 14',
        version: 1,
        viewer: null,
        participants: [],
        stories: [],
        activeStoryId: null,
        deck: [],
        deckType: 'fibonacci',
        round: null,
      });

      expect(await core.read('missing-room', 'fac-hash')).toBeNull();
      expect(publications).toEqual([]);
      expect(clearedExpiries).toEqual([]);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  test('projects open, revealed, accepted, and closed Voting Round views per viewer and enforces publication emission/suppression', async () => {
    await core.create('room-1', 'fac-hash', 'Alex');
    scheduledExpiries.length = 0;

    // Join emits a non-terminal snapshot but does not reschedule expiry.
    const joined = await core.mutate('room-1', 'voter-hash', { type: 'join', displayName: 'Sam' });
    expect(joined).toMatchObject({ ok: true, room: { viewer: { displayName: 'Sam', isFacilitator: false } } });
    expect(publications).toHaveLength(1);
    expect(publications[0]).toMatchObject({ id: 'room-1', publication: { type: 'snapshot', terminal: false } });
    expect(scheduledExpiries).toEqual([]);

    // Idempotent no-op join and rejected non-Facilitator mutation suppress publication and expiry updates.
    publications.length = 0;
    expect(await core.mutate('room-1', 'voter-hash', { type: 'join', displayName: 'Different' })).toMatchObject({
      ok: true,
      room: { version: 2 },
    });
    expect(await core.mutate('room-1', 'voter-hash', { type: 'rename-room', name: 'Hijacked' })).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(await core.mutate('room-1', 'fac-hash', { type: 'set-deck', deck: { type: 'fibonacci' } })).toMatchObject({
      ok: true,
      room: { version: 2 },
    });
    expect(publications).toEqual([]);
    expect(scheduledExpiries).toEqual([]);

    // Active Story + open Voting Round hides other Participants' choices until reveal.
    now = START_MS + DAY_MS;
    const added = await core.mutate('room-1', 'fac-hash', {
      type: 'add-story',
      title: 'Estimate API refactor',
      makeActive: true,
    });
    if (!added.ok || added.room.closed || !added.room.round) throw new Error('Expected active Voting Round.');
    const roundId = added.room.round.id;
    const samId = added.room.participants.find((entry) => entry.displayName === 'Sam')?.id;
    if (!samId) throw new Error('Expected Sam in participants.');
    expect(scheduledExpiries).toEqual([{ id: 'room-1', expiresAt: START_MS + 91 * DAY_MS }]);

    publications.length = 0;
    const voted = await core.mutate('room-1', 'voter-hash', { type: 'vote', roundId, choice: '5' });
    expect(voted.ok).toBe(true);
    expect(publications).toHaveLength(1);

    const votePub = publications[0].publication;
    expect(projectPokerPublication(votePub, 'fac-hash')).toMatchObject({
      type: 'room:snapshot',
      room: {
        closed: false,
        viewer: { displayName: 'Alex' },
        round: { id: roundId, phase: 'open', ownChoice: null, submittedParticipantIds: [samId] },
      },
    });
    expect(projectPokerPublication(votePub, 'voter-hash')).toMatchObject({
      type: 'room:snapshot',
      room: {
        closed: false,
        viewer: { displayName: 'Sam' },
        round: { id: roundId, phase: 'open', ownChoice: '5', submittedParticipantIds: [samId] },
      },
    });
    expect(projectPokerPublication(votePub, 'stranger-hash')).toMatchObject({
      type: 'room:snapshot',
      room: { closed: false, viewer: null, participants: [], stories: [], round: null },
    });

    // Duplicate vote is a no-op and suppresses publication.
    publications.length = 0;
    expect(await core.mutate('room-1', 'voter-hash', { type: 'vote', roundId, choice: '5' })).toMatchObject({ ok: true });
    expect(publications).toEqual([]);

    // Reveal & confirm estimate expose ballots and Accepted Estimate.
    expect(await core.mutate('room-1', 'fac-hash', { type: 'reveal', roundId })).toMatchObject({
      ok: true,
      room: {
        round: {
          id: roundId,
          phase: 'revealed',
          ballots: [{ participantId: samId, displayName: 'Sam', choice: '5' }],
        },
      },
    });
    expect(await core.mutate('room-1', 'fac-hash', { type: 'confirm-estimate', roundId, choice: '5' })).toMatchObject({
      ok: true,
      room: {
        stories: [{ title: 'Estimate API refactor', status: 'estimated', acceptedEstimate: '5' }],
        round: { id: roundId, phase: 'accepted' },
      },
    });

    // Closing emits a terminal snapshot with viewer-specific canDelete and no Display Names.
    publications.length = 0;
    scheduledExpiries.length = 0;
    now = START_MS + 2 * DAY_MS;
    const closed = await core.mutate('room-1', 'fac-hash', { type: 'close-room' });
    expect(closed).toMatchObject({
      ok: true,
      room: {
        closed: true,
        canDelete: true,
        stories: [{ title: 'Estimate API refactor', status: 'estimated', acceptedEstimate: '5' }],
      },
    });
    expect(scheduledExpiries).toEqual([{ id: 'room-1', expiresAt: START_MS + 92 * DAY_MS }]);
    expect(publications).toHaveLength(1);
    expect(publications[0].publication).toMatchObject({ type: 'snapshot', terminal: true });
    expect(projectPokerPublication(publications[0].publication, 'fac-hash')).toMatchObject({
      type: 'room:snapshot',
      room: { closed: true, canDelete: true },
    });
    expect(projectPokerPublication(publications[0].publication, 'voter-hash')).toMatchObject({
      type: 'room:snapshot',
      room: { closed: true, canDelete: false },
    });
    expect(JSON.stringify(projectPokerPublication(publications[0].publication, 'fac-hash'))).not.toMatch(/Alex|Sam/);

    // Repeating close-room when already closed is an idempotent no-op for Facilitators and forbidden for others.
    publications.length = 0;
    scheduledExpiries.length = 0;
    now = START_MS + 10 * DAY_MS;
    expect(await core.mutate('room-1', 'fac-hash', { type: 'close-room' })).toMatchObject({ ok: true, room: { closed: true } });
    expect(await core.mutate('room-1', 'voter-hash', { type: 'close-room' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await core.mutate('room-1', 'fac-hash', { type: 'add-story', title: 'Blocked' })).toMatchObject({
      ok: false,
      code: 'ROOM_CLOSED',
    });
    expect(publications).toEqual([]);
    expect(scheduledExpiries).toEqual([]);
  });

  test('enforces TTL rules across join, substantive mutations, close, and ADR-0004 reopen', async () => {
    await core.create('room-1', 'fac-hash', 'Alex');
    scheduledExpiries.length = 0;

    // Day 1: substantive mutation extends deadline to Day 91.
    now = START_MS + DAY_MS;
    await core.mutate('room-1', 'fac-hash', { type: 'add-story', title: 'Story 1' });
    expect(scheduledExpiries).toEqual([{ id: 'room-1', expiresAt: START_MS + 91 * DAY_MS }]);

    // Day 5: join does NOT extend deadline or reschedule expiry.
    scheduledExpiries.length = 0;
    now = START_MS + 5 * DAY_MS;
    await core.mutate('room-1', 'voter-hash', { type: 'join', displayName: 'Sam' });
    expect(scheduledExpiries).toEqual([]);

    // Just before Day 91: still alive; would have expired at Day 91 without close/reopen.
    now = START_MS + 91 * DAY_MS - 1;
    expect(await core.read('room-1', 'fac-hash')).not.toBeNull();

    // Close on Day 10 -> fixed deadline Day 100.
    now = START_MS + 10 * DAY_MS;
    await core.mutate('room-1', 'fac-hash', { type: 'close-room' });
    expect(scheduledExpiries).toEqual([{ id: 'room-1', expiresAt: START_MS + 100 * DAY_MS }]);

    // Reopen on Day 40 (ADR-0004): resets deadline to Day 130, locks prior Stories, emits non-terminal snapshot.
    publications.length = 0;
    scheduledExpiries.length = 0;
    now = START_MS + 40 * DAY_MS;
    expect(await core.mutate('room-1', 'voter-hash', { type: 'reopen-room' })).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    const reopened = await core.mutate('room-1', 'fac-hash', { type: 'reopen-room' });
    expect(reopened).toMatchObject({
      ok: true,
      room: { closed: false, viewer: null, participants: [], activeStoryId: null, round: null },
    });
    expect(scheduledExpiries).toEqual([{ id: 'room-1', expiresAt: START_MS + 130 * DAY_MS }]);
    expect(publications).toHaveLength(1);
    expect(publications[0].publication).toMatchObject({ type: 'snapshot', terminal: false });

    // Reopening again while already open is a no-op (no publication, no reschedule).
    publications.length = 0;
    scheduledExpiries.length = 0;
    expect(await core.mutate('room-1', 'fac-hash', { type: 'reopen-room' })).toEqual(reopened);
    expect(publications).toEqual([]);
    expect(scheduledExpiries).toEqual([]);

    // Returning Facilitator regains Facilitator role on join, and prior Story is Locked.
    const rejoined = await core.mutate('room-1', 'fac-hash', { type: 'join', displayName: 'Alex again' });
    expect(rejoined).toMatchObject({
      ok: true,
      room: {
        viewer: { displayName: 'Alex again', isFacilitator: true },
        stories: [{ title: 'Story 1', locked: true }],
      },
    });
    if (!rejoined.ok || rejoined.room.closed) throw new Error('Expected reopened Room.');
    expect(await core.mutate('room-1', 'fac-hash', {
      type: 'edit-story',
      storyId: rejoined.room.stories[0].id,
      title: 'Blocked edit',
    })).toMatchObject({ ok: false, code: 'STORY_LOCKED' });

    // Room survives until Day 130 - 1 and expires at Day 130.
    now = START_MS + 130 * DAY_MS - 1;
    expect(await core.read('room-1', 'fac-hash')).not.toBeNull();
    now = START_MS + 130 * DAY_MS;
    expect(await core.read('room-1', 'fac-hash')).toBeNull();
  });

  test('deletes a Room only for authorized Facilitators, emits terminal room:missing, and calls clearExpiry', async () => {
    await core.create('room-1', 'fac-hash', 'Alex');
    await core.mutate('room-1', 'voter-hash', { type: 'join', displayName: 'Sam' });
    publications.length = 0;
    clearedExpiries.length = 0;

    // Non-Facilitator cannot delete; suppresses publication and clearExpiry.
    expect(await core.delete('room-1', 'voter-hash')).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(publications).toEqual([]);
    expect(clearedExpiries).toEqual([]);

    // Authorized Facilitator deletes; emits terminal room:missing and clears expiry.
    expect(await core.delete('room-1', 'fac-hash')).toEqual({ ok: true });
    expect(publications).toEqual([{ id: 'room-1', publication: missingPokerRoom }]);
    expect(projectPokerPublication(missingPokerRoom, 'voter-hash')).toEqual({ type: 'room:missing' });
    expect(clearedExpiries).toEqual(['room-1']);
    expect(await core.read('room-1', 'fac-hash')).toBeNull();

    // Deleting an already-deleted Room returns ROOM_NOT_FOUND without re-publishing or clearing expiry.
    publications.length = 0;
    clearedExpiries.length = 0;
    expect(await core.delete('room-1', 'fac-hash')).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
    expect(publications).toEqual([]);
    expect(clearedExpiries).toEqual([]);
  });

  test('handles all Co-Facilitator Link operations with exact publication emission, suppression, and secrecy rules', async () => {
    await core.create('room-1', 'fac-hash', 'Alex');
    await core.mutate('room-1', 'voter-hash', { type: 'join', displayName: 'Sam' });
    publications.length = 0;

    // Initial get returns null for Facilitator, FORBIDDEN for Participant.
    expect(await core.getFacilitatorCapability('room-1', 'voter-hash')).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(await core.getFacilitatorCapability('room-1', 'fac-hash')).toEqual({ ok: true, value: null });
    expect(publications).toEqual([]);

    // CAS mismatch or non-Facilitator replacement suppresses publication.
    expect(await core.replaceFacilitatorCapability('room-1', 'voter-hash', 0, {
      hash: 'bad', encrypted: 'bad', revision: 1,
    })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await core.replaceFacilitatorCapability('room-1', 'fac-hash', 1, {
      hash: 'bad', encrypted: 'bad', revision: 2,
    })).toMatchObject({ ok: false, code: 'LINK_REPLACED' });
    expect(publications).toEqual([]);

    // Valid replacement persists capability and publishes non-terminal snapshot without leaking secret fields.
    expect(await core.replaceFacilitatorCapability('room-1', 'fac-hash', 0, {
      hash: 'cap-hash-1', encrypted: 'cap-secret-1', revision: 1,
    })).toEqual({ ok: true, value: null });
    expect(publications).toHaveLength(1);
    const rotPub = publications[0].publication;
    expect(rotPub).toMatchObject({ type: 'snapshot', terminal: false });
    const facFrame = projectPokerPublication(rotPub, 'fac-hash');
    const voterFrame = projectPokerPublication(rotPub, 'voter-hash');
    expect(facFrame).toMatchObject({ type: 'room:snapshot', room: { facilitatorLinkRevision: 1 } });
    expect(voterFrame).not.toHaveProperty('room.facilitatorLinkRevision');
    expect(JSON.stringify(facFrame)).not.toMatch(/cap-hash-1|cap-secret-1|facilitatorCapability/);

    // Silent encryption re-write persists updated ciphertext on matching revision without bumping version or publishing.
    publications.length = 0;
    const versionBeforeReencrypt = (await core.read('room-1', 'fac-hash'))?.version;
    await core.updateFacilitatorCapabilityEncryption('room-1', 'fac-hash', 99, 'stale-ciphertext');
    expect(await core.getFacilitatorCapability('room-1', 'fac-hash')).toEqual({
      ok: true,
      value: { hash: 'cap-hash-1', encrypted: 'cap-secret-1', revision: 1 },
    });
    await core.updateFacilitatorCapabilityEncryption('room-1', 'fac-hash', 1, 'rotated-ciphertext');
    expect(await core.getFacilitatorCapability('room-1', 'fac-hash')).toEqual({
      ok: true,
      value: { hash: 'cap-hash-1', encrypted: 'rotated-ciphertext', revision: 1 },
    });
    expect((await core.read('room-1', 'fac-hash'))?.version).toBe(versionBeforeReencrypt);
    expect(publications).toEqual([]);

    // Effective Facilitator claim (joined Participant) publishes snapshot; repeated or invalid claims suppress publication.
    const claimed = await core.claimFacilitator('room-1', 'voter-hash', 'cap-hash-1');
    expect(claimed).toMatchObject({
      ok: true,
      value: { viewer: { displayName: 'Sam', isFacilitator: true }, facilitatorLinkRevision: 1 },
    });
    expect(publications).toHaveLength(1);

    publications.length = 0;
    expect(await core.claimFacilitator('room-1', 'voter-hash', 'cap-hash-1')).toEqual(claimed);
    expect(await core.claimFacilitator('room-1', 'voter-hash', 'wrong-hash')).toMatchObject({
      ok: false,
      code: 'INVALID_LINK',
    });
    expect(publications).toEqual([]);

    // Effective pending Facilitator claim (unjoined visitor) publishes snapshot; repeated pending claim suppresses publication.
    const pendingClaim = await core.claimFacilitator('room-1', 'unjoined-fac', 'cap-hash-1');
    expect(pendingClaim).toMatchObject({ ok: true, value: { viewer: null } });
    expect(publications).toHaveLength(1);

    publications.length = 0;
    expect(await core.claimFacilitator('room-1', 'unjoined-fac', 'cap-hash-1')).toEqual(pendingClaim);
    expect(publications).toEqual([]);
  });

  test('handles alarm expiry, lazy expiry across operations, purgeExpired, and schema-state reset after storage wipe', async () => {
    // Wire a simulated Durable Object storage wipe in clearExpiry that drops all SQLite tables.
    const wipeCore = createPokerRoomCore(wrapDatabaseSync(db), {
      now: () => now,
      publisher: {
        publish(id, publication) {
          publications.push({ id, publication });
        },
      },
      scheduleExpiry(id, expiresAt) {
        scheduledExpiries.push({ id, expiresAt });
      },
      clearExpiry(id) {
        clearedExpiries.push(id);
        db.exec('DROP TABLE IF EXISTS poker_rooms');
      },
    });

    await wipeCore.create('room-1', 'fac-hash', 'Alex');
    scheduledExpiries.length = 0;

    // Early alarm on still-live Room reschedules expiry and keeps Room active.
    now = START_MS + 10 * DAY_MS;
    expect(await wipeCore.handleExpiry('room-1')).toBe('active');
    expect(scheduledExpiries).toEqual([{ id: 'room-1', expiresAt: START_MS + 90 * DAY_MS }]);
    expect(publications).toEqual([]);
    expect(clearedExpiries).toEqual([]);

    // Alarm at expiry purges, emits terminal room:missing, wipes tables, and safely resets schema state.
    now = START_MS + 90 * DAY_MS;
    expect(await wipeCore.handleExpiry('room-1')).toBe('expired');
    expect(publications).toEqual([{ id: 'room-1', publication: missingPokerRoom }]);
    expect(clearedExpiries).toEqual(['room-1']);
    expect(wipeCore.isAvailable('room-1')).toBe(false);
    expect(wipeCore.snapshot('room-1')).toBeNull();
    expect(await wipeCore.read('room-1', 'fac-hash')).toBeNull();

    // Subsequent create after table wipe re-initializes schema cleanly (no "no such table: poker_rooms").
    publications.length = 0;
    clearedExpiries.length = 0;
    await wipeCore.create('room-2', 'fac-hash', 'Alex');
    expect(wipeCore.isAvailable('room-2')).toBe(true);

    // Lazy expiry on read triggers terminal room:missing + clearExpiry once; second read does not repeat.
    now += 90 * DAY_MS;
    expect(await wipeCore.read('room-2', 'fac-hash')).toBeNull();
    expect(publications).toEqual([{ id: 'room-2', publication: missingPokerRoom }]);
    expect(clearedExpiries).toEqual(['room-2']);

    publications.length = 0;
    clearedExpiries.length = 0;
    expect(await wipeCore.read('room-2', 'fac-hash')).toBeNull();
    expect(publications).toEqual([]);
    expect(clearedExpiries).toEqual([]);

    // Lazy expiry on mutate, delete, get/replace/update capability, and claimFacilitator all emit missing + clearExpiry without leaking internal flags.
    const lazyChecks: Array<{
      label: string;
      run: (id: string) => Promise<unknown>;
      expected: unknown;
    }> = [
      {
        label: 'mutate',
        run: (id) => wipeCore.mutate(id, 'fac-hash', { type: 'add-story', title: 'Late' }),
        expected: { ok: false, code: 'ROOM_NOT_FOUND', message: 'This Room is no longer available.' },
      },
      {
        label: 'delete',
        run: (id) => wipeCore.delete(id, 'fac-hash'),
        expected: { ok: false, code: 'ROOM_NOT_FOUND', message: 'This Room is no longer available.' },
      },
      {
        label: 'getFacilitatorCapability',
        run: (id) => wipeCore.getFacilitatorCapability(id, 'fac-hash'),
        expected: { ok: false, code: 'ROOM_NOT_FOUND', message: 'This Room is no longer available.' },
      },
      {
        label: 'replaceFacilitatorCapability',
        run: (id) => wipeCore.replaceFacilitatorCapability(id, 'fac-hash', 0, {
          hash: 'h', encrypted: 'e', revision: 1,
        }),
        expected: { ok: false, code: 'ROOM_NOT_FOUND', message: 'This Room is no longer available.' },
      },
      {
        label: 'updateFacilitatorCapabilityEncryption',
        run: (id) => wipeCore.updateFacilitatorCapabilityEncryption(id, 'fac-hash', 1, 're'),
        expected: undefined,
      },
      {
        label: 'claimFacilitator',
        run: (id) => wipeCore.claimFacilitator(id, 'voter-hash', 'h'),
        expected: {
          ok: false,
          code: 'INVALID_LINK',
          message: 'This Co-Facilitator Link is invalid or has expired.',
        },
      },
    ];

    for (const check of lazyChecks) {
      const id = `lazy-${check.label}`;
      await wipeCore.create(id, 'fac-hash', 'Alex');
      publications.length = 0;
      clearedExpiries.length = 0;
      now += 90 * DAY_MS;

      const outcome = await check.run(id);
      expect(outcome).toEqual(check.expected);
      expect(publications).toEqual([{ id, publication: missingPokerRoom }]);
      expect(clearedExpiries).toEqual([id]);
    }

    // Multi-Room purgeExpired removes only expired Rooms, and direct PokerRoomStorage.resetSchemaState() survives external wipes.
    const multiDb = new DatabaseSync(':memory:');
    try {
      const storage = new PokerRoomStorage(wrapDatabaseSync(multiDb));
      storage.create('old-room', 'fac-hash', 'Alex', 'Old', START_MS);
      storage.create('fresh-room', 'fac-hash', 'Alex', 'Fresh', START_MS + 10 * DAY_MS);
      storage.purgeExpired(START_MS + 90 * DAY_MS);
      expect(storage.isAvailable('old-room', START_MS + 90 * DAY_MS)).toBe(false);
      expect(storage.isAvailable('fresh-room', START_MS + 90 * DAY_MS)).toBe(true);

      multiDb.exec('DROP TABLE poker_rooms');
      storage.resetSchemaState();
      expect(storage.hasSchema()).toBe(false);
      expect(storage.read('fresh-room', 'fac-hash', START_MS + 90 * DAY_MS)).toBeNull();
      expect(storage.create('reborn-room', 'fac-hash', 'Alex', 'Reborn', START_MS + 90 * DAY_MS).id).toBe('reborn-room');
    } finally {
      multiDb.close();
    }
  });

  test('enforces injectable write rate-limiter at exact check points for mutate, replaceFacilitatorCapability, and claimFacilitator', async () => {
    const calls: Array<{ id: string; hash: string; now: number | undefined }> = [];
    const limiter = createBoardWriteRateLimiter({ limit: 2, windowMs: 60_000 });
    const trackedLimiter: PokerWriteRateLimiter = {
      check(id, hash, checkNow) {
        calls.push({ id, hash, now: checkNow });
        return limiter.check(id, hash, checkNow);
      },
    };

    const limitedCore = createPokerRoomCore(wrapDatabaseSync(db), {
      now: () => now,
      writeLimiter: trackedLimiter,
      publisher: {
        publish(id, publication) {
          publications.push({ id, publication });
        },
      },
    });

    await limitedCore.create('room-1', 'fac-hash', 'Alex');
    await limitedCore.mutate('room-1', 'voter-hash', { type: 'join', displayName: 'Sam' });
    calls.length = 0;

    // 1. replaceFacilitatorCapability checks role and CAS BEFORE writeLimiter (rejected role/CAS do not consume quota).
    expect(await limitedCore.replaceFacilitatorCapability('room-1', 'voter-hash', 0, {
      hash: 'h1', encrypted: 'e1', revision: 1,
    })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await limitedCore.replaceFacilitatorCapability('room-1', 'fac-hash', 99, {
      hash: 'h1', encrypted: 'e1', revision: 1,
    })).toMatchObject({ ok: false, code: 'LINK_REPLACED' });
    expect(calls).toEqual([]);

    // Valid CAS replacement consumes 1 write token using injected clock.
    expect(await limitedCore.replaceFacilitatorCapability('room-1', 'fac-hash', 0, {
      hash: 'h1', encrypted: 'e1', revision: 1,
    })).toEqual({ ok: true, value: null });
    expect(calls).toEqual([{ id: 'room-1', hash: 'fac-hash', now: START_MS }]);

    // 2. mutate consumes the 2nd token, then the 3rd write (mutate or replace) is RATE_LIMITED.
    expect(await limitedCore.mutate('room-1', 'fac-hash', { type: 'add-story', title: 'S1' })).toMatchObject({ ok: true });
    publications.length = 0;
    expect(await limitedCore.mutate('room-1', 'fac-hash', { type: 'add-story', title: 'S2' })).toMatchObject({
      ok: false,
      code: 'RATE_LIMITED',
    });
    expect(await limitedCore.replaceFacilitatorCapability('room-1', 'fac-hash', 1, {
      hash: 'h2', encrypted: 'e2', revision: 2,
    })).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    // Even while rate-limited, stale CAS on replaceFacilitatorCapability still returns LINK_REPLACED (checked before limiter).
    expect(await limitedCore.replaceFacilitatorCapability('room-1', 'fac-hash', 0, {
      hash: 'h2', encrypted: 'e2', revision: 1,
    })).toMatchObject({ ok: false, code: 'LINK_REPLACED' });
    expect(publications).toEqual([]);

    // Read, getFacilitatorCapability, and updateFacilitatorCapabilityEncryption are not throttled by writeLimiter.
    expect(await limitedCore.read('room-1', 'fac-hash')).not.toBeNull();
    expect(await limitedCore.getFacilitatorCapability('room-1', 'fac-hash')).toMatchObject({ ok: true });
    await limitedCore.updateFacilitatorCapabilityEncryption('room-1', 'fac-hash', 1, 'e1-rotated');

    // 3. claimFacilitator checks writeLimiter BEFORE transaction (even invalid tokens consume quota and get RATE_LIMITED).
    expect(await limitedCore.claimFacilitator('room-1', 'attacker', 'wrong-1')).toMatchObject({
      ok: false,
      code: 'INVALID_LINK',
    });
    expect(await limitedCore.claimFacilitator('room-1', 'attacker', 'wrong-2')).toMatchObject({
      ok: false,
      code: 'INVALID_LINK',
    });
    expect(await limitedCore.claimFacilitator('room-1', 'attacker', 'h1')).toMatchObject({
      ok: false,
      code: 'RATE_LIMITED',
    });

    // Advancing injected clock past the 60s window re-allows writes without Date.now spies.
    now = START_MS + 60_001;
    expect(await limitedCore.mutate('room-1', 'fac-hash', { type: 'add-story', title: 'After window' })).toMatchObject({
      ok: true,
    });
  });

  test('bindPokerRoomAccess exposes the declared PokerRoomRuntime seam for all eight operations plus live-transport handoff', async () => {
    const connectCalls: Array<{ id: string; hash: string; url: string }> = [];
    const heartbeatCalls: Array<{ id: string; hash: string; connectionId: string }> = [];

    const runtimeWithHeartbeat: PokerRoomRuntime = {
      create: (id, hash, displayName, name) => core.create(id, hash, displayName, name),
      read: (id, hash) => core.read(id, hash),
      mutate: (id, hash, command) => core.mutate(id, hash, command),
      delete: (id, hash) => core.delete(id, hash),
      getFacilitatorCapability: (id, hash) => core.getFacilitatorCapability(id, hash),
      replaceFacilitatorCapability: (id, hash, expectedRevision, capability) =>
        core.replaceFacilitatorCapability(id, hash, expectedRevision, capability),
      updateFacilitatorCapabilityEncryption: (id, hash, expectedRevision, encrypted) =>
        core.updateFacilitatorCapabilityEncryption(id, hash, expectedRevision, encrypted),
      claimFacilitator: (id, hash, candidate) => core.claimFacilitator(id, hash, candidate),
      connect(id, hash, request) {
        connectCalls.push({ id, hash, url: request.url });
        return new Response(null, { status: 204 });
      },
      heartbeat(id, hash, connectionId) {
        heartbeatCalls.push({ id, hash, connectionId });
        return true;
      },
    };

    const access = bindPokerRoomAccess(runtimeWithHeartbeat, 'bound-room');
    expect(await access.create('fac-hash', 'Alex', 'Bound Room')).toMatchObject({ id: 'bound-room', name: 'Bound Room' });
    expect(await access.read('fac-hash')).toMatchObject({ id: 'bound-room' });
    expect(await access.mutate('voter-hash', { type: 'join', displayName: 'Sam' })).toMatchObject({ ok: true });
    expect(await access.getFacilitatorCapability('fac-hash')).toEqual({ ok: true, value: null });
    expect(await access.replaceFacilitatorCapability('fac-hash', 0, {
      hash: 'h1', encrypted: 'e1', revision: 1,
    })).toEqual({ ok: true, value: null });
    await access.updateFacilitatorCapabilityEncryption('fac-hash', 1, 'e1-v2');
    expect(await access.claimFacilitator('voter-hash', 'h1')).toMatchObject({
      ok: true,
      value: { viewer: { displayName: 'Sam', isFacilitator: true } },
    });

    const response = await access.connect('fac-hash', new Request('https://retrocks.test/api/poker/bound-room/live'));
    expect(response.status).toBe(204);
    expect(connectCalls).toEqual([{
      id: 'bound-room',
      hash: 'fac-hash',
      url: 'https://retrocks.test/api/poker/bound-room/live',
    }]);
    expect(await access.heartbeat?.('fac-hash', 'conn-1')).toBe(true);
    expect(heartbeatCalls).toEqual([{ id: 'bound-room', hash: 'fac-hash', connectionId: 'conn-1' }]);
    expect(await access.delete('fac-hash')).toEqual({ ok: true });

    const { heartbeat: _omit, ...runtimeWithoutHeartbeat } = runtimeWithHeartbeat;
    const wsAccess = bindPokerRoomAccess(runtimeWithoutHeartbeat, 'ws-room');
    expect(wsAccess.heartbeat).toBeUndefined();
  });

  test('defaults to production clock and write limiter when options are omitted', async () => {
    const defaultCore = createPokerRoomCore(wrapDatabaseSync(db));
    const created = await defaultCore.create('default-room', 'fac-hash', 'Alex');
    expect(created).toMatchObject({ id: 'default-room', closed: false, name: 'Poker Room' });
    expect(await defaultCore.delete('default-room', 'fac-hash')).toEqual({ ok: true });
    expect(await defaultCore.read('default-room', 'fac-hash')).toBeNull();
  });
});
