import { Title } from '@solidjs/meta';

import BoardCreator from '../components/BoardCreator';
import RecentBoardsList from '../components/RecentBoardsList';
import { pokerSetupPath } from '../lib/poker-routes';

export default function Home() {
  return (
    <main class="mx-auto max-w-xl px-4 pt-6 pb-12 sm:px-6 sm:pt-10 sm:pb-16 lg:max-w-6xl lg:pt-12 lg:pb-20">
      <Title>Retrocks — Instant, Privacy-First Retrospectives</Title>
      <nav aria-label="Retrocks tools" class="mb-4 flex justify-end">
        <a
          href={pokerSetupPath}
          class="board-focus-ring inline-flex min-h-12 items-center rounded-lg border border-control bg-surface px-4 text-sm font-semibold text-text hover:bg-surface-subtle"
        >
          Pointing Poker
        </a>
      </nav>
      <BoardCreator secondary={<RecentBoardsList />} />
    </main>
  );
}
