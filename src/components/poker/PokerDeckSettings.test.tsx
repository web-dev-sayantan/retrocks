import { cleanup, render, screen, waitFor, within } from '@solidjs/testing-library';
import { createAgent } from '@ui-sdk/solid/agent';
import { createSignal, untrack } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';

import {
  FIBONACCI_DECK,
  POKER_DECK_PRESETS,
  type PokerDeckCommand,
  type PokerLiveRoomView,
  type PokerResult,
  type PokerRoomChange,
} from '../../lib/poker-types';
import PokerDeckSettings from './PokerDeckSettings';
import PokerWorkspace from './PokerWorkspace';

const agent = createAgent();

afterEach(() => {
  cleanup();
});

test('Deck settings previews Fibonacci, T-shirt, and live-parsed Custom choices and explains first-vote lock', async () => {
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
      deckLocked: false,
      round: null,
    },
  }));

  render(() => (
    <PokerDeckSettings
      deck={FIBONACCI_DECK}
      deckType="fibonacci"
      locked={false}
      canManage
      onChange={onChange}
    />
  ));

  const opened = await agent.act({ steps: [{ ref: 'Deck settings', action: 'press' }] });
  expect(opened.ok, opened.error?.message).toBe(true);

  expect(await screen.findByText('The Deck locks once the first vote is cast.')).toBeVisible();
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
    deckLocked: false,
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
  const voteGroup = within(active).getByRole('radiogroup', { name: 'Cast your vote' });
  expect(within(voteGroup).getAllByRole('radio').map((el) => el.textContent)).toEqual([...FIBONACCI_DECK]);

  const saved = await agent.act({
    steps: [
      { ref: 'Deck settings', action: 'press' },
      { ref: 'Deck preset', action: 'setValue', args: ['T-shirt'] },
      { ref: 'Save Deck', action: 'press' },
    ],
  });
  expect(saved.ok, saved.error?.message).toBe(true);

  await waitFor(() => {
    expect(within(voteGroup).getAllByRole('radio').map((el) => el.textContent)).toEqual([
      'XS', 'S', 'M', 'L', 'XL',
    ]);
  });
});
