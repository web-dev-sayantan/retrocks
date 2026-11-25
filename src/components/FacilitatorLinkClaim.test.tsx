import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { fireEvent, render, waitFor } from '@solidjs/testing-library';
import { createSignal, flush } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeBoardDispatcher, makeBoardView } from '../lib/board-fixtures';
import type { BoardLiveTransport } from '../lib/board-live';
import type { BoardViewDTO } from '../lib/board-types';
import type { FacilitatorClaimInput, FacilitatorClaimResponse } from '../lib/sharing-actions';
import BoardWorkspace from './BoardWorkspace';
import FacilitatorLinkClaim from './FacilitatorLinkClaim';

const BOARD_ID = 'board_0123456789abcdef';
const BOARD_PATH = `/b/${BOARD_ID}`;
const VALID_TOKEN = 'A'.repeat(43);

function createFakeLiveTransport() {
  const connections: Array<{ path: string; closed: boolean }> = [];
  const transport: BoardLiveTransport = {
    connect(path) {
      const connection = { path, closed: false };
      connections.push(connection);
      return {
        ping() {},
        close() {
          connection.closed = true;
        },
      };
    },
  };
  return { transport, connections };
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('FacilitatorLinkClaim', () => {
  it('scrubs the fragment, invokes onClaimed in place, and does not reload on a valid link', async () => {
    const claimedBoard = makeBoardView({ id: BOARD_ID, version: 2, isFacilitator: true });
    window.history.replaceState(null, '', `${BOARD_PATH}?view=all#f=${VALID_TOKEN}`);

    const claim = vi.fn(async (_input: FacilitatorClaimInput): Promise<FacilitatorClaimResponse> => {
      expect(window.location.hash).toBe('');
      return { ok: true, board: claimedBoard };
    });
    const onClaimed = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const view = render(() => (
      <FacilitatorLinkClaim boardId={BOARD_ID} claim={claim} onClaimed={onClaimed} />
    ));

    try {
      await waitFor(() => expect(onClaimed).toHaveBeenCalledWith(claimedBoard));
      expect(claim).toHaveBeenCalledWith({ boardId: BOARD_ID, token: VALID_TOKEN });
      expect(window.location.pathname + window.location.search).toBe(`${BOARD_PATH}?view=all`);
      expect(view.queryByRole('alert')).not.toBeInTheDocument();
      // jsdom logs an error if window.location.reload() is invoked.
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('scrubs an invalid or rotated link and surfaces the error in place without reloading', async () => {
    window.history.replaceState(null, '', `${BOARD_PATH}#f=rotated-or-invalid`);
    const claim = vi.fn(async (): Promise<FacilitatorClaimResponse> => ({
      ok: false,
      code: 'FORBIDDEN',
      message: 'This Co-Facilitator Link is invalid or has expired.',
    }));
    const onClaimed = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const view = render(() => (
      <FacilitatorLinkClaim boardId={BOARD_ID} claim={claim} onClaimed={onClaimed} />
    ));

    try {
      const alert = await view.findByRole('alert');
      expect(alert).toHaveTextContent('This Co-Facilitator Link is invalid or has expired.');
      expect(window.location.hash).toBe('');
      expect(onClaimed).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('surfaces a fallback error in place when the claim request fails', async () => {
    window.history.replaceState(null, '', `${BOARD_PATH}#f=${VALID_TOKEN}`);
    const claim = vi.fn(async (): Promise<FacilitatorClaimResponse> => {
      throw new Error('network down');
    });
    const onClaimed = vi.fn();

    const view = render(() => (
      <FacilitatorLinkClaim boardId={BOARD_ID} claim={claim} onClaimed={onClaimed} />
    ));

    try {
      const alert = await view.findByRole('alert');
      expect(alert).toHaveTextContent('Could not claim Facilitator access. Reopen the link to try again.');
      expect(window.location.hash).toBe('');
      expect(onClaimed).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('claims a Co-Facilitator Link via in-page hashchange and clears any prior error', async () => {
    const claimedBoard = makeBoardView({ id: BOARD_ID, version: 3, isFacilitator: true });
    window.history.replaceState(null, '', `${BOARD_PATH}#f=bad-token`);

    const claim = vi
      .fn<(input: FacilitatorClaimInput) => Promise<FacilitatorClaimResponse>>()
      .mockResolvedValueOnce({
        ok: false,
        code: 'FORBIDDEN',
        message: 'This Co-Facilitator Link is invalid or has expired.',
      })
      .mockResolvedValueOnce({
        ok: true,
        board: claimedBoard,
      });
    const onClaimed = vi.fn();

    const view = render(() => (
      <FacilitatorLinkClaim boardId={BOARD_ID} claim={claim} onClaimed={onClaimed} />
    ));

    try {
      expect(await view.findByRole('alert')).toHaveTextContent(
        'This Co-Facilitator Link is invalid or has expired.',
      );

      // Now open a valid Co-Facilitator Link in place via hashchange.
      window.history.replaceState(null, '', `${BOARD_PATH}#f=${VALID_TOKEN}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));

      await waitFor(() => expect(onClaimed).toHaveBeenCalledWith(claimedBoard));
      expect(window.location.hash).toBe('');
      expect(view.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      view.unmount();
    }
  });

  it('ignores a superseded claim result and stops claiming after unmount', async () => {
    const older = Promise.withResolvers<FacilitatorClaimResponse>();
    const newer = Promise.withResolvers<FacilitatorClaimResponse>();
    const claimedBoard = makeBoardView({ id: BOARD_ID, version: 3, isFacilitator: true });
    const claim = vi.fn<(input: FacilitatorClaimInput) => Promise<FacilitatorClaimResponse>>()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const onClaimed = vi.fn();

    window.history.replaceState(null, '', `${BOARD_PATH}#f=${VALID_TOKEN}`);
    const view = render(() => (
      <FacilitatorLinkClaim boardId={BOARD_ID} claim={claim} onClaimed={onClaimed} />
    ));
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));

    const openAnotherLink = () => {
      window.history.replaceState(null, '', `${BOARD_PATH}#f=${'B'.repeat(43)}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    };
    openAnotherLink();
    expect(claim).toHaveBeenCalledTimes(2);
    expect(window.location.hash).toBe('');

    newer.resolve({ ok: true, board: claimedBoard });
    await waitFor(() => expect(onClaimed).toHaveBeenCalledWith(claimedBoard));
    older.resolve({ ok: true, board: { ...claimedBoard, version: 2 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onClaimed).toHaveBeenCalledTimes(1);

    view.unmount();
    openAnotherLink();
    expect(claim).toHaveBeenCalledTimes(2);
    expect(window.location.hash).toBe(`#f=${'B'.repeat(43)}`);
  });

  it('activates Facilitator controls, preserves local filter state, and reconnects live updates in place', async () => {
    const { artifact } = await captureArtifact(
      async () => {
        const participantBoard = makeBoardView({
          id: BOARD_ID,
          version: 2,
          isFacilitator: false,
        });
        const facilitatorBoard: BoardViewDTO = {
          ...participantBoard,
          isFacilitator: true,
        };
        const { dispatchCommand } = createFakeBoardDispatcher(facilitatorBoard);
        const { transport, connections } = createFakeLiveTransport();
        const claim = vi.fn(async (): Promise<FacilitatorClaimResponse> => ({
          ok: true,
          board: facilitatorBoard,
        }));

        window.history.replaceState(null, '', BOARD_PATH);

        const view = render(() => {
          const [board, setBoard] = createSignal<BoardViewDTO>(participantBoard);
          const [liveReconnectKey, setLiveReconnectKey] = createSignal(0);

          return (
            <>
              <FacilitatorLinkClaim
                boardId={BOARD_ID}
                claim={claim}
                onClaimed={(claimed) => {
                  setBoard(claimed);
                  setLiveReconnectKey((n) => n + 1);
                }}
              />
              <BoardWorkspace
                board={board()}
                boardId={BOARD_ID}
                dispatchCommand={dispatchCommand}
                liveTransport={transport}
                liveReconnectKey={liveReconnectKey()}
              />
            </>
          );
        });

        try {
          flush();
          expect(connections).toHaveLength(1);
          // Facilitator-only Private Mode toggle is not shown for a Participant.
          expect(view.queryByRole('button', { name: /Private Mode/i })).not.toBeInTheDocument();

          // Set local search filter state that must survive the in-place claim.
          const searchInput = view.getByPlaceholderText('Search cards…') as HTMLInputElement;
          fireEvent.input(searchInput, { target: { value: 'deploy' } });
          flush();
          expect(searchInput.value).toBe('deploy');

          // Trigger an in-page Co-Facilitator Link claim via hashchange.
          window.history.replaceState(null, '', `${BOARD_PATH}#f=${VALID_TOKEN}`);
          window.dispatchEvent(new HashChangeEvent('hashchange'));

          // Facilitator controls appear in place without remounting or losing search state.
          await waitFor(() =>
            expect(view.getByRole('button', { name: /Private Mode/i })).toBeInTheDocument(),
          );
          expect(searchInput.value).toBe('deploy');
          expect(window.location.hash).toBe('');
          expect(connections[0].closed).toBe(true);
          expect(connections).toHaveLength(2);
        } finally {
          view.unmount();
        }
      },
      { scenario: 'facilitator-link-claim-in-place-workspace' },
    );
    expectNoDiagnostics(artifact);
  });
});
