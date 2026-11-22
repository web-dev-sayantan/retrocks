import { readRecentBoards, removeRecentBoard } from '../lib/recent-boards';
import RecentLinksList from './RecentLinksList';

export default function RecentBoardsList() {
  return (
    <RecentLinksList
      heading="Recent Boards"
      read={readRecentBoards}
      remove={removeRecentBoard}
      href={(id) => `/b/${id}`}
    />
  );
}
