import { Title } from '@solidjs/meta';
import { useSubmissions } from '@solidjs/router';
import { Field, FieldDescription, FieldLabel } from '@ui-sdk/solid/field';
import { Input } from '@ui-sdk/solid/input';
import { Clock, ShieldCheck } from 'lucide';
import { createSignal } from 'solid-js';

import LucideIcon from '../components/LucideIcon';
import PokerSnapshot from '../components/home/PokerSnapshot';
import RecentPokerRoomsList from '../components/poker/RecentPokerRoomsList';
import RoomNameForm from '../components/poker/RoomNameForm';
import { createPokerRoom } from '../lib/poker-actions';
import { POKER_DEFAULT_ROOM_NAME, POKER_ROOM_NAME_LIMIT } from '../lib/poker-types';

export default function PointingPoker() {
  const submissions = useSubmissions(createPokerRoom);
  const latest = () => submissions.at(-1);
  const [displayName, setDisplayName] = createSignal('');
  const [roomName, setRoomName] = createSignal('');

  return (
    <>
      <Title>Create a Room — Retrocks</Title>
      <RoomNameForm
        heading="Create a room"
        description="Name your Room, share the link, and estimate Stories together."
        submitLabel="Create Room"
        action={createPokerRoom}
        onDisplayNameChange={setDisplayName}
        secondary={<RecentPokerRoomsList />}
        preview={
          <aside aria-label="Room preview" class="h-full">
            <PokerSnapshot
              decorative={false}
              roomName={roomName()}
              displayName={displayName()}
              footer={
                <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 bg-surface px-4 py-2.5 text-xs text-text-muted sm:px-5">
                  <span class="inline-flex items-center gap-1.5">
                    <LucideIcon icon={ShieldCheck} class="size-3.5 text-accent" strokeWidth={1.9} />
                    <span>No account required</span>
                  </span>
                  <span class="inline-flex items-center gap-1.5 tabular-nums">
                    <LucideIcon icon={Clock} class="size-3.5" strokeWidth={1.8} />
                    <span>Expires after 90 days of inactivity</span>
                  </span>
                </div>
              }
            />
          </aside>
        }
        error={latest()?.result?.message ?? (latest()?.error ? 'Could not create the Room. Try again.' : undefined)}
      >
        <Field name="roomName" class="grid gap-2">
          <FieldLabel class="text-sm font-medium text-text">
            Room name <span class="font-normal text-text-muted">(optional)</span>
          </FieldLabel>
          <Input
            class="board-input board-focus-ring"
            placeholder={POKER_DEFAULT_ROOM_NAME}
            maxlength={POKER_ROOM_NAME_LIMIT}
            onValueChange={setRoomName}
          />
          <FieldDescription class="text-xs leading-relaxed text-text-muted">
            Defaults to {POKER_DEFAULT_ROOM_NAME}.
          </FieldDescription>
        </Field>
      </RoomNameForm>
    </>
  );
}
