import { commitEventResponse, createRequestEvent } from '@solidjs/web';
import { provideRequestEvent } from '@solidjs/web/storage';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { parsePokerLiveMessage } from '../../lib/poker-schemas';
import { readSseStream } from '../live/sse-test-helper';
import type { NodePokerRooms } from './node';

const TEST_SECRET = 'poker-sharing-test-secret-at-least-32-characters';
let rooms: NodePokerRooms;

beforeEach(async () => {
  vi.stubEnv('SESSION_SECRET', TEST_SECRET);
  vi.resetModules();
  const { openNodePokerRooms } = await import('./node');
  const { setNodePokerRoomsForTests } = await import('./runtime');
  rooms = await openNodePokerRooms(':memory:');
  setNodePokerRoomsForTests(rooms);
});

afterEach(async () => {
  const { setNodePokerRoomsForTests } = await import('./runtime');
  setNodePokerRoomsForTests(null);
  rooms.close();
  vi.unstubAllEnvs();
});

async function runRequest<T>(handler: () => Promise<T>, cookie?: string) {
  const request = new Request('https://retrocks.test/_server', {
    method: 'POST',
    headers: cookie ? { cookie } : undefined,
  });
  const event = createRequestEvent(request);
  return provideRequestEvent(event, async () => {
    const result = await handler();
    const response = commitEventResponse(new Response(), event);
    return { result, response, cookie: response.headers.getSetCookie()[0]?.split(';')[0] };
  });
}

async function createRoom() {
  const { createPokerRoomForRequest } = await import('./service');
  const { result, cookie } = await runRequest(() => createPokerRoomForRequest('Alex'));
  if (!result.ok || !cookie) throw new Error('Could not create a Room for the test.');
  return { id: result.room.id, creatorCookie: cookie };
}

test('only a Facilitator can retrieve a Room’s Co-Facilitator Link', async () => {
  const { getPokerFacilitatorLinkForRequest } = await import('./sharing');
  const { mutatePokerRoomForRequest, readPokerRoomForRequest } = await import('./service');
  const { id, creatorCookie } = await createRoom();
  const visitor = await runRequest(() => readPokerRoomForRequest(id));
  const { result: joined } = await runRequest(
    () => mutatePokerRoomForRequest(id, { type: 'join', displayName: 'Sam' }),
    visitor.cookie,
  );
  expect(joined).toMatchObject({ ok: true, room: { viewer: { isFacilitator: false } } });
  await expect(runRequest(() => getPokerFacilitatorLinkForRequest(id), visitor.cookie))
    .resolves.toMatchObject({ result: { ok: false, code: 'FORBIDDEN' } });

  const { result, response } = await runRequest(() => getPokerFacilitatorLinkForRequest(id), creatorCookie);
  expect(result).toMatchObject({ ok: true, value: { href: expect.stringMatching(new RegExp(`^/p/${id}#f=[A-Za-z0-9_-]{43}$`)) } });
  expect(response.headers.get('cache-control')).toBe('no-store');
  await expect(runRequest(() => getPokerFacilitatorLinkForRequest(id), creatorCookie))
    .resolves.toMatchObject({ result });
});

async function shareRoom() {
  const { getPokerFacilitatorLinkForRequest } = await import('./sharing');
  const { id, creatorCookie } = await createRoom();
  const { result } = await runRequest(() => getPokerFacilitatorLinkForRequest(id), creatorCookie);
  if (!result.ok) throw new Error('Could not get a Co-Facilitator Link for the test.');
  return { id, creatorCookie, link: result.value };
}

function tokenFromLink(href: string) {
  return new URLSearchParams(new URL(href, 'https://retrocks.test').hash.slice(1)).get('f')!;
}

test('grants a joined browser Facilitator access and broadcasts the public role without the link', async () => {
  const { claimPokerFacilitatorLinkForRequest, getPokerFacilitatorLinkForRequest } = await import('./sharing');
  const { handlePokerLiveRequest, mutatePokerRoomForRequest, readPokerRoomForRequest } = await import('./service');
  const { id, creatorCookie, link } = await shareRoom();
  const { cookie } = await runRequest(() => mutatePokerRoomForRequest(id, { type: 'join', displayName: 'Sam' }));
  const stream = readSseStream(
    await handlePokerLiveRequest(id, new Request(`https://retrocks.test/api/poker/${id}/live`, {
      headers: { cookie: creatorCookie },
    })),
    parsePokerLiveMessage,
  );
  try {
    await stream.next();
    await stream.next();
    const { result } = await runRequest(() => claimPokerFacilitatorLinkForRequest(id, tokenFromLink(link.href)), cookie);
    expect(result).toMatchObject({ ok: true, value: { viewer: { displayName: 'Sam', isFacilitator: true } } });
    expect(JSON.stringify(result)).not.toContain(tokenFromLink(link.href));

    const live = await stream.nextRaw();
    expect(live).toContain('"displayName":"Sam","isFacilitator":true');
    expect(live).not.toContain(tokenFromLink(link.href));
    await expect(runRequest(() => readPokerRoomForRequest(id), cookie))
      .resolves.toMatchObject({ result: { viewer: { displayName: 'Sam', isFacilitator: true } } });
    await expect(runRequest(() => getPokerFacilitatorLinkForRequest(id), cookie))
      .resolves.toMatchObject({ result: { ok: true, value: link } });
  } finally {
    await stream.close();
  }
});

test('replacing a link blocks stale claims and competing replacements while preserving earlier claims', async () => {
  const { claimPokerFacilitatorLinkForRequest, getPokerFacilitatorLinkForRequest, replacePokerFacilitatorLinkForRequest } =
    await import('./sharing');
  const { mutatePokerRoomForRequest, readPokerRoomForRequest } = await import('./service');
  const { id, creatorCookie, link } = await shareRoom();
  const oldToken = tokenFromLink(link.href);
  const { result: claimed, cookie: facilitatorCookie } = await runRequest(
    () => claimPokerFacilitatorLinkForRequest(id, oldToken),
  );
  expect(claimed).toMatchObject({ ok: true, value: { viewer: null } });
  const { result: newParticipant, cookie: visitorCookie } = await runRequest(
    () => mutatePokerRoomForRequest(id, { type: 'join', displayName: 'Visitor' }),
  );
  expect(newParticipant).toMatchObject({ ok: true, room: { viewer: { isFacilitator: false } } });
  await expect(runRequest(() => replacePokerFacilitatorLinkForRequest(id, link.revision), visitorCookie))
    .resolves.toMatchObject({ result: { ok: false, code: 'FORBIDDEN' } });

  const replacements = await Promise.all([
    runRequest(() => replacePokerFacilitatorLinkForRequest(id, link.revision), creatorCookie),
    runRequest(() => replacePokerFacilitatorLinkForRequest(id, link.revision), creatorCookie),
  ]);
  const replacement = replacements.map(({ result }) => result).find((result) => result.ok);
  expect(replacements.map(({ result }) => result)).toContainEqual(expect.objectContaining({
    ok: false, code: 'LINK_REPLACED',
  }));
  if (!replacement?.ok) throw new Error('No replacement was accepted.');
  expect(replacement.value.href).not.toBe(link.href);

  await expect(runRequest(() => claimPokerFacilitatorLinkForRequest(id, oldToken), visitorCookie))
    .resolves.toMatchObject({ result: { ok: false, code: 'INVALID_LINK' } });
  await expect(runRequest(() => readPokerRoomForRequest(id), visitorCookie))
    .resolves.toMatchObject({ result: { viewer: { isFacilitator: false } } });
  await expect(runRequest(
    () => mutatePokerRoomForRequest(id, { type: 'join', displayName: 'Co-Facilitator' }),
    facilitatorCookie,
  )).resolves.toMatchObject({ result: { ok: true, room: { viewer: { isFacilitator: true } } } });
  await expect(runRequest(() => getPokerFacilitatorLinkForRequest(id), facilitatorCookie))
    .resolves.toMatchObject({ result: { ok: true, value: replacement.value } });
  await expect(runRequest(
    () => claimPokerFacilitatorLinkForRequest(id, tokenFromLink(replacement.value.href)), visitorCookie,
  )).resolves.toMatchObject({ result: { ok: true, value: { viewer: { isFacilitator: true } } } });
});

test('re-encrypts a Room Co-Facilitator Link on SESSION_SECRET rotation so it survives retiring the old secret', async () => {
  const { handlePokerLiveRequest } = await import('./service');
  const { id, creatorCookie, link: before } = await shareRoom();

  const stream = readSseStream(
    await handlePokerLiveRequest(id, new Request(`https://retrocks.test/api/poker/${id}/live`, {
      headers: { cookie: creatorCookie },
    })),
    parsePokerLiveMessage,
  );
  try {
    await stream.next();
    await stream.next();

    const rotatedSecret = 'rotated-poker-sharing-secret-at-least-32-characters';
    vi.stubEnv('SESSION_SECRET', `${rotatedSecret},${TEST_SECRET}`);
    vi.resetModules();
    const { setNodePokerRoomsForTests: setRoomsDuringRotation } = await import('./runtime');
    setRoomsDuringRotation(rooms);
    const { getPokerFacilitatorLinkForRequest: getLinkDuringRotation } = await import('./sharing');

    const { result: duringRotation, response } = await runRequest(
      () => getLinkDuringRotation(id),
      creatorCookie,
    );
    expect(duringRotation).toEqual({ ok: true, value: before });
    expect(response.headers.get('cache-control')).toBe('no-store');

    // Retire the old secret; the link must still decrypt from Room storage.
    vi.stubEnv('SESSION_SECRET', rotatedSecret);
    vi.resetModules();
    const { setNodePokerRoomsForTests: setRoomsAfterRetire } = await import('./runtime');
    setRoomsAfterRetire(rooms);
    const {
      claimPokerFacilitatorLinkForRequest: claimAfterRetire,
      getPokerFacilitatorLinkForRequest: getLinkAfterRetire,
    } = await import('./sharing');
    const { mutatePokerRoomForRequest: mutateAfterRetire } = await import('./service');

    const { result: claimed, cookie: newSessionCookie, response: claimResponse } = await runRequest(
      () => claimAfterRetire(id, tokenFromLink(before.href)),
    );
    expect(claimed).toMatchObject({ ok: true, value: { viewer: null } });
    expect(claimResponse.headers.get('cache-control')).toBe('no-store');
    await runRequest(
      () => mutateAfterRetire(id, { type: 'join', displayName: 'Rotated Facilitator' }),
      newSessionCookie,
    );

    const { result: afterRetire, response: retireResponse } = await runRequest(
      () => getLinkAfterRetire(id),
      newSessionCookie,
    );
    expect(afterRetire).toEqual({ ok: true, value: before });
    expect(retireResponse.headers.get('cache-control')).toBe('no-store');

    // Confirm invalid/malformed tokens are rejected with Cache-Control: no-store.
    const { result: malformed, response: malformedResponse } = await runRequest(
      () => claimAfterRetire(id, 'not-a-valid-token'),
    );
    expect(malformed).toMatchObject({ ok: false, code: 'INVALID_LINK' });
    expect(malformedResponse.headers.get('cache-control')).toBe('no-store');

    // Verify no snapshot was published by rotation re-encryption: the first frame is the
    // pending claim (version 3) and the second is the join (version 4).
    const claimFrame = await stream.nextRaw();
    expect(claimFrame).toContain('"version":3');
    const joinFrame = await stream.nextRaw();
    expect(joinFrame).toContain('"displayName":"Rotated Facilitator","isFacilitator":true');
  } finally {
    await stream.close();
  }
});
