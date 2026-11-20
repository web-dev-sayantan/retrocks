import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { createAgent } from '@ui-sdk/solid/agent';
import { createSignal } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';

import { FIBONACCI_DECK, type PokerResult, type PokerRoomView, type PokerStory, type PokerStoryCommand } from '../../lib/poker-types';
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
    deck: FIBONACCI_DECK, round: null,
  };

  async function change(command: PokerStoryCommand): Promise<PokerResult> {
    let next = stories();
    if (command.type === 'add-story' && command.title === second.title) next = [first, second];
    if (command.type === 'move-story' && command.storyId === second.id && command.targetId === first.id
      && command.placement === 'before') next = [{ ...second }, { ...first }];
    setStories(next);
    return { ok: true, room: { ...room, stories: next } };
  }
  render(() => <PokerStoryQueue stories={stories()} activeStoryId={null} canManage onChange={change} />);

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
