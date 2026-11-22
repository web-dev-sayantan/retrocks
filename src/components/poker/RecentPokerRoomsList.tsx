import { pokerRoomPath } from '../../lib/poker-routes';
import { readRecentPokerRooms, removeRecentPokerRoom } from '../../lib/recent-poker-rooms';
import RecentLinksList from '../RecentLinksList';

function withTitles(rooms: ReturnType<typeof readRecentPokerRooms>) {
  return rooms.map((room) => ({ ...room, title: `Room · ${room.id.slice(0, 8)}` }));
}

export default function RecentPokerRoomsList() {
  return (
    <RecentLinksList
      heading="Recent Rooms"
      href={pokerRoomPath}
      read={() => withTitles(readRecentPokerRooms())}
      remove={(id) => withTitles(removeRecentPokerRoom(id))}
    />
  );
}
