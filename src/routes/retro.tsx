import { Title } from '@solidjs/meta';

import BoardCreator from '../components/BoardCreator';
import RecentBoardsList from '../components/RecentBoardsList';

export default function RetroSetup() {
  return (
    <main class="mx-auto max-w-xl px-4 pt-6 pb-12 sm:px-6 sm:pt-10 sm:pb-16 lg:max-w-6xl lg:pt-12 lg:pb-20">
      <Title>Create a Board — Retrocks</Title>
      <BoardCreator secondary={<RecentBoardsList />} />
    </main>
  );
}
