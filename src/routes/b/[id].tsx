import { Meta, Title } from '@solidjs/meta';
import { useParams, type RouteDefinition } from '@solidjs/router';
import { Show, createMemo } from 'solid-js';

import BoardWorkspace from '../../components/BoardWorkspace';
import FacilitatorLinkClaim from '../../components/FacilitatorLinkClaim';
import { getBoard } from '../../lib/board-actions';
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
  const board = createMemo(() => getBoard(params.id ?? ''));

  return (
    <>
      <Meta name="robots" content="noindex, nofollow" />
      <Title>
        {board() ? `${board()!.title} — Retrocks` : 'Board Not Found — Retrocks'}
      </Title>
      <FacilitatorLinkClaim boardId={params.id ?? ''} />
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
          />
        )}
      </Show>
    </>
  );
}
