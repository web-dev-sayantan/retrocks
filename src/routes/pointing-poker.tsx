import { Title } from '@solidjs/meta';
import { useSubmissions } from '@solidjs/router';

import RecentPokerRoomsList from '../components/poker/RecentPokerRoomsList';
import RoomNameForm from '../components/poker/RoomNameForm';
import { createPokerRoom } from '../lib/poker-actions';

export default function PointingPoker() {
  const submissions = useSubmissions(createPokerRoom);
  const latest = () => submissions.at(-1);

  return (
    <>
      <Title>Pointing Poker — Retrocks</Title>
      <RoomNameForm
        heading="Pointing Poker"
        description="Estimate Stories together in a live Room. Share the link to invite your team. No account required."
        submitLabel="Create Room"
        action={createPokerRoom}
        secondary={<RecentPokerRoomsList />}
        error={latest()?.result?.message ?? (latest()?.error ? 'Could not create the Room. Try again.' : undefined)}
      />
    </>
  );
}
