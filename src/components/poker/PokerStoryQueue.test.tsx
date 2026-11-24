import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { createAgent } from '@ui-sdk/solid/agent';
import { createSignal, untrack } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';

import { FIBONACCI_DECK, type PokerResult, type PokerRoomChange, type PokerLiveRoomView, type PokerStory, type PokerStoryCommand } from '../../lib/poker-types';
import BoardConfirmDialog from '../BoardConfirmDialog';
import PokerStoryQueue from './PokerStoryQueue';
import PokerWorkspace from './PokerWorkspace';

let approve = false;
const allow = vi.fn((step: { confirm?: string }) => !step.confirm || approve);
const agent = createAgent({ allow });
afterEach(() => {
  cleanup();
  allow.mockClear();
  approve = false;
});

test('a Facilitator can add and move a Story by named controls while keeping its row and focus', async () => {
  const first = { id: 'first', title: 'Save checkout', status: 'pending' } satisfies PokerStory;
  const second = { id: 'second', title: 'Pay with gift card', status: 'pending' } satisfies PokerStory;
  const [stories, setStories] = createSignal([first]);
  const room: PokerLiveRoomView = {
    closed: false, id: 'room', version: 1, viewer: null, participants: [], stories: [], activeStoryId: null,
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
  const room: PokerLiveRoomView = {
    closed: false, id: 'room',
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
    <PokerWorkspace room={room} online={[]} status="live" onUnavailable={vi.fn()} onChange={() => {
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
  const room: PokerLiveRoomView = {
    closed: false, id: 'room',
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
      <PokerWorkspace room={room} online={[]} status="live" onUnavailable={vi.fn()} onChange={change} />
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
  const [room, setRoom] = createSignal<PokerLiveRoomView>({
    closed: false, id: 'room', version: 1, viewer: facilitator, participants: [facilitator], stories: [current],
    activeStoryId: current.id, deck: FIBONACCI_DECK,
    deckType: 'fibonacci',
    deckLocked: true,
    round: { id: 'round', phase: 'revealed', ballots: [{ participantId: 'alex', displayName: 'Alex', choice: '5' }] },
  });
  const change = vi.fn(async (command: PokerRoomChange): Promise<PokerResult> => {
    const r = untrack(room);
    if (command.type === 'confirm-estimate' && r.round?.phase === 'revealed') {
      const next: PokerLiveRoomView = {
        ...r, version: 2, round: { ...r.round, phase: 'accepted' },
        stories: [{ ...current, status: 'estimated', acceptedEstimate: command.choice }],
      };
      setRoom(next);
      return { ok: true, room: next };
    }
    if (command.type === 'correct-estimate') {
      const next: PokerLiveRoomView = {
        ...r, version: 3,
        stories: [{ ...r.stories[0], acceptedEstimate: command.choice }],
      };
      setRoom(next);
      return { ok: true, room: next };
    }
    throw new Error('Unexpected Room command.');
  });

  render(() => <PokerWorkspace room={room()} online={[]} status="live" onUnavailable={vi.fn()} onChange={change} />);
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
  const confirmed = await agent.act({ steps: [
    { ref: 'Accepted Estimate', action: 'setValue', args: ['2'] },
    { ref: 'Confirm estimate', action: 'press' },
  ] });
  expect(confirmed.ok, confirmed.error?.message).toBe(true);
  await waitFor(() => expect(change).toHaveBeenLastCalledWith({ type: 'confirm-estimate', roundId: 'round', choice: '2' }));

  const edit = await agent.act({ steps: [{ ref: 'Edit estimate for Save checkout', action: 'press' }] });
  expect(edit.ok, edit.error?.message).toBe(true);
  const correcting = await screen.findByRole('radiogroup', { name: 'Correct Accepted Estimate' });
  expect(within(correcting).getByRole('radio', { name: '2' })).toHaveFocus();
  const saved = await agent.act({ steps: [
    { ref: 'Correct Accepted Estimate', action: 'setValue', args: ['0'] },
    { ref: 'Save estimate', action: 'press' },
  ] });
  expect(saved.ok, saved.error?.message).toBe(true);
  await waitFor(() => expect(change).toHaveBeenLastCalledWith({
    type: 'correct-estimate', storyId: current.id, expectedEstimate: '2', choice: '0',
  }));
  await waitFor(() => expect(within(screen.getByRole('list', { name: 'Story queue' })).getByRole('listitem'))
    .toHaveTextContent('Save checkoutEstimated · 0'));
  expect(screen.getByRole('button', { name: 'Edit estimate for Save checkout' })).toHaveFocus();
});

test('a Facilitator can save an ordered custom Deck through the labeled settings', async () => {
  const facilitator = { id: 'alex', displayName: 'Alex', isFacilitator: true };
  const [room, setRoom] = createSignal<PokerLiveRoomView>({
    closed: false, id: 'room', version: 1, viewer: facilitator, participants: [], stories: [], activeStoryId: null,
    deck: FIBONACCI_DECK, deckType: 'fibonacci', deckLocked: false, round: null,
  });
  const change = vi.fn(async (): Promise<PokerResult> => {
    const next = { ...untrack(room), deck: ['Under an hour', '0'], deckType: 'custom' as const };
    setRoom(next);
    return { ok: true, room: next };
  });
  render(() => <PokerWorkspace room={room()} online={[]} status="live" onUnavailable={vi.fn()} onChange={change} />);

  const opened = await agent.act({ steps: [{ ref: 'Deck settings', action: 'press' }] });
  expect(opened.ok, opened.error?.message).toBe(true);

  const settings = await screen.findByRole('form', { name: 'Deck settings' });
  for (const name of ['T-shirt', 'Fibonacci', 'Custom']) {
    const selected = await agent.act({ steps: [{ ref: 'Deck preset', action: 'setValue', args: [name] }] });
    expect(selected.ok, selected.error?.message).toBe(true);
    expect(within(settings).getByRole('radio', { name })).toHaveAttribute('aria-checked', 'true');
  }
  const choices = await within(settings).findByRole('textbox', { name: 'Custom choices' });
  expect(choices).toHaveAccessibleDescription('Enter one choice per line, in the order they should appear.');
  expect(within(settings).getByRole('button', { name: 'Save Deck' })).toBeEnabled();
  const entered = await agent.act({ steps: [
    { ref: 'Custom choices', action: 'setValue', args: ['Under an hour\n0'] },
    { ref: 'Save Deck', action: 'press' },
  ] });
  expect(entered.ok, entered.error?.message).toBe(true);
  expect(change).toHaveBeenCalledWith({ type: 'set-deck', deck: { type: 'custom', choices: ['Under an hour', '0'] } });
  await waitFor(() => expect(settings).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Deck settings' })).toHaveTextContent('Custom');

  setRoom((current) => ({ ...current, deckLocked: true }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Deck settings' })).toBeNull());
  expect(screen.getByText(/The Deck is locked\./)).toBeInTheDocument();
});

test('Close Room focuses Cancel and a confirmation stays tied to the original Voting Round', async () => {
  const facilitator = { id: 'alex', displayName: 'Alex', isFacilitator: true };
  const initial: PokerLiveRoomView = {
    closed: false,
    id: 'room',
    version: 1,
    viewer: facilitator,
    participants: [facilitator],
    stories: [{ id: 'checkout', title: 'Save checkout', status: 'estimated', acceptedEstimate: '5' }],
    activeStoryId: 'checkout',
    deck: FIBONACCI_DECK,
    deckType: 'fibonacci',
    deckLocked: true,
    round: { id: 'first-round', phase: 'open', ownChoice: null, submittedParticipantIds: [] },
  };
  const [room, setRoom] = createSignal(initial);
  const change = vi.fn(async (): Promise<PokerResult> => ({
    ok: false, code: 'ROUND_CHANGED', message: 'The Voting Round has changed. Check the active Story and try again.',
  }));

  render(() => (
    <>
      <PokerWorkspace room={room()} online={[]} status="live" onUnavailable={vi.fn()} onChange={change} />
      <BoardConfirmDialog />
    </>
  ));

  const close = screen.getByRole('button', { name: 'Close Room' });
  close.focus();
  fireEvent.click(close);
  const dialog = await screen.findByRole('alertdialog', { name: 'Close Room?' });
  const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
  await waitFor(() => expect(cancel).toHaveFocus());
  fireEvent.click(cancel);
  await waitFor(() => expect(dialog).not.toBeVisible());
  await waitFor(() => expect(close).toHaveFocus());
  expect(change).not.toHaveBeenCalled();

  expect(agent.snapshot().some((entry) => !entry.offPage && entry.label === 'Close Room')).toBe(true);
  const open = () => agent.act({ steps: [{ ref: 'Close Room', action: 'press' }] });
  const finish = () => agent.act({ steps: [
    { ref: 'Close Room?', action: 'press', args: ['Close and discard votes'] },
  ] });
  const opened = await open();
  expect(opened.ok, opened.error?.message).toBe(true);
  const reopened = await screen.findByRole('alertdialog', { name: 'Close Room?' });
  expect((await finish()).ok).toBe(false);
  expect(allow).toHaveBeenCalledWith(expect.objectContaining({
    confirm: 'Closes the Room permanently and discards the current Voting Round and its votes.',
  }), expect.anything());
  expect(change).not.toHaveBeenCalled();
  expect(reopened).toBeVisible();

  setRoom({
    ...initial, version: 2,
    round: { id: 'new-round', phase: 'open', ownChoice: null, submittedParticipantIds: [] },
  });
  approve = true;
  const confirmed = await finish();
  expect(confirmed.ok, confirmed.error?.message).toBe(true);
  await waitFor(() => expect(change).toHaveBeenCalledWith({ type: 'close-room', discardRoundId: 'first-round' }));
  expect(await screen.findByText('The Voting Round has changed. Check the active Story and try again.')).toBeVisible();
});

test('a Facilitator can cast, clear, and reveal votes through named agent controls', async () => {
  const facilitator = { id: 'alex', displayName: 'Alex', isFacilitator: true };
  const [room, setRoom] = createSignal<PokerLiveRoomView>({
    closed: false, id: 'room', version: 1, viewer: facilitator, participants: [facilitator],
    stories: [{ id: 'checkout', title: 'Save checkout', status: 'pending' }], activeStoryId: 'checkout',
    deck: FIBONACCI_DECK, deckType: 'fibonacci', deckLocked: true,
    round: { id: 'round', phase: 'open', ownChoice: null, submittedParticipantIds: [] },
  });
  const change = vi.fn(async (command: PokerRoomChange): Promise<PokerResult> => {
    const current = untrack(room);
    const round = current.round;
    if (round?.phase !== 'open' || !('roundId' in command) || command.roundId !== round.id) {
      throw new Error('Expected a command for the open Voting Round.');
    }
    const next: PokerLiveRoomView = { ...current, version: current.version + 1 };
    if (command.type === 'vote') {
      next.round = {
        ...round, ownChoice: command.choice, submittedParticipantIds: command.choice === null ? [] : [facilitator.id],
      };
    } else if (command.type === 'reveal' && round.ownChoice !== null) {
      next.round = {
        id: round.id, phase: 'revealed',
        ballots: [{ participantId: facilitator.id, displayName: facilitator.displayName, choice: round.ownChoice }],
      };
    } else {
      throw new Error('Expected a vote or reveal.');
    }
    setRoom(next);
    return { ok: true, room: next };
  });
  render(() => <PokerWorkspace room={room()} online={[]} status="live" onUnavailable={vi.fn()} onChange={change} />);

  const active = screen.getByRole('region', { name: 'Active Story' });
  const cast = await agent.act({ steps: [{ ref: 'Cast your vote', action: 'setValue', args: ['5'] }] });
  expect(cast.ok, cast.error?.message).toBe(true);
  expect(await within(active).findByText('Your vote is 5.')).toBeVisible();

  const cleared = await agent.act({ steps: [{ ref: 'Clear vote', action: 'press' }] });
  expect(cleared.ok, cleared.error?.message).toBe(true);
  expect(await within(active).findByText('Your vote is private until reveal.')).toBeVisible();
  expect(within(active).getByRole('button', { name: 'Reveal votes' })).toHaveAttribute('aria-disabled', 'true');

  const reveal = await agent.act({ steps: [
    { ref: 'Cast your vote', action: 'setValue', args: ['8'] },
    { ref: 'Reveal votes', action: 'press' },
  ] });
  expect(reveal.ok, reveal.error?.message).toBe(true);
  const ballots = await within(active).findByRole('list', { name: 'Revealed votes' });
  expect(within(ballots).getByRole('listitem')).toHaveTextContent('Alex (you)8');
});

test('agent closure requires approval even when there is no unresolved Voting Round', async () => {
  const facilitator = { id: 'alex', displayName: 'Alex', isFacilitator: true };
  const room: PokerLiveRoomView = {
    closed: false, id: 'room', version: 1, viewer: facilitator, participants: [facilitator],
    stories: [], activeStoryId: null, deck: FIBONACCI_DECK, deckType: 'fibonacci', deckLocked: false, round: null,
  };
  const change = vi.fn(async (): Promise<PokerResult> => ({ ok: true, room }));
  render(() => <PokerWorkspace room={room} online={[]} status="live" onUnavailable={vi.fn()} onChange={change} />);

  const close = () => agent.act({ steps: [{ ref: 'Close Room', action: 'press' }] });
  expect((await close()).ok).toBe(false);
  expect(allow).toHaveBeenCalledWith(expect.objectContaining({
    confirm: 'Closes the Room permanently. Accepted Estimates remain in the read-only summary.',
  }), expect.anything());
  expect(change).not.toHaveBeenCalled();

  approve = true;
  const confirmed = await close();
  expect(confirmed.ok, confirmed.error?.message).toBe(true);
  expect(change).toHaveBeenCalledExactlyOnceWith({ type: 'close-room' });
});

test('shows vote breakdown and non-voting participants after reveal', () => {
  const alex = { id: 'alex', displayName: 'Alex', isFacilitator: true };
  const priya = { id: 'priya', displayName: 'Priya', isFacilitator: false };
  const maya = { id: 'maya', displayName: 'Maya', isFacilitator: false };
  const room: PokerLiveRoomView = {
    closed: false,
    id: 'room',
    version: 3,
    viewer: alex,
    participants: [alex, priya, maya],
    stories: [{ id: 's1', title: 'Add webhook retries', status: 'pending' }],
    activeStoryId: 's1',
    deck: FIBONACCI_DECK,
    deckType: 'fibonacci',
    deckLocked: true,
    round: {
      id: 'r1',
      phase: 'revealed',
      ballots: [
        { participantId: 'alex', displayName: 'Alex', choice: '5' },
        { participantId: 'priya', displayName: 'Priya', choice: '5' },
      ],
    },
  };
  render(() => <PokerWorkspace room={room} online={['alex', 'priya', 'maya']} status="live" onUnavailable={vi.fn()} onChange={vi.fn()} />);

  const active = screen.getByRole('region', { name: 'Active Story' });
  expect(within(active).getByLabelText('Vote breakdown')).toHaveTextContent('Unanimous 5');
  expect(within(active).getByText('Did not vote: Maya')).toBeVisible();
  const controls = agent.snapshot().filter((entry) => !entry.offPage && entry.component !== 'more');
  expect(controls.every((entry) => Boolean(entry.label))).toBe(true);
});
