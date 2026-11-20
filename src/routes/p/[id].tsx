import { Meta, Title } from '@solidjs/meta';
import { useParams, useSubmissions, type RouteDefinition } from '@solidjs/router';
import { Show, createMemo, createSignal, onSettled, untrack } from 'solid-js';

import PageMessage from '../../components/PageMessage';
import PokerWorkspace from '../../components/poker/PokerWorkspace';
import RoomNameForm from '../../components/poker/RoomNameForm';
import { takeFacilitatorLinkToken } from '../../lib/facilitator-link';
import { changePokerRoom, getPokerRoom, joinPokerRoom } from '../../lib/poker-actions';
import { createPokerLive } from '../../lib/poker-live';
import { pokerRoomPath, pokerSetupPath } from '../../lib/poker-routes';
import { claimPokerFacilitatorLink } from '../../lib/poker-sharing-actions';
import type { PokerRoomView, PokerRoomChange } from '../../lib/poker-types';

export const route = {
  preload: ({ params }) => {
    if (params.id) void getPokerRoom(params.id);
  },
} satisfies RouteDefinition;

function RoomUnavailable(props: { roomId?: string }) {
  onSettled(() => {
    function scrubFragment() {
      const id = untrack(() => props.roomId);
      if (id) takeFacilitatorLinkToken(pokerRoomPath(id));
    }
    window.addEventListener('hashchange', scrubFragment);
    scrubFragment();
    return () => window.removeEventListener('hashchange', scrubFragment);
  });

  return (
    <PageMessage title="Room unavailable" message="This link does not lead to an available Pointing Poker Room.">
      <a class="page-message-action" href={pokerSetupPath}>Create a Room</a>
    </PageMessage>
  );
}

function JoinedRoom(props: { room: PokerRoomView; focusHeading: boolean; claimError: string }) {
  const [liveRoom, setLiveRoom] = createSignal<PokerRoomView | null>(null);
  const [online, setOnline] = createSignal<string[]>([]);
  const [missing, setMissing] = createSignal(false);
  const [live, setLive] = createSignal<ReturnType<typeof createPokerLive> | null>(null);
  const room = () => {
    const current = liveRoom();
    return current && current.version >= props.room.version ? current : props.room;
  };

  function acceptRoom(next: PokerRoomView) {
    if (next.id === props.room.id) {
      setLiveRoom((current) => !current || next.version >= current.version ? next : current);
    }
  }

  async function onChange(command: PokerRoomChange) {
    const result = await changePokerRoom(props.room.id, command);
    if (result.ok) acceptRoom(result.room);
    return result;
  }

  onSettled(() => {
    const stream = createPokerLive(untrack(() => props.room.id), (message) => {
      if (message.type === 'room:snapshot') {
        acceptRoom(message.room);
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
        claimError={props.claimError}
        onChange={onChange}
      />
    </Show>
  );
}

function RoomPage(props: { initialRoom: PokerRoomView }) {
  const [claimedRoom, setClaimedRoom] = createSignal<PokerRoomView>();
  const [claimError, setClaimError] = createSignal('');
  const [claimPending, setClaimPending] = createSignal(false);
  const room = () => {
    const claimed = claimedRoom();
    return claimed && claimed.version >= props.initialRoom.version ? claimed : props.initialRoom;
  };
  const id = untrack(() => props.initialRoom.id);
  const submit = joinPokerRoom.with(id);
  const submissions = useSubmissions(joinPokerRoom, ([roomId]) => roomId === id);
  const latest = () => submissions.at(-1);
  const [focusHeading, setFocusHeading] = createSignal(false);
  submit.onSubmit(() => setFocusHeading(true));

  onSettled(() => {
    let attempt = 0;
    function claimFromFragment() {
      const token = takeFacilitatorLinkToken(pokerRoomPath(id));
      if (token === null) return;

      const currentAttempt = ++attempt;
      setClaimPending(true);
      setClaimError('');
      void claimPokerFacilitatorLink(id, token).then(
        (result) => {
          if (result.ok) {
            if (attempt > 0) setClaimedRoom((room) => !room || result.value.version >= room.version ? result.value : room);
          } else if (attempt === currentAttempt) {
            setClaimError(result.message);
          }
        },
        () => {
          if (attempt === currentAttempt) {
            setClaimError('Could not claim Facilitator access. Open the Co-Facilitator Link to try again.');
          }
        },
      ).finally(() => {
        if (attempt === currentAttempt) setClaimPending(false);
      });
    }

    window.addEventListener('hashchange', claimFromFragment);
    claimFromFragment();
    return () => {
      attempt = 0;
      window.removeEventListener('hashchange', claimFromFragment);
    };
  });

  return (
    <Show when={room().viewer} fallback={
      <RoomNameForm
        heading="Join Pointing Poker"
        description={claimedRoom() ? 'Join the Room to finish claiming Facilitator access.' : undefined}
        submitLabel="Join Room"
        action={submit}
        pending={claimPending()}
        error={latest()?.result?.message ?? (latest()?.error ? 'Could not join the Room. Try again.' : claimError())}
      />
    }>
      <JoinedRoom room={room()} focusHeading={focusHeading()} claimError={claimError()} />
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
      <Show when={initialRoom()} fallback={<RoomUnavailable roomId={params.id} />}>
        {(room) => (
          <Show when={room().id} keyed>
            {(_id) => <RoomPage initialRoom={room()} />}
          </Show>
        )}
      </Show>
    </>
  );
}
