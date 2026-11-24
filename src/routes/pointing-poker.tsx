import { Title } from '@solidjs/meta';
import { useSubmissions } from '@solidjs/router';
import { Field, FieldDescription, FieldLabel } from '@ui-sdk/solid/field';
import { Input } from '@ui-sdk/solid/input';

import RecentPokerRoomsList from '../components/poker/RecentPokerRoomsList';
import RoomNameForm from '../components/poker/RoomNameForm';
import { createPokerRoom } from '../lib/poker-actions';
import { POKER_DEFAULT_ROOM_NAME, POKER_ROOM_NAME_LIMIT } from '../lib/poker-types';

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
      >
        <Field name="roomName" class="grid gap-1.5">
          <FieldLabel class="text-sm font-semibold">Room name</FieldLabel>
          <FieldDescription class="text-xs leading-relaxed text-text-muted">
            Optional. Defaults to {POKER_DEFAULT_ROOM_NAME}.
          </FieldDescription>
          <Input
            class="poker-input board-focus-ring mt-1"
            placeholder={POKER_DEFAULT_ROOM_NAME}
            maxlength={POKER_ROOM_NAME_LIMIT}
          />
        </Field>
      </RoomNameForm>
    </>
  );
}
