import { afterEach, expect, it, vi } from 'vitest';

import { makeBoardView } from './board-fixtures';
import { claimFacilitatorLink } from './facilitator-link';

const boardId = 'board_0123456789abcdef';
const boardPath = `/b/${boardId}`;
const token = 'A'.repeat(43);

afterEach(() => window.history.replaceState(null, '', '/'));

it('scrubs the fragment before exchanging only the Board ID and token', async () => {
  const claimedBoard = makeBoardView({ id: boardId, isFacilitator: true });
  window.history.replaceState({ key: 'keep' }, '', `${boardPath}?view=all#f=${token}`);
  const claim = vi.fn(async () => {
    expect(window.location.hash).toBe('');
    return { ok: true, board: claimedBoard } as const;
  });

  await expect(claimFacilitatorLink(boardId, claim)).resolves.toEqual({
    ok: true,
    board: claimedBoard,
  });
  expect(claim).toHaveBeenCalledWith({ boardId, token });
  expect(window.location.pathname + window.location.search).toBe(`${boardPath}?view=all`);
  expect(window.history.state).toEqual({ key: 'keep' });
});

it('keeps a rejected link scrubbed and surfaces the error', async () => {
  window.history.replaceState(null, '', `${boardPath}#f=invalid`);
  const claim = vi.fn(async () => ({
    ok: false,
    code: 'FORBIDDEN',
    message: 'This Co-Facilitator Link is invalid or has expired.',
  }) as const);

  await expect(claimFacilitatorLink(boardId, claim)).resolves.toMatchObject({
    ok: false,
    code: 'FORBIDDEN',
  });
  expect(window.location.hash).toBe('');
});

it('ignores a fragment without a Facilitator token', async () => {
  window.history.replaceState(null, '', `${boardPath}#notes`);
  const claim = vi.fn();

  await expect(claimFacilitatorLink(boardId, claim)).resolves.toBeNull();
  expect(claim).not.toHaveBeenCalled();
  expect(window.location.hash).toBe('#notes');
});
