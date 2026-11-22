import { Meta, Title } from '@solidjs/meta';
import { useParams, type RouteDefinition } from '@solidjs/router';
import { Show, createMemo, createSignal } from 'solid-js';

import BoardWorkspace from '../../components/BoardWorkspace';
import FacilitatorLinkClaim from '../../components/FacilitatorLinkClaim';
import { getBoard } from '../../lib/board-actions';
import type { BoardViewDTO } from '../../lib/board-types';
import { parseBoardView } from '../../lib/wire-schemas';
import { paths } from '../../router';

export const route = {
  preload: ({ params }) => {
    if (params.id) {
      void getBoard(params.id);
    }
  },
} satisfies RouteDefinition;

export default function BoardRoute() {
  const params = useParams();
  const fetchedBoard = createMemo(() => getBoard(params.id ?? ''));
  const [claimed, setClaimed] = createSignal<{
    board: BoardViewDTO;
    revision: number;
  } | null>(null);
  // Wire validation: a malformed payload throws into the app's <Errored> path
  // instead of rendering a Board with blank fields.
  const board = createMemo(() => {
    const fetched = fetchedBoard();
    const loaded = fetched === null ? null : parseBoardView(fetched);
    const currentClaimed = claimed();
    if (
      currentClaimed &&
      currentClaimed.board.id === (params.id ?? '') &&
      (!loaded || currentClaimed.board.version >= loaded.version)
    ) {
      return currentClaimed.board;
    }
    return loaded;
  });
  const liveReconnectKey = createMemo(() => {
    const currentClaimed = claimed();
    return currentClaimed && currentClaimed.board.id === (params.id ?? '')
      ? currentClaimed.revision
      : 0;
  });
  const title = createMemo(() => {
    const loaded = board();
    return loaded ? `${loaded.title} — Retrocks` : 'Board Not Found — Retrocks';
  });

  function handleClaimed(claimedBoard: BoardViewDTO): void {
    const parsed = parseBoardView(claimedBoard);
    setClaimed((prev) => ({
      board: parsed,
      revision: (prev?.revision ?? 0) + 1,
    }));
  }

  return (
    <>
      <Meta name="robots" content="noindex, nofollow" />
      <Title>{title()}</Title>
      <FacilitatorLinkClaim
        boardId={params.id ?? ''}
        onClaimed={handleClaimed}
      />
      <Show
        when={board()}
        fallback={
          <BoardWorkspace
            board={null}
            boardId={params.id ?? ''}
            homeHref={paths()}
          />
        }
      >
        {(resolved) => (
          <BoardWorkspace
            board={resolved()}
            boardId={params.id ?? ''}
            homeHref={paths()}
            liveReconnectKey={liveReconnectKey()}
          />
        )}
      </Show>
    </>
  );
}
