import { Title } from '@solidjs/meta';

import BoardCreator from '../components/BoardCreator';
import RecentBoardsList from '../components/RecentBoardsList';

export default function Home() {
  return (
    <main class="mx-auto max-w-xl px-4 py-6 sm:px-6 sm:py-10 lg:grid lg:max-w-6xl lg:grid-cols-[minmax(0,33rem)_minmax(0,25rem)] lg:items-start lg:gap-x-16 lg:py-14 xl:gap-x-20">
      <Title>Retrocks — Instant, Privacy-First Retrospectives</Title>
      <BoardCreator />
      <RecentBoardsList />
    </main>
  );
}
