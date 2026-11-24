import { cleanup, render, screen, within } from '@solidjs/testing-library';
import { createSignal, flush } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';

import { FIBONACCI_DECK, type PokerLiveRoomView } from '../../lib/poker-types';
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
    deckLocked: true,
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
