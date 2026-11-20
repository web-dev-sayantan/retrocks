import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { createAgent } from '@ui-sdk/solid/agent';
import { createSignal, untrack } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';

import { FIBONACCI_DECK, type PokerResult, type PokerRoomChange, type PokerRoomView, type PokerStory, type PokerStoryCommand } from '../../lib/poker-types';
import BoardConfirmDialog from '../BoardConfirmDialog';
import PokerStoryQueue from './PokerStoryQueue';
import PokerWorkspace from './PokerWorkspace';

const agent = createAgent();
afterEach(cleanup);

test('a Facilitator can add and move a Story by named controls while keeping its row and focus', async () => {
  const first = { id: 'first', title: 'Save checkout', status: 'pending' } satisfies PokerStory;
  const second = { id: 'second', title: 'Pay with gift card', status: 'pending' } satisfies PokerStory;
  const [stories, setStories] = createSignal([first]);
  const room: PokerRoomView = {
    id: 'room', version: 1, viewer: null, participants: [], stories: [], activeStoryId: null,
    deck: FIBONACCI_DECK, deckType: 'fibonacci', deckLocked: false, round: null,
  };

  async function change(command: PokerStoryCommand): Promise<PokerResult> {
    let next = stories();
    if (command.type === 'add-story' && command.title === second.title) next = [first, second];
    if (command.type === 'move-story' && command.storyId === second.id && command.targetId === first.id
      && command.placement === 'before') next = [{ ...second }, { ...first }];
    setStories(next);
    return { ok: true, room: { ...room, stories: next } };
  }
  render(() => <PokerStoryQueue stories={stories()} activeStoryId={null} deck={FIBONACCI_DECK} canManage onChange={change} />);

  const controls = agent.snapshot().filter((entry) => !entry.offPage && entry.component !== 'more');
  expect(controls.every((entry) => Boolean(entry.label))).toBe(true);

  const added = await agent.act({ steps: [
    { ref: 'Story title', action: 'setValue', args: [second.title] },
    { ref: 'Add Story', action: 'press' },
  ] });
  expect(added.ok, added.error?.message).toBe(true);
  await screen.findByText(second.title);

  const queue = screen.getByRole('list', { name: 'Story queue' });
  const row = within(queue).getAllByRole('listitem')[1];
  const moveUp = within(row).getByRole('button', { name: 'Move Pay with gift card up' });
  moveUp.focus();
  fireEvent.click(moveUp);

  await waitFor(() => expect(within(queue).getAllByRole('listitem')[0]).toBe(row));
  expect(moveUp).toHaveFocus();
  await waitFor(() => expect(screen.getByRole('status'))
    .toHaveTextContent('Pay with gift card moved to position 1 of 2.'));
});

test('a Participant can read Story statuses and the active Story without queue controls', () => {
  const pending = { id: 'pending', title: 'Restore cart', status: 'pending' } as const;
  const room: PokerRoomView = {
    id: 'room',
    version: 2,
    viewer: { id: 'sam', displayName: 'Sam', isFacilitator: false },
    participants: [],
    activeStoryId: pending.id,
    deck: FIBONACCI_DECK,
    deckType: 'fibonacci',
    deckLocked: false,
    round: null,
    stories: [
      pending,
      { id: 'estimated', title: 'Update billing', status: 'estimated', acceptedEstimate: '5' },
      { id: 'skipped', title: 'Send receipt', status: 'skipped' },
    ],
  };
  render(() => (
    <PokerWorkspace room={room} online={[]} status="live" onChange={() => {
      throw new Error('A Participant should have no Story mutation controls.');
    }} />
  ));

  const active = screen.getByRole('region', { name: 'Active Story' });
  expect(within(active).getByText('Restore cart')).toBeVisible();
  const queue = screen.getByRole('list', { name: 'Story queue' });
  const items = within(queue).getAllByRole('listitem');
  expect(items.map((item) => item.textContent)).toEqual([
    'Restore cartPending',
    'Update billingEstimated · 5',
    'Send receiptSkipped',
  ]);
  expect(items[0]).toHaveAttribute('aria-current', 'true');
  expect(within(screen.getByRole('region', { name: 'Story queue' })).queryByRole('button')).toBeNull();
});

test('A Facilitator can stay with the current Voting Round or confirm picking a different Story', async () => {
  const current = { id: 'checkout', title: 'Save checkout', status: 'pending' } as const;
  const target = { id: 'receipt', title: 'Send receipt', status: 'pending' } as const;
  const facilitator = { id: 'alex', displayName: 'Alex', isFacilitator: true };
  const room: PokerRoomView = {
    id: 'room',
    version: 1,
    viewer: facilitator,
    participants: [facilitator],
    stories: [current, target],
    activeStoryId: current.id,
    deck: FIBONACCI_DECK,
    deckType: 'fibonacci',
    deckLocked: true,
    round: { id: 'checkout-round', phase: 'open', submittedParticipantIds: [], ownChoice: null },
  };
  const change = vi.fn(async (): Promise<PokerResult> => ({ ok: true, room }));
  render(() => (
    <>
      <PokerWorkspace room={room} online={[]} status="live" onChange={change} />
      <BoardConfirmDialog />
    </>
  ));

  const select = screen.getByRole('button', { name: 'Select Send receipt' });
  fireEvent.click(select);
  const dialog = await screen.findByRole('alertdialog', { name: 'Switch Stories?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Stay with this Story' }));
  await waitFor(() => expect(dialog).not.toBeVisible());
  expect(change).not.toHaveBeenCalled();

  fireEvent.click(select);
  const reopened = await screen.findByRole('alertdialog', { name: 'Switch Stories?' });
  fireEvent.click(within(reopened).getByRole('button', { name: 'Switch Story' }));
  await waitFor(() => expect(change).toHaveBeenCalledWith({
    type: 'select-story', storyId: target.id, discardRoundId: 'checkout-round',
  }));
});

test('a Facilitator chooses an Accepted Estimate explicitly, then corrects it from the Story queue', async () => {
  const facilitator = { id: 'alex', displayName: 'Alex', isFacilitator: true };
  const current = { id: 'checkout', title: 'Save checkout', status: 'pending' } as const;
  const [room, setRoom] = createSignal<PokerRoomView>({
    id: 'room', version: 1, viewer: facilitator, participants: [facilitator], stories: [current],
    activeStoryId: current.id, deck: FIBONACCI_DECK,
    deckType: 'fibonacci',
    deckLocked: true,
    round: { id: 'round', phase: 'revealed', ballots: [{ participantId: 'alex', displayName: 'Alex', choice: '5' }] },
  });
  const change = vi.fn(async (command: PokerRoomChange): Promise<PokerResult> => {
    const r = untrack(room);
    if (command.type === 'confirm-estimate' && r.round?.phase === 'revealed') {
      const next: PokerRoomView = {
        ...r, version: 2, round: { ...r.round, phase: 'accepted' },
        stories: [{ ...current, status: 'estimated', acceptedEstimate: command.choice }],
      };
      setRoom(next);
      return { ok: true, room: next };
    }
    if (command.type === 'correct-estimate') {
      const next: PokerRoomView = {
        ...r, version: 3,
        stories: [{ ...r.stories[0], acceptedEstimate: command.choice }],
      };
      setRoom(next);
      return { ok: true, room: next };
    }
    throw new Error('Unexpected Room command.');
  });

  render(() => <PokerWorkspace room={room()} online={[]} status="live" onChange={change} />);
  const active = screen.getByRole('region', { name: 'Active Story' });
  const estimate = within(active).getByRole('radiogroup', { name: 'Accepted Estimate' });
  expect(within(estimate).queryByRole('radio', { checked: true })).toBeNull();
  expect(agent.snapshot().filter((entry) => !entry.offPage && entry.component !== 'more').every((entry) => entry.label)).toBe(true);
  const confirm = within(active).getByRole('button', { name: 'Confirm estimate' });
  fireEvent.click(confirm);
  expect(change).not.toHaveBeenCalled();

  const zero = within(estimate).getByRole('radio', { name: '0' });
  zero.focus();
  fireEvent.keyDown(zero, { key: 'ArrowRight' });
  await waitFor(() => expect(within(estimate).getByRole('radio', { name: '1' })).toHaveAttribute('aria-checked', 'true'));
  expect(change).not.toHaveBeenCalled();
  const confirmed = await agent.act({ steps: [{ ref: 'Confirm estimate', action: 'press' }] });
  expect(confirmed.ok, confirmed.error?.message).toBe(true);
  await waitFor(() => expect(change).toHaveBeenLastCalledWith({ type: 'confirm-estimate', roundId: 'round', choice: '1' }));

  const edit = await agent.act({ steps: [{ ref: 'Edit estimate for Save checkout', action: 'press' }] });
  expect(edit.ok, edit.error?.message).toBe(true);
  const correcting = await screen.findByRole('radiogroup', { name: 'Correct Accepted Estimate' });
  expect(within(correcting).getByRole('radio', { name: '1' })).toHaveFocus();
  fireEvent.click(within(correcting).getByRole('radio', { name: '0' }));
  const saved = await agent.act({ steps: [{ ref: 'Save estimate', action: 'press' }] });
  expect(saved.ok, saved.error?.message).toBe(true);
  await waitFor(() => expect(change).toHaveBeenLastCalledWith({
    type: 'correct-estimate', storyId: current.id, expectedEstimate: '1', choice: '0',
  }));
  expect(await screen.findByText('Estimated · 0')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Edit estimate for Save checkout' })).toHaveFocus();
});

test('a Facilitator can save an ordered custom Deck through the labeled settings', async () => {
  const facilitator = { id: 'alex', displayName: 'Alex', isFacilitator: true };
  const [room, setRoom] = createSignal<PokerRoomView>({
    id: 'room', version: 1, viewer: facilitator, participants: [], stories: [], activeStoryId: null,
    deck: FIBONACCI_DECK, deckType: 'fibonacci', deckLocked: false, round: null,
  });
  const change = vi.fn(async (): Promise<PokerResult> => {
    const next = { ...untrack(room), deck: ['Under an hour', '0'], deckType: 'custom' as const };
    setRoom(next);
    return { ok: true, room: next };
  });
  render(() => <PokerWorkspace room={room()} online={[]} status="live" onChange={change} />);

  const settings = screen.getByRole('form', { name: 'Deck settings' });
  fireEvent.click(within(settings).getByRole('radio', { name: 'Custom' }));
  const choices = await within(settings).findByRole('textbox', { name: 'Custom choices' });
  expect(choices).toHaveAccessibleDescription('Enter one choice per line, in the order they should appear.');
  expect(within(settings).getByRole('button', { name: 'Save Deck' })).toBeEnabled();
  const entered = await agent.act({ steps: [
    { ref: 'Custom choices', action: 'setValue', args: ['Under an hour\n0'] },
    { ref: 'Save Deck', action: 'press' },
  ] });
  expect(entered.ok, entered.error?.message).toBe(true);
  expect(change).toHaveBeenCalledWith({ type: 'set-deck', deck: { type: 'custom', choices: ['Under an hour', '0'] } });
  expect(await screen.findByText('Under an hour, 0')).toBeVisible();

  setRoom((current) => ({ ...current, deckLocked: true }));
  await waitFor(() => expect(settings).not.toBeInTheDocument());
  expect(screen.getByText('The Deck is locked.')).toBeVisible();
});
