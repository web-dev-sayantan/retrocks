import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { createSignal, flush } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';

import { createPokerRoomController } from '../../lib/poker-controller';
import { FIBONACCI_DECK, type PokerLiveRoomView, type PokerResult, type PokerRoomChange } from '../../lib/poker-types';
import BoardConfirmDialog from '../BoardConfirmDialog';
import PokerWorkspace from './PokerWorkspace';

afterEach(() => {
  cleanup();
});

const alex = { id: 'alex', displayName: 'Alex', isFacilitator: true };
const priya = { id: 'priya', displayName: 'Priya', isFacilitator: false };

function makeRoom(overrides: Partial<PokerLiveRoomView> = {}): PokerLiveRoomView {
  return {
    closed: false,
    id: 'room',
    name: 'Poker Room',
    version: 1,
    viewer: alex,
    participants: [alex, priya],
    stories: [{ id: 's1', title: 'Add webhook retries', status: 'pending' }],
    activeStoryId: 's1',
    deck: FIBONACCI_DECK,
    deckType: 'fibonacci',
    round: { id: 'r1', phase: 'open', submittedParticipantIds: [], ownChoice: null },
    ...overrides,
  };
}

test('top bar shows a compact online pill with a users icon, numeric count, and accessible status text', () => {
  const [status, setStatus] = createSignal<'connecting' | 'live' | 'reconnecting'>('live');
  const [online, setOnline] = createSignal<string[]>(['alex', 'priya']);

  render(() => (
    <PokerWorkspace
      room={makeRoom()}
      online={online()}
      status={status()}
      onUnavailable={vi.fn()}
      onChange={vi.fn()}
    />
  ));

  const header = screen.getByRole('banner');
  const pill = header.querySelector('.poker-online-pill');
  expect(pill).not.toBeNull();
  expect(pill).toHaveAttribute('aria-live', 'polite');
  expect(pill).toHaveAttribute('data-state', 'online');
  expect(pill).toHaveAttribute('title', '2 online');

  expect(pill?.querySelector('.poker-presence-dot')).toBeNull();
  const icon = pill?.querySelector('svg.poker-online-icon');
  expect(icon).not.toBeNull();
  expect(icon).toHaveAttribute('aria-hidden', 'true');

  expect(within(pill as HTMLElement).getByText('2')).toHaveAttribute('aria-hidden', 'true');
  expect(within(pill as HTMLElement).getByText('2 online')).toHaveClass('sr-only');

  setStatus('reconnecting');
  flush();
  expect(pill).toHaveAttribute('data-state', 'reconnecting');
  expect(pill).toHaveAttribute('title', 'Connecting to Room…');
  expect(within(pill as HTMLElement).getByText('Connecting to Room…')).toHaveClass('sr-only');

  setStatus('connecting');
  setOnline([]);
  flush();
  expect(pill).toHaveAttribute('data-state', 'reconnecting');
  expect(within(pill as HTMLElement).getByText('0')).toHaveAttribute('aria-hidden', 'true');
  expect(within(pill as HTMLElement).getByText('Connecting to Room…')).toHaveClass('sr-only');
});

test('marks the current Participant seat and card with data-self across waiting and voted states', () => {
  const [room, setRoom] = createSignal(makeRoom({
    round: { id: 'r1', phase: 'open', submittedParticipantIds: [], ownChoice: null },
  }));

  render(() => (
    <PokerWorkspace
      room={room()}
      online={['alex', 'priya']}
      status="live"
      onUnavailable={vi.fn()}
      onChange={vi.fn()}
    />
  ));

  const seats = within(screen.getByRole('list', { name: 'Participants' })).getAllByRole('listitem');
  const [selfSeat, otherSeat] = seats;

  expect(selfSeat).toHaveAttribute('data-self', 'true');
  expect(selfSeat.querySelector('.poker-seat-card')).toHaveAttribute('data-seat-state', 'waiting');
  expect(selfSeat.querySelector('.poker-seat-card')).toHaveAttribute('data-self', 'true');
  expect(selfSeat.querySelector('.poker-seat-name')).toHaveTextContent('Alex (you)');

  expect(otherSeat).not.toHaveAttribute('data-self');
  expect(otherSeat.querySelector('.poker-seat-card')).toHaveAttribute('data-seat-state', 'waiting');
  expect(otherSeat.querySelector('.poker-seat-card')).not.toHaveAttribute('data-self');
  expect(otherSeat.querySelector('.poker-seat-name')).toHaveTextContent('Priya');

  setRoom(makeRoom({
    version: 2,
    round: { id: 'r1', phase: 'open', submittedParticipantIds: ['alex', 'priya'], ownChoice: '5' },
  }));
  flush();

  expect(selfSeat).toHaveAttribute('data-self', 'true');
  expect(selfSeat.querySelector('.poker-seat-card')).toHaveAttribute('data-seat-state', 'voted');
  expect(selfSeat.querySelector('.poker-seat-card')).toHaveAttribute('data-self', 'true');

  expect(otherSeat).not.toHaveAttribute('data-self');
  expect(otherSeat.querySelector('.poker-seat-card')).toHaveAttribute('data-seat-state', 'voted');
  expect(otherSeat.querySelector('.poker-seat-card')).not.toHaveAttribute('data-self');
});

test('displays (you) and data-self on the current Participant revealed ballot while preserving consensus highlights', () => {
  const maya = { id: 'maya', displayName: 'Maya', isFacilitator: false };
  const room = makeRoom({
    participants: [alex, priya, maya],
    round: {
      id: 'r1',
      phase: 'revealed',
      ballots: [
        { participantId: 'alex', displayName: 'Alex', choice: '5' },
        { participantId: 'priya', displayName: 'Priya', choice: '5' },
        { participantId: 'maya', displayName: 'Maya', choice: '8' },
      ],
    },
  });

  render(() => (
    <PokerWorkspace
      room={room}
      online={['alex', 'priya', 'maya']}
      status="live"
      onUnavailable={vi.fn()}
      onChange={vi.fn()}
    />
  ));

  const ballots = within(screen.getByRole('list', { name: 'Revealed votes' })).getAllByRole('listitem');
  const [alexBallot, priyaBallot, mayaBallot] = ballots;

  expect(alexBallot).toHaveAttribute('data-self', 'true');
  expect(alexBallot.querySelector('.poker-seat-name')).toHaveTextContent('Alex (you)');
  expect(alexBallot.querySelector('.poker-seat-card')).toHaveAttribute('data-seat-state', 'revealed');
  expect(alexBallot.querySelector('.poker-seat-card')).toHaveAttribute('data-self', 'true');
  expect(alexBallot.querySelector('.poker-seat-card')).toHaveAttribute('data-consensus', 'true');

  expect(priyaBallot).not.toHaveAttribute('data-self');
  expect(priyaBallot.querySelector('.poker-seat-name')).toHaveTextContent('Priya');
  expect(priyaBallot.querySelector('.poker-seat-name')).not.toHaveTextContent('(you)');
  expect(priyaBallot.querySelector('.poker-seat-card')).toHaveAttribute('data-seat-state', 'revealed');
  expect(priyaBallot.querySelector('.poker-seat-card')).not.toHaveAttribute('data-self');
  expect(priyaBallot.querySelector('.poker-seat-card')).toHaveAttribute('data-consensus', 'true');

  expect(mayaBallot).not.toHaveAttribute('data-self');
  expect(mayaBallot.querySelector('.poker-seat-name')).toHaveTextContent('Maya');
  expect(mayaBallot.querySelector('.poker-seat-card')).not.toHaveAttribute('data-self');
  expect(mayaBallot.querySelector('.poker-seat-card')).not.toHaveAttribute('data-consensus');
});

test('serializes concurrent Facilitator actions across workspace panels and surfaces shared session busy and error state', async () => {
  const initial = makeRoom({
    stories: [
      { id: 's1', title: 'Add webhook retries', status: 'pending' },
      { id: 's2', title: 'Audit webhook payloads', status: 'pending' },
    ],
    activeStoryId: 's1',
    round: { id: 'r1', phase: 'open', submittedParticipantIds: ['alex'], ownChoice: '5' },
  });
  const pending = Promise.withResolvers<PokerResult>();
  const changeRoom = vi.fn<(_id: string, command: PokerRoomChange) => Promise<PokerResult>>()
    .mockReturnValueOnce(pending.promise);

  render(() => {
    const session = createPokerRoomController({
      room: () => initial,
      changeRoom,
      liveTransport: { connect: () => ({ ping() {}, close() {} }) },
    });
    return (
      <>
        <PokerWorkspace
          room={session.liveRoom()!}
          online={['alex', 'priya']}
          status="live"
          busy={session.busy()}
          error={session.error()}
          onUnavailable={session.markUnavailable}
          onChange={session.changeRoom}
          onClearError={session.clearError}
        />
        <BoardConfirmDialog />
      </>
    );
  });

  // Start a Voting Round reveal mutation.
  const revealButton = screen.getByRole('button', { name: 'Reveal votes' });
  fireEvent.click(revealButton);
  flush();

  expect(changeRoom).toHaveBeenCalledTimes(1);
  expect(changeRoom).toHaveBeenCalledWith('room', { type: 'reveal', roundId: 'r1' });

  // Controls across distinct panels reflect the shared session busy state and drop concurrent clicks.
  const closeButton = screen.getByRole('button', { name: 'Close Room' });
  const moveDownButton = screen.getByRole('button', { name: 'Move Add webhook retries down' });
  expect(revealButton).toHaveAttribute('aria-disabled', 'true');
  expect(closeButton).toHaveAttribute('aria-disabled', 'true');
  expect(moveDownButton).toHaveAttribute('aria-disabled', 'true');

  fireEvent.click(closeButton);
  fireEvent.click(moveDownButton);
  flush();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(changeRoom).toHaveBeenCalledTimes(1);

  // Server rejection clears busy across all panels and surfaces the shared error banner.
  pending.resolve({ ok: false, code: 'ROUND_CHANGED', message: 'The Voting Round has changed.' });
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The Voting Round has changed.'));
  expect(revealButton).not.toHaveAttribute('aria-disabled', 'true');
  expect(closeButton).not.toHaveAttribute('aria-disabled', 'true');
  expect(moveDownButton).not.toHaveAttribute('aria-disabled', 'true');
});

test('rolls back optimistic active Story title restart when stale confirmation is rejected', async () => {
  const initial = makeRoom({
    stories: [{ id: 's1', title: 'Add webhook retries', status: 'pending' }],
    activeStoryId: 's1',
    round: { id: 'r1', phase: 'open', submittedParticipantIds: ['alex'], ownChoice: '5' },
  });
  const pending = Promise.withResolvers<PokerResult>();
  const changeRoom = vi.fn<(_id: string, command: PokerRoomChange) => Promise<PokerResult>>()
    .mockReturnValueOnce(pending.promise);

  render(() => {
    const session = createPokerRoomController({
      room: () => initial,
      changeRoom,
      liveTransport: { connect: () => ({ ping() {}, close() {} }) },
    });
    return (
      <>
        <PokerWorkspace
          room={session.liveRoom()!}
          online={['alex', 'priya']}
          status="live"
          busy={session.busy()}
          error={session.error()}
          onUnavailable={session.markUnavailable}
          onChange={session.changeRoom}
          onClearError={session.clearError}
        />
        <BoardConfirmDialog />
      </>
    );
  });

  const stage = screen.getByRole('region', { name: 'Active Story' });
  fireEvent.dblClick(within(stage).getByText('Add webhook retries'));
  const input = await within(stage).findByRole('textbox', { name: 'Edit Story title' });
  fireEvent.input(input, { target: { value: 'Add webhook backoff' } });
  fireEvent.keyDown(input, { key: 'Enter' });

  const dialog = await screen.findByRole('alertdialog', { name: 'Change active Story title?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save and restart voting' }));

  await waitFor(() => {
    expect(changeRoom).toHaveBeenCalledWith('room', {
      type: 'edit-story',
      storyId: 's1',
      title: 'Add webhook backoff',
      discardRoundId: 'r1',
    });
    // Optimistic restart safety: superseded round controls are hidden while pending.
    expect(within(stage).queryByRole('radiogroup', { name: 'Cast your vote' })).toBeNull();
  });

  pending.resolve({ ok: false, code: 'ROUND_CHANGED', message: 'The Voting Round has changed.' });
  await waitFor(() => {
    expect(within(stage).getByRole('radiogroup', { name: 'Cast your vote' })).toBeVisible();
  });
  expect(await within(stage).findByRole('alert')).toHaveTextContent('The Voting Round has changed.');
});
