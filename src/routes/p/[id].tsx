import { Meta, Title } from '@solidjs/meta';
import { useParams, useSubmissions, type RouteDefinition } from '@solidjs/router';
import { Show, createMemo, createSignal, onSettled, untrack } from 'solid-js';

import PageMessage from '../../components/PageMessage';
import PokerWorkspace from '../../components/poker/PokerWorkspace';
import RoomNameForm from '../../components/poker/RoomNameForm';
import { getPokerRoom, joinPokerRoom } from '../../lib/poker-actions';
import { createPokerLive } from '../../lib/poker-live';
import { pokerSetupPath } from '../../lib/poker-routes';
import type { PokerRoomView } from '../../lib/poker-types';

export const route = {
  preload: ({ params }) => {
    if (params.id) void getPokerRoom(params.id);
  },
} satisfies RouteDefinition;

function RoomUnavailable() {
  return (
    <PageMessage title="Room unavailable" message="This link does not lead to an available Pointing Poker Room.">
      <a class="page-message-action" href={pokerSetupPath}>Create a Room</a>
    </PageMessage>
  );
}

function JoinedRoom(props: { room: PokerRoomView; focusHeading: boolean }) {
  const [liveRoom, setLiveRoom] = createSignal<PokerRoomView | null>(null);
  const [online, setOnline] = createSignal<string[]>([]);
  const [missing, setMissing] = createSignal(false);
  const [live, setLive] = createSignal<ReturnType<typeof createPokerLive> | null>(null);
  const room = () => liveRoom() ?? props.room;

  onSettled(() => {
    const stream = createPokerLive(untrack(() => props.room.id), (message) => {
      if (message.type === 'room:snapshot' && message.room.id === untrack(() => props.room.id)) {
        setLiveRoom((current) => !current || message.room.version >= current.version ? message.room : current);
      } else if (message.type === 'room:presence') {
        setOnline(message.online);
      } else if (message.type === 'room:missing') {
        setMissing(true);
      }
    }, () => setOnline([]));
    setLive(stream);
    return stream.dispose;
  });

  return (
    <Show when={!missing()} fallback={<RoomUnavailable />}>
      <PokerWorkspace
        room={room()}
        online={online()}
        status={live()?.status() ?? 'connecting'}
        focusHeading={props.focusHeading}
      />
    </Show>
  );
}

function RoomPage(props: { initialRoom: PokerRoomView }) {
  const room = () => props.initialRoom;
  const id = untrack(() => props.initialRoom.id);
  const submit = joinPokerRoom.with(id);
  const submissions = useSubmissions(joinPokerRoom, ([roomId]) => roomId === id);
  const latest = () => submissions.at(-1);
  const [focusHeading, setFocusHeading] = createSignal(false);
  submit.onSubmit(() => setFocusHeading(true));

  return (
    <Show when={room().viewer} fallback={
      <RoomNameForm
        heading="Join Pointing Poker"
        submitLabel="Join Room"
        action={submit}
        error={latest()?.result?.message ?? (latest()?.error ? 'Could not join the Room. Try again.' : undefined)}
      />
    }>
      <JoinedRoom room={room()} focusHeading={focusHeading()} />
    </Show>
  );
}

export default function PokerRoomRoute() {
  const params = useParams();
  const initialRoom = createMemo(() => getPokerRoom(params.id ?? ''));

  return (
    <>
      <Title>Pointing Poker Room — Retrocks</Title>
      <Meta name="robots" content="noindex, nofollow" />
      <Show when={initialRoom()} fallback={<RoomUnavailable />}>
        {(room) => (
          <Show when={room().id} keyed>
            {(_id) => <RoomPage initialRoom={room()} />}
          </Show>
        )}
      </Show>
    </>
  );
}
