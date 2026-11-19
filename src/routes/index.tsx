import { Title } from '@solidjs/meta';

import BoardCreator from '../components/BoardCreator';
import RecentBoardsList from '../components/RecentBoardsList';

export default function Home() {
  return (
    <main class="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <Title>Retrocks — Instant, Privacy-First Retrospectives</Title>
      <BoardCreator />
      <RecentBoardsList />
    </main>
  );
}
