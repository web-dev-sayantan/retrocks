import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { commitEventResponse, createRequestEvent } from '@solidjs/web';
import { provideRequestEvent } from '@solidjs/web/storage';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { NodeBoardStore } from '../adapters/node/sqlite-board-store';

const TEST_SECRET = 'sharing-test-session-secret-with-at-least-32-chars';
let store: NodeBoardStore;
let databaseDirectory: string | undefined;

async function runRequest<T>(handler: () => Promise<T>, cookie?: string) {
  const request = new Request('https://retrocks.test/_server', {
    method: 'POST',
    headers: cookie ? { cookie } : undefined,
  });
  const event = createRequestEvent(request);
  return provideRequestEvent(event, async () => {
    const result = await handler();
    const response = commitEventResponse(new Response(), event);
    return { result, response };
  });
}

async function createBoard() {
  const { createBoardForRequest } = await import('./board-service');
  const { result: board, response } = await runRequest(() =>
    createBoardForRequest({}),
  );
  return {
    boardId: board.id,
    facilitatorCookie: response.headers.getSetCookie()[0].split(';')[0],
  };
}

beforeEach(async () => {
  vi.stubEnv('SESSION_SECRET', TEST_SECRET);
  vi.resetModules();
  const { createNodeBoardStore } = await import(
    '../adapters/node/sqlite-board-store'
  );
  const { setBoardStoreForTests } = await import('../adapters/runtime');
  store = await createNodeBoardStore();
  setBoardStoreForTests(store);
});

afterEach(async () => {
  const { setBoardStoreForTests } = await import('../adapters/runtime');
  setBoardStoreForTests(null);
  store.close();
  if (databaseDirectory) {
    await rm(databaseDirectory, { recursive: true, force: true });
    databaseDirectory = undefined;
  }
  vi.unstubAllEnvs();
});

it('only retrieves the Co-Facilitator Link for a verified Facilitator of that Board', async () => {
  const { getFacilitatorLinkForRequest } = await import('./sharing-service');
  const { boardId, facilitatorCookie } = await createBoard();
  const { facilitatorCookie: unrelatedCookie } = await createBoard();
  const getLink = () => getFacilitatorLinkForRequest(boardId);

  await expect(runRequest(getLink)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(runRequest(getLink, unrelatedCookie)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  const { result } = await runRequest(getLink, facilitatorCookie);
  expect(result).toMatch(new RegExp(`^/b/${boardId}#f=[A-Za-z0-9_-]{43}$`));
});

it('rejects an invalid Co-Facilitator Link without granting a cookie', async () => {
  const { claimFacilitatorRoleForRequest } = await import('./sharing-service');
  const { boardId } = await createBoard();
  const { response } = await runRequest(async () => {
    await expect(
      claimFacilitatorRoleForRequest({ boardId, token: 'A'.repeat(43) }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  expect(response.headers.getSetCookie()).toEqual([]);
});

it('grants a signed HttpOnly Facilitator cookie and returns the Facilitator Board projection when a Participant claims a valid link', async () => {
  const { claimFacilitatorRoleForRequest, getFacilitatorLinkForRequest } =
    await import('./sharing-service');
  const { dispatchBoardCommandForRequest, getBoardForRequest } = await import('./board-service');
  const { boardId, facilitatorCookie } = await createBoard();
  const { result: link } = await runRequest(
    () => getFacilitatorLinkForRequest(boardId),
    facilitatorCookie,
  );
  const { result: participantBoard, response: participantResponse } = await runRequest(
    () => getBoardForRequest(boardId),
  );
  expect(participantBoard?.isFacilitator).toBe(false);
  const participantCookie = participantResponse.headers.getSetCookie()[0].split(';')[0];
  await runRequest(
    () =>
      dispatchBoardCommandForRequest(boardId, {
        type: 'card:create',
        columnId: participantBoard!.columns[0].id,
        content: 'Participant Card before claim',
      }),
    participantCookie,
  );

  const { result: claimedBoard, response } = await runRequest(
    () => claimFacilitatorRoleForRequest({ boardId, token: link.split('#f=')[1] }),
    participantCookie,
  );

  const [cookie] = response.headers.getSetCookie();
  expect(cookie).toMatch(/; HttpOnly/i);
  expect(claimedBoard).toMatchObject({
    id: boardId,
    isFacilitator: true,
  });
  expect(claimedBoard.cards).toHaveLength(1);
  expect(claimedBoard.cards[0]).toMatchObject({
    content: 'Participant Card before claim',
    isMine: true,
  });
  const { result: board } = await runRequest(
    () => getBoardForRequest(boardId),
    cookie.split(';')[0],
  );
  expect(board?.isFacilitator).toBe(true);
});

it('retrieves the same Co-Facilitator Link after SESSION_SECRET rotation', async () => {
  const { getFacilitatorLinkForRequest } = await import('./sharing-service');
  const { boardId, facilitatorCookie } = await createBoard();
  const { result: before } = await runRequest(
    () => getFacilitatorLinkForRequest(boardId),
    facilitatorCookie,
  );

  vi.stubEnv('SESSION_SECRET', `a-new-sharing-session-secret-for-rotation,${TEST_SECRET}`);
  vi.resetModules();
  const { setBoardStoreForTests } = await import('../adapters/runtime');
  setBoardStoreForTests(store);
  const { getFacilitatorLinkForRequest: getLinkAfterRotation } = await import(
    './sharing-service'
  );
  const { result: after, response } = await runRequest(
    () => getLinkAfterRotation(boardId),
    facilitatorCookie,
  );

  expect(after).toBe(before);
  expect(response.headers.get('cache-control')).toBe('no-store');

  // The stored ciphertext was lazily re-encrypted under the new primary secret,
  // so it remains decryptable even after the old secret is retired.
  vi.stubEnv('SESSION_SECRET', 'a-new-sharing-session-secret-for-rotation');
  vi.resetModules();
  const { setBoardStoreForTests: setStoreAfterRetire } = await import(
    '../adapters/runtime'
  );
  setStoreAfterRetire(store);
  const { getFacilitatorLinkForRequest: getLinkAfterRetire } = await import(
    './sharing-service'
  );
  const { claimFacilitatorRoleForRequest: claimAfterRetire } = await import(
    './sharing-service'
  );
  const { response: newSessionResponse } = await runRequest(() =>
    claimAfterRetire({ boardId, token: before.split('#f=')[1] }),
  );
  const newCookie = newSessionResponse.headers.getSetCookie()[0].split(';')[0];
  const { result: afterRetire } = await runRequest(
    () => getLinkAfterRetire(boardId),
    newCookie,
  );
  expect(afterRetire).toBe(before);
});

it('lets a Facilitator rotate a Locked Board link and revokes prior links', async () => {
  const { createNodeBoardStore } = await import(
    '../adapters/node/sqlite-board-store'
  );
  const { setBoardStoreForTests } = await import('../adapters/runtime');
  const { getBoardForRequest } = await import('./board-service');
  const {
    claimFacilitatorRoleForRequest,
    getFacilitatorLinkForRequest,
    rotateFacilitatorLinkForRequest,
  } = await import('./sharing-service');

  // Set up a Locked Board before the Board Settings UI is available.
  databaseDirectory = await mkdtemp(join(tmpdir(), 'retrocks-sharing-'));
  const dbPath = join(databaseDirectory, 'board.sqlite');
  store.close();
  store = await createNodeBoardStore(dbPath);
  setBoardStoreForTests(store);

  const { boardId, facilitatorCookie } = await createBoard();
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare('UPDATE boards SET is_locked = 1 WHERE id = ?').run(boardId);
  } finally {
    db.close();
  }
  const { result: board } = await runRequest(() => getBoardForRequest(boardId));
  expect(board?.isLocked).toBe(true);

  const { result: oldLink } = await runRequest(
    () => getFacilitatorLinkForRequest(boardId),
    facilitatorCookie,
  );
  await expect(runRequest(() => getFacilitatorLinkForRequest(boardId)))
    .rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Facilitator access is required.',
    });
  await expect(runRequest(() => rotateFacilitatorLinkForRequest(boardId)))
    .rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Facilitator access is required.',
    });
  // Store-level facilitator:rotate also returns FORBIDDEN (not BOARD_LOCKED) on a Locked Board
  const storeRotateOutcome = await store.mutateBoard(
    boardId,
    { participantHash: 'non_facilitator_hash', isFacilitator: false },
    {
      type: 'facilitator:rotate',
      capability: {
        facilitatorTokenHash: 'unused_hash',
        facilitatorTokenEncrypted: 'unused_enc',
      },
    },
  );
  expect(storeRotateOutcome).toEqual({
    ok: false,
    code: 'FORBIDDEN',
    message: 'Only a Facilitator can rotate the Co-Facilitator Link.',
  });

  const { result: newLink } = await runRequest(
    () => rotateFacilitatorLinkForRequest(boardId),
    facilitatorCookie,
  );
  expect(newLink).not.toBe(oldLink);
  const { result: updatedBoard } = await runRequest(() => getBoardForRequest(boardId));
  expect(updatedBoard?.version).toBe(board!.version + 1);
  expect(updatedBoard?.isLocked).toBe(true);
  const { result: storedLink } = await runRequest(
    () => getFacilitatorLinkForRequest(boardId),
    facilitatorCookie,
  );
  expect(storedLink).toBe(newLink);

  await expect(runRequest(() =>
    claimFacilitatorRoleForRequest({ boardId, token: oldLink.split('#f=')[1] }),
  )).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const { response } = await runRequest(() =>
    claimFacilitatorRoleForRequest({ boardId, token: newLink.split('#f=')[1] }),
  );
  expect(response.headers.getSetCookie()[0]).toMatch(/; HttpOnly/i);
});
