import { cleanup, render, screen, waitFor, within } from '@solidjs/testing-library';
import { createAgent } from '@ui-sdk/solid/agent';
import { createSignal, untrack } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';

import { createPokerRoomController } from '../../lib/poker-controller';
import {
  FIBONACCI_DECK,
  POKER_DECK_PRESETS,
  type PokerDeckCommand,
  type PokerLiveRoomView,
  type PokerResult,
  type PokerRoomChange,
} from '../../lib/poker-types';
import BoardConfirmDialog from '../BoardConfirmDialog';
import PokerDeckSettings from './PokerDeckSettings';
import PokerWorkspace from './PokerWorkspace';

const agent = createAgent();

afterEach(() => {
  cleanup();
});

test('Deck settings previews Fibonacci, T-shirt, and live-parsed Custom choices and explains active-round restart', async () => {
  const onChange = vi.fn(async (): Promise<PokerResult> => ({
    ok: true,
    room: {
      closed: false,
      id: 'room',
      name: 'Poker Room',
      version: 2,
      viewer: { id: 'alex', displayName: 'Alex', isFacilitator: true },
      participants: [],
      stories: [],
      activeStoryId: null,
      deck: POKER_DECK_PRESETS['t-shirt'],
      deckType: 't-shirt',
      round: null,
    },
  }));

  render(() => (
    <PokerDeckSettings
      deck={FIBONACCI_DECK}
      deckType="fibonacci"
      canManage
      onChange={onChange}
    />
  ));

  const opened = await agent.act({ steps: [{ ref: 'Deck settings', action: 'press' }] });
  expect(opened.ok, opened.error?.message).toBe(true);

  expect(
    await screen.findByText('Changing the Deck during a round with votes restarts voting. Existing estimates stay as they are.'),
  ).toBeVisible();
  const preview = screen.getByRole('status');
  expect(preview).toHaveTextContent('Fibonacci · 0, 1, 2, 3, 5, 8, 13, 21');

  const selectTshirt = await agent.act({
    steps: [{ ref: 'Deck preset', action: 'setValue', args: ['T-shirt'] }],
  });
  expect(selectTshirt.ok, selectTshirt.error?.message).toBe(true);
  expect(preview).toHaveTextContent('T-shirt · XS, S, M, L, XL');

  const selectFibonacci = await agent.act({
    steps: [{ ref: 'Deck preset', action: 'setValue', args: ['Fibonacci'] }],
  });
  expect(selectFibonacci.ok, selectFibonacci.error?.message).toBe(true);
  expect(preview).toHaveTextContent('Fibonacci · 0, 1, 2, 3, 5, 8, 13, 21');

  const selectCustom = await agent.act({
    steps: [{ ref: 'Deck preset', action: 'setValue', args: ['Custom'] }],
  });
  expect(selectCustom.ok, selectCustom.error?.message).toBe(true);
  expect(preview).toHaveTextContent('Custom · Enter at least two choices.');

  const oneChoice = await agent.act({
    steps: [{ ref: 'Custom choices', action: 'setValue', args: ['  Quick fix  \n   '] }],
  });
  expect(oneChoice.ok, oneChoice.error?.message).toBe(true);
  expect(preview).toHaveTextContent('Custom · Enter at least two choices.');

  const twoChoices = await agent.act({
    steps: [{ ref: 'Custom choices', action: 'setValue', args: ['  Quick fix  \n\nHalf day\nFull day\n'] }],
  });
  expect(twoChoices.ok, twoChoices.error?.message).toBe(true);
  expect(preview).toHaveTextContent('Custom · Quick fix, Half day, Full day');
});

test('changing the Deck while a Voting Round is open with no votes updates the open round choices immediately', async () => {
  const facilitator = { id: 'alex', displayName: 'Alex', isFacilitator: true };
  const [room, setRoom] = createSignal<PokerLiveRoomView>({
    closed: false,
    id: 'room',
    name: 'Poker Room',
    version: 1,
    viewer: facilitator,
    participants: [facilitator],
    stories: [{ id: 's1', title: 'Checkout flow', status: 'pending' }],
    activeStoryId: 's1',
    deck: FIBONACCI_DECK,
    deckType: 'fibonacci',
    round: { id: 'r1', phase: 'open', ownChoice: null, submittedParticipantIds: [] },
  });

  const change = vi.fn(async (command: PokerRoomChange): Promise<PokerResult> => {
    const current = untrack(room);
    if (command.type === 'set-deck') {
      const deckCommand = command as PokerDeckCommand;
      const nextDeck = deckCommand.deck.type === 'custom'
        ? deckCommand.deck.choices
        : POKER_DECK_PRESETS[deckCommand.deck.type];
      const next: PokerLiveRoomView = {
        ...current,
        version: current.version + 1,
        deckType: deckCommand.deck.type,
        deck: nextDeck,
      };
      setRoom(next);
      return { ok: true, room: next };
    }
    throw new Error(`Unexpected command: ${command.type}`);
  });

  render(() => (
    <PokerWorkspace
      room={room()}
      online={[facilitator.id]}
      status="live"
      onUnavailable={vi.fn()}
      onChange={change}
    />
  ));

  const active = screen.getByRole('region', { name: 'Active Story' });
  const getVoteGroup = () => within(active).getByRole('radiogroup', { name: 'Cast your vote' });
  expect(within(getVoteGroup()).getAllByRole('radio').map((el) => el.textContent)).toEqual([...FIBONACCI_DECK]);

  const saved = await agent.act({
    steps: [
      { ref: 'Deck settings', action: 'press' },
      { ref: 'Deck preset', action: 'setValue', args: ['T-shirt'] },
      { ref: 'Save Deck', action: 'press' },
    ],
  });
  expect(saved.ok, saved.error?.message).toBe(true);

  await waitFor(() => {
    expect(within(getVoteGroup()).getAllByRole('radio').map((el) => el.textContent)).toEqual([
      'XS', 'S', 'M', 'L', 'XL',
    ]);
  });
});

test('changing the Deck during a round with votes confirms before discarding ballots and restarting voting', async () => {
  const facilitator = { id: 'alex', displayName: 'Alex', isFacilitator: true };
  const [room, setRoom] = createSignal<PokerLiveRoomView>({
    closed: false,
    id: 'room',
    name: 'Poker Room',
    version: 1,
    viewer: facilitator,
    participants: [facilitator],
    stories: [{ id: 's1', title: 'Checkout flow', status: 'pending' }],
    activeStoryId: 's1',
    deck: FIBONACCI_DECK,
    deckType: 'fibonacci',
    round: { id: 'r1', phase: 'open', ownChoice: '5', submittedParticipantIds: [facilitator.id] },
  });

  const change = vi.fn(async (_id: string, command: PokerRoomChange): Promise<PokerResult> => {
    const current = untrack(room);
    if (command.type === 'set-deck') {
      const deckCommand = command as PokerDeckCommand;
      const nextDeck = deckCommand.deck.type === 'custom'
        ? deckCommand.deck.choices
        : POKER_DECK_PRESETS[deckCommand.deck.type];
      const next: PokerLiveRoomView = {
        ...current,
        version: current.version + 1,
        deckType: deckCommand.deck.type,
        deck: nextDeck,
        round: { id: 'r2', phase: 'open', ownChoice: null, submittedParticipantIds: [] },
      };
      setRoom(next);
      return { ok: true, room: next };
    }
    throw new Error(`Unexpected command: ${command.type}`);
  });

  render(() => {
    const session = createPokerRoomController({
      room,
      changeRoom: change,
      liveTransport: { connect: () => ({ ping() {}, close() {} }) },
    });
    return (
      <>
        <BoardConfirmDialog />
        <PokerWorkspace
          room={session.liveRoom()!}
          online={[facilitator.id]}
          status="live"
          busy={session.busy()}
          error={session.error()}
          onUnavailable={session.markUnavailable}
          onChange={session.changeRoom}
          onClearError={session.clearError}
        />
      </>
    );
  });

  const confirmAgent = createAgent({ allow: () => true });

  const cancelled = await confirmAgent.act({
    steps: [
      { ref: 'Deck settings', action: 'press' },
      { ref: 'Deck preset', action: 'setValue', args: ['T-shirt'] },
      { ref: 'Save Deck', action: 'press' },
      { ref: 'Change Deck and restart voting?', action: 'press', args: ['Keep current Deck'] },
    ],
  });
  expect(cancelled.ok, cancelled.error?.message).toBe(true);
  expect(change).not.toHaveBeenCalled();

  const confirmed = await confirmAgent.act({
    steps: [
      { ref: 'Save Deck', action: 'press' },
      { ref: 'Change Deck and restart voting?', action: 'press', args: ['Change Deck & restart'] },
    ],
  });
  expect(confirmed.ok, confirmed.error?.message).toBe(true);
  expect(change).toHaveBeenCalledWith('room', {
    type: 'set-deck',
    deck: { type: 't-shirt' },
    discardRoundId: 'r1',
  });

  const active = screen.getByRole('region', { name: 'Active Story' });
  const voteGroup = within(active).getByRole('radiogroup', { name: 'Cast your vote' });
  await waitFor(() => {
    expect(within(voteGroup).getAllByRole('radio').map((el) => el.textContent)).toEqual([
      'XS', 'S', 'M', 'L', 'XL',
    ]);
  });
});

test('non-Facilitator Participants see a read-only Deck chip without a lock indicator', () => {
  render(() => (
    <PokerDeckSettings
      deck={FIBONACCI_DECK}
      deckType="fibonacci"
      canManage={false}
      onChange={vi.fn()}
    />
  ));

  expect(screen.queryByRole('button', { name: 'Deck settings' })).toBeNull();
  const chip = screen.getByRole('status');
  expect(chip).toHaveTextContent('Fibonacci');
  expect(chip).not.toHaveTextContent(/locked/i);
});

test('changing Deck between Fibonacci and T-shirt through createPokerRoomController with an open round succeeds', async () => {
  const facilitator = { id: 'alex', displayName: 'Alex', isFacilitator: true };
  let serverState: PokerLiveRoomView = {
    closed: false,
    id: 'room_12345678901234567',
    name: 'Poker Room',
    version: 1,
    viewer: facilitator,
    participants: [facilitator],
    stories: [{ id: 'story_1_12345678901234', title: 'Checkout flow', status: 'pending' }],
    activeStoryId: 'story_1_12345678901234',
    deck: [...FIBONACCI_DECK],
    deckType: 'fibonacci',
    round: { id: 'round_1_12345678901234', phase: 'open', ownChoice: null, submittedParticipantIds: [] },
  };

  let finishRestart!: () => void;
  const restartPending = new Promise<void>((resolve) => { finishRestart = resolve; });
  const changeRoom = vi.fn(async (_id: string, command: PokerRoomChange): Promise<PokerResult> => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (command.type === 'vote') {
      serverState = {
        ...serverState,
        version: serverState.version + 1,
        round: {
          id: command.roundId,
          phase: 'open',
          ownChoice: command.choice,
          submittedParticipantIds: command.choice ? [facilitator.id] : [],
        },
      };
      return { ok: true, room: serverState };
    }
    if (command.type === 'set-deck') {
      if (command.discardRoundId) await restartPending;
      const nextDeck = command.deck.type === 'custom'
        ? command.deck.choices
        : [...POKER_DECK_PRESETS[command.deck.type]];
      serverState = {
        ...serverState,
        version: serverState.version + 1,
        deckType: command.deck.type,
        deck: nextDeck,
        round: command.discardRoundId
          ? { id: `round_${serverState.version + 1}_1234567890123`, phase: 'open', ownChoice: null, submittedParticipantIds: [] }
          : serverState.round,
      };
      return { ok: true, room: serverState };
    }
    throw new Error(`Unexpected command: ${command.type}`);
  });

  render(() => {
    const controller = createPokerRoomController({
      room: () => serverState,
      changeRoom,
      liveTransport: {
        connect: () => ({ ping() {}, close() {} }),
      },
    });
    return (
      <>
        <BoardConfirmDialog />
        <PokerWorkspace
          room={controller.room() as PokerLiveRoomView}
          online={[facilitator.id]}
          status="live"
          busy={controller.busy()}
          error={controller.error()}
          onUnavailable={controller.markUnavailable}
          onChange={controller.changeRoom}
          onClearError={controller.clearError}
        />
      </>
    );
  });

  const active = screen.getByRole('region', { name: 'Active Story' });
  const getVoteGroup = () => within(active).getByRole('radiogroup', { name: 'Cast your vote' });
  expect(within(getVoteGroup()).getAllByRole('radio').map((el) => el.textContent)).toEqual([...FIBONACCI_DECK]);

  const toTshirt = await agent.act({
    steps: [
      { ref: 'Deck settings', action: 'press' },
      { ref: 'Deck preset', action: 'setValue', args: ['T-shirt'] },
      { ref: 'Save Deck', action: 'press' },
    ],
  });
  expect(toTshirt.ok, toTshirt.error?.message).toBe(true);
  await waitFor(() => {
    expect(within(getVoteGroup()).getAllByRole('radio').map((el) => el.textContent)).toEqual([
      'XS', 'S', 'M', 'L', 'XL',
    ]);
  });

  const confirmAgent = createAgent({ allow: () => true });
  const voteAndSwitch = await confirmAgent.act({
    steps: [
      { ref: 'Cast your vote', action: 'setValue', args: ['M'] },
      { ref: 'Deck settings', action: 'press' },
      { ref: 'Deck preset', action: 'setValue', args: ['Fibonacci'] },
      { ref: 'Save Deck', action: 'press' },
      { ref: 'Change Deck and restart voting?', action: 'press', args: ['Change Deck & restart'] },
    ],
  });
  expect(voteAndSwitch.ok, voteAndSwitch.error?.message).toBe(true);
  try {
    await waitFor(() => {
      expect(changeRoom).toHaveBeenLastCalledWith(serverState.id, expect.objectContaining({
        type: 'set-deck',
        discardRoundId: 'round_1_12345678901234',
      }));
      expect(within(active).queryByRole('radiogroup', { name: 'Cast your vote' })).toBeNull();
    });
  } finally {
    finishRestart();
  }
  await waitFor(() => {
    expect(within(getVoteGroup()).getAllByRole('radio').map((el) => el.textContent)).toEqual([...FIBONACCI_DECK]);
  });

  const vote = await confirmAgent.act({
    steps: [{ ref: 'Cast your vote', action: 'setValue', args: ['5'] }],
  });
  expect(vote.ok, vote.error?.message).toBe(true);
  expect(changeRoom).toHaveBeenLastCalledWith(serverState.id, {
    type: 'vote', roundId: 'round_4_1234567890123', choice: '5',
  });
});
