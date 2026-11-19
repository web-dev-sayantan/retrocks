import { Title } from '@solidjs/meta';

import BoardCreator from '../components/BoardCreator';
import RecentBoardsList from '../components/RecentBoardsList';

export default function Home() {
  return (
    <main class="mx-auto max-w-xl px-4 py-6 sm:px-6 sm:py-10">
      <Title>Retrocks — Instant, Privacy-First Retrospectives</Title>
      <BoardCreator />
      <RecentBoardsList />
    </main>
  );
}
