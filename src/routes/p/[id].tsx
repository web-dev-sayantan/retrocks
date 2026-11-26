import { Meta, Title } from '@solidjs/meta';
import { useParams, useSubmissions, type RouteDefinition } from '@solidjs/router';
import { Match, Show, Switch, createMemo, createSignal, untrack } from 'solid-js';

import PageMessage from '../../components/PageMessage';
import PokerRoomSummary from '../../components/poker/PokerRoomSummary';
import PokerWorkspace from '../../components/poker/PokerWorkspace';
import RoomNameForm from '../../components/poker/RoomNameForm';
import { changePokerRoom, getPokerRoom, joinPokerRoom } from '../../lib/poker-actions';
import { createPokerRoomController } from '../../lib/poker-controller';
import { pokerSetupPath } from '../../lib/poker-routes';
import { claimPokerFacilitatorLink } from '../../lib/poker-sharing-actions';
import type { PokerRoomView } from '../../lib/poker-types';

export const route = {
  preload: ({ params }) => {
    if (params.id) void getPokerRoom(params.id);
  },
} satisfies RouteDefinition;

function RoomUnavailable(props: { focusHeading?: boolean }) {
  return (
    <PageMessage
      title="Room unavailable"
      message="This link does not lead to an available Pointing Poker Room."
      focusHeading={props.focusHeading}
    >
      <a class="page-message-action" href={pokerSetupPath}>Create a Room</a>
    </PageMessage>
  );
}

function PokerRoomSessionPage(props: { roomId: string; initialRoom: PokerRoomView | null }) {
  const roomId = untrack(() => props.roomId);
  const session = createPokerRoomController({
    roomId,
    room: () => props.initialRoom,
    changeRoom: changePokerRoom,
    claimFacilitatorLink: claimPokerFacilitatorLink,
  });

  const submit = joinPokerRoom.with(roomId);
  const submissions = useSubmissions(joinPokerRoom, ([id]) => id === roomId);
  const latestJoin = () => submissions.at(-1);
  const [joinSubmitted, setJoinSubmitted] = createSignal(false);
  submit.onSubmit(() => setJoinSubmitted(true));

  const title = () => {
    const current = session.room();
    return current ? `${current.name} — Retrocks` : 'Pointing Poker Room — Retrocks';
  };

  return (
    <>
      <Title>{title()}</Title>
      <Switch fallback={<RoomUnavailable focusHeading={session.hasTransitionedPhase()} />}>
        <Match when={session.closedRoom()}>
          {(summary) => (
            <PokerRoomSummary
              room={summary()}
              reopening={session.phase() === 'reopening'}
              reopenError={session.reopenError()}
              focusHeading={session.hasTransitionedPhase()}
              onReopen={session.reopenRoom}
              onUnavailable={session.markUnavailable}
            />
          )}
        </Match>
        <Match when={session.liveRoom()}>
          {(room) => (
            <Show
              when={room().viewer}
              fallback={
                <RoomNameForm
                  heading={`Join ${room().name}`}
                  description={
                    session.hasPendingFacilitatorClaim()
                      ? 'Join the Room to finish claiming Facilitator access.'
                      : undefined
                  }
                  submitLabel="Join Room"
                  action={submit}
                  pending={session.claimPending()}
                  focusHeading={session.hasTransitionedPhase()}
                  error={
                    latestJoin()?.result?.message
                    ?? (latestJoin()?.error ? 'Could not join the Room. Try again.' : session.claimError())
                  }
                />
              }
            >
              <PokerWorkspace
                room={room()}
                online={session.online()}
                status={session.status()}
                busy={session.busy()}
                error={session.error()}
                focusHeading={joinSubmitted() || session.hasTransitionedPhase()}
                claimError={session.claimError()}
                onChange={session.changeRoom}
                onClearError={session.clearError}
                onUnavailable={session.markUnavailable}
              />
            </Show>
          )}
        </Match>
      </Switch>
    </>
  );
}

export default function PokerRoomRoute() {
  const params = useParams();
  const initialRoom = createMemo(() => getPokerRoom(params.id ?? ''));
  const loaded = createMemo(() => ({ room: initialRoom() }));

  return (
    <>
      <Title>Pointing Poker Room — Retrocks</Title>
      <Meta name="robots" content="noindex, nofollow" />
      <Show when={params.id} keyed fallback={<RoomUnavailable />}>
        {(roomId) => (
          <Show when={loaded()}>
            {(entry) => <PokerRoomSessionPage roomId={roomId} initialRoom={entry().room} />}
          </Show>
        )}
      </Show>
    </>
  );
}
