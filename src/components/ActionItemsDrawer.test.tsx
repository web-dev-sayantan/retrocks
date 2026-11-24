import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { cleanup, fireEvent, render, waitFor, within } from '@solidjs/testing-library';
import { createSignal, createStore, flush } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardViewDTO, CardViewDTO } from '../lib/board-types';
import ActionItemsDrawer, { type ActionItemsDrawerProps } from './ActionItemsDrawer';

function makeCard(overrides?: Partial<CardViewDTO>): CardViewDTO {
  return {
    id: 'card_1',
    columnId: 'col_1',
    groupId: null,
    content: 'Follow-up',
    redacted: false,
    isMine: false,
    isActionItem: true,
    actionDone: false,
    actionOwner: '',
    votes: 0,
    myVotes: 0,
    reactions: {},
    myReactions: [],
    commentCount: 0,
    comments: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeBoard(cards: CardViewDTO[]): BoardViewDTO {
  return {
    id: 'board_0123456789abcdef',
    title: 'Sprint 42 Retro',
    subtitle: '',
    templateId: 'standard',
    isBlurred: false,
    blindVoting: false,
    isLocked: false,
    allowParticipantGroup: false,
    voteLimit: 5,
    maxVotesPerCard: null,
    remainingVotes: 5,
    isFacilitator: false,
    timer: { endsAt: null, remainingMs: null, durationMs: null },
    version: 1,
    retentionDays: 90,
    createdAt: 1,
    lastActiveAt: 1,
    columns: [
      {
        id: 'col_1',
        title: 'Went Well',
        accent: 'sage',
        position: 0,
        isActionColumn: false,
        cardCount: 2,
      },
      {
        id: 'col_2',
        title: 'Action Items',
        accent: 'sky',
        position: 1,
        isActionColumn: true,
        cardCount: 1,
      },
    ],
    groups: [],
    cards,
  };
}

const openItem = makeCard({
  id: 'open',
  content: 'Ship the API',
  columnId: 'col_1',
});
const doneItem = makeCard({
  id: 'done',
  content: 'Write runbook',
  columnId: 'col_2',
  actionDone: true,
  actionOwner: 'Platform',
});
const regularCard = makeCard({
  id: 'regular',
  content: 'Regular card',
  isActionItem: false,
});

async function flushPromises(): Promise<void> {
  // Inline-edit saves settle through a shared commit wrapper, adding one microtask hop.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  flush();
}

afterEach(cleanup);

describe('<ActionItemsDrawer />', () => {
  it('moves focus between Action Items filters with the arrow keys', async () => {
    const { artifact } = await captureArtifact(() => {
      const board = makeBoard([openItem, doneItem]);
      const view = render(() => (
        <ActionItemsDrawer
          side="right"
          open={true}
          board={board}
          cards={board.cards}
          isLocked={false}
          onClose={() => {}}
          onUpdateActionItem={() => Promise.resolve(true)}
        />
      ));
      flush();

      const filters = within(view.getByRole('radiogroup', { name: 'Filter Action Items' }));
      const all = filters.getByRole('radio', { name: 'All (2)' });
      const open = filters.getByRole('radio', { name: 'Open (1)' });
      const done = filters.getByRole('radio', { name: 'Done (1)' });
      all.focus();
      // Arrows move and check, as in any radio group.
      fireEvent.keyDown(all, { key: 'ArrowRight' });
      flush();
      expect(open).toHaveFocus();
      expect(open).toHaveAttribute('aria-checked', 'true');
      expect(view.queryByText('Write runbook')).not.toBeInTheDocument();
      fireEvent.keyDown(open, { key: 'ArrowRight' });
      flush();
      expect(done).toHaveFocus();
      fireEvent.keyDown(done, { key: 'ArrowLeft' });
      flush();
      expect(open).toHaveFocus();
      expect(view.getByText('Ship the API')).toBeInTheDocument();
      expect(open).toHaveAttribute('aria-checked', 'true');
    });
    expectNoDiagnostics(artifact);
  });

  it('lists only Action Items with All/Open/Done filters and inline completion and owner edits', async () => {
    const onUpdateActionItem = vi.fn(async () => true);
    const board = makeBoard([openItem, doneItem, regularCard]);
    const view = render(() => (
      <ActionItemsDrawer
        side="right"
        open={true}
        board={board}
        cards={board.cards}
        isLocked={false}
        onClose={() => {}}
        onUpdateActionItem={onUpdateActionItem}
      />
    ));
    flush();

    const drawer = within(
      view.getByRole('dialog', { name: 'Action Items' }),
    );
    expect(drawer.getByText('Ship the API')).toBeInTheDocument();
    expect(drawer.getByText('Write runbook')).toBeInTheDocument();
    expect(drawer.queryByText('Regular card')).not.toBeInTheDocument();
    expect(drawer.getByRole('radio', { name: 'All (2)' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    const owner = drawer.getByLabelText('Owner for Ship the API');
    expect(owner).toHaveAttribute('maxlength', '40');
    fireEvent.input(owner, { target: { value: '  API squad  ' } });
    flush();
    fireEvent.keyDown(owner, { key: 'Enter' });
    await flushPromises();
    expect(onUpdateActionItem).toHaveBeenCalledWith('open', {
      actionOwner: 'API squad',
    });

    fireEvent.click(drawer.getByLabelText('Mark Ship the API as Done'));
    await flushPromises();
    expect(onUpdateActionItem).toHaveBeenCalledWith('open', {
      actionDone: true,
    });

    fireEvent.click(drawer.getByRole('radio', { name: 'Open (1)' }));
    flush();
    expect(drawer.getByText('Ship the API')).toBeInTheDocument();
    expect(drawer.queryByText('Write runbook')).not.toBeInTheDocument();

    fireEvent.click(drawer.getByRole('radio', { name: 'Done (1)' }));
    flush();
    expect(drawer.queryByText('Ship the API')).not.toBeInTheDocument();
    expect(drawer.getByText('Write runbook')).toBeInTheDocument();
    expect(drawer.getByLabelText('Mark Write runbook as Done')).toBeChecked();
  });

  it('shows live owners while idle and preserves the draft and caret during an edit', () => {
    const [board, setBoard] = createStore(makeBoard([{ ...openItem }]));
    const view = render(() => (
      <ActionItemsDrawer
        side="right"
        open={true}
        board={board}
        cards={board.cards}
        isLocked={false}
        onClose={() => {}}
        onUpdateActionItem={vi.fn(async () => true)}
      />
    ));
    flush();

    const owner = view.getByRole<HTMLInputElement>('textbox', { name: 'Owner for Ship the API' });
    setBoard((draft) => { draft.cards[0].actionOwner = 'Platform'; });
    flush();
    expect(owner).toHaveValue('Platform');

    owner.focus();
    fireEvent.input(owner, { target: { value: 'API squad' } });
    owner.setSelectionRange(3, 3);
    flush();
    setBoard((draft) => { draft.cards[0].actionOwner = 'Operations'; });
    flush();
    expect(owner).toHaveValue('API squad');
    expect(owner.selectionStart).toBe(3);
    expect(owner.selectionEnd).toBe(3);

    fireEvent.keyDown(owner, { key: 'Escape' });
    flush();
    expect(owner).toHaveValue('Operations');
  });

  it('keeps a failed owner draft and rolls back a failed Done change so both can be retried', async () => {
    let completeOwnerSave!: (ok: boolean) => void;
    const onUpdate = vi.fn<() => Promise<boolean>>()
      .mockImplementationOnce(() => new Promise((resolve) => { completeOwnerSave = resolve; }))
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('Disconnected'))
      .mockResolvedValueOnce(true);
    const board = makeBoard([openItem]);
    const view = render(() => (
      <ActionItemsDrawer
        side="right"
        open={true}
        board={board}
        cards={board.cards}
        isLocked={false}
        onClose={() => {}}
        onUpdateActionItem={onUpdate}
      />
    ));
    flush();

    const drawer = within(view.getByRole('dialog', { name: 'Action Items' }));
    const owner = drawer.getByLabelText('Owner for Ship the API');
    const done = drawer.getByLabelText('Mark Ship the API as Done');
    fireEvent.input(owner, { target: { value: 'API squad' } });
    flush();
    fireEvent.keyDown(owner, { key: 'Enter' });
    fireEvent.keyDown(owner, { key: 'Enter' });
    flush();
    expect(owner).toHaveAttribute('readonly');
    expect(done).toBeEnabled();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    completeOwnerSave(false);
    await flushPromises();

    expect(owner).toHaveValue('API squad');
    expect(drawer.getByRole('alert')).toHaveTextContent('Could not save the owner');
    fireEvent.keyDown(owner, { key: 'Enter' });
    await flushPromises();
    expect(onUpdate).toHaveBeenLastCalledWith('open', { actionOwner: 'API squad' });
    expect(drawer.queryByRole('alert')).toBeNull();

    fireEvent.click(done);
    await flushPromises();
    expect(done).not.toBeChecked();
    expect(drawer.getByRole('alert')).toHaveTextContent('Could not update Done');
    fireEvent.click(done);
    await flushPromises();
    expect(onUpdate).toHaveBeenLastCalledWith('open', { actionDone: true });
    expect(drawer.queryByRole('alert')).toBeNull();
  });

  it.each([true, false])('keeps a Done click while the Owner save is pending (Owner succeeds: %s)', async (ownerSaved) => {
    let completeOwnerSave!: (ok: boolean) => void;
    const update = vi.fn<ActionItemsDrawerProps['onUpdateActionItem']>()
      .mockImplementationOnce(() => new Promise((resolve) => { completeOwnerSave = resolve; }))
      .mockResolvedValueOnce(true);
    const view = render(() => {
      const [board, setBoard] = createStore(makeBoard([{ ...openItem }]));
      const applyUpdate: ActionItemsDrawerProps['onUpdateActionItem'] = async (id, patch) => {
        const previous = { ...board.cards[0] };
        // The session owns the optimistic write; the harness mirrors it here.
        setBoard((draft) => { Object.assign(draft.cards[0], patch); });
        const ok = await update(id, patch);
        if (!ok) setBoard((draft) => { Object.assign(draft.cards[0], previous); });
        return ok;
      };
      return (
        <ActionItemsDrawer
          side="right"
          open={true}
          board={board}
          cards={board.cards}
          isLocked={false}
          onClose={() => {}}
          onUpdateActionItem={applyUpdate}
        />
      );
    });
    flush();

    const owner = view.getByLabelText('Owner for Ship the API');
    const done = view.getByLabelText('Mark Ship the API as Done');
    owner.focus();
    fireEvent.input(owner, { target: { value: 'API squad' } });
    done.focus();
    flush();

    expect(update).toHaveBeenCalledExactlyOnceWith('open', { actionOwner: 'API squad' });
    expect(done).toBeEnabled();
    fireEvent.click(done);
    flush();
    expect(done).toBeChecked();
    expect(update).toHaveBeenCalledTimes(1);

    completeOwnerSave(ownerSaved);
    await waitFor(() => {
      expect(update).toHaveBeenNthCalledWith(2, 'open', { actionDone: true });
      expect(done).toBeEnabled();
    });
    expect(done).toBeChecked();
    expect(owner).toHaveValue('API squad');
    if (ownerSaved) expect(view.queryByRole('alert')).toBeNull();
    else expect(view.getByRole('alert')).toHaveTextContent('Could not save the owner');
  });

  it('copies the filtered list as a Markdown checklist, focuses the close button, and closes on Escape', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const onClose = vi.fn();
    try {
      const board = makeBoard([openItem, doneItem]);
      const { getByRole, getByText } = render(() => (
        <ActionItemsDrawer
          side="right"
          open={true}
          board={board}
          cards={board.cards}
          isLocked={false}
          onClose={onClose}
          onUpdateActionItem={vi.fn(async () => true)}
        />
      ));
      await flushPromises();

      expect(document.activeElement).toBe(
        getByRole('button', { name: 'Close Action Items' }),
      );
      fireEvent.click(
        getByRole('button', { name: 'Copy as Markdown Checklist' }),
      );
      await flushPromises();
      expect(writeText).toHaveBeenCalledWith(
        '- [ ] Ship the API\n- [x] Write runbook — Platform',
      );
      expect(getByText('Copied 2 Action Items')).toBeInTheDocument();

      fireEvent.click(getByRole('radio', { name: 'Open (1)' }));
      flush();
      fireEvent.click(
        getByRole('button', { name: 'Copy as Markdown Checklist' }),
      );
      await flushPromises();
      expect(writeText).toHaveBeenLastCalledWith('- [ ] Ship the API');

      fireEvent.keyDown(getByRole('button', { name: 'Close Action Items' }), { key: 'Escape' });
      flush();
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('starts each opening with All selected and ignores a previous opening’s clipboard result', async () => {
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    let finishCopy!: () => void;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => new Promise<void>((resolve) => { finishCopy = resolve; }) },
    });
    const board = makeBoard([openItem, doneItem]);
    const [open, setOpen] = createSignal(true);
    try {
      const view = render(() => (
        <ActionItemsDrawer
          side="right"
          open={open()}
          board={board}
          cards={board.cards}
          isLocked={false}
          onClose={() => setOpen(false)}
          onUpdateActionItem={vi.fn(async () => true)}
        />
      ));
      await flushPromises();
      fireEvent.click(view.getByRole('radio', { name: 'Open (1)' }));
      flush();
      fireEvent.click(view.getByRole('button', { name: 'Copy as Markdown Checklist' }));
      fireEvent.click(view.getByRole('button', { name: 'Close Action Items' }));
      await flushPromises();
      setOpen(true);
      await flushPromises();
      expect(view.getByRole('radio', { name: 'All (2)' })).toBeChecked();
      finishCopy();
      await flushPromises();
      expect(view.queryByText('Copied 1 Action Item')).toBeNull();
    } finally {
      if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('shows an empty state and disables copying when no Action Items exist', () => {
    const board = makeBoard([regularCard]);
    const view = render(() => (
      <ActionItemsDrawer
        side="right"
        open={true}
        board={board}
        cards={board.cards}
        isLocked={false}
        onClose={() => {}}
        onUpdateActionItem={vi.fn(async () => true)}
      />
    ));
    flush();

    expect(view.getByText('No Action Items yet.')).toBeInTheDocument();
    expect(
      view.getByRole('button', { name: 'Copy as Markdown Checklist' }),
    ).toBeDisabled();
  });

  it('disables Action Item edits for Participants when Locked, but allows Facilitators to update done and owner', async () => {
    const participantUpdate = vi.fn(async () => true);
    const participantBoard = { ...makeBoard([openItem]), isLocked: true, isFacilitator: false };
    const participantView = render(() => (
      <ActionItemsDrawer
        side="right"
        open={true}
        board={participantBoard}
        cards={participantBoard.cards}
        isLocked={true}
        onClose={() => {}}
        onUpdateActionItem={participantUpdate}
      />
    ));
    flush();

    expect(
      participantView.getByLabelText('Mark Ship the API as Done'),
    ).toBeDisabled();
    expect(
      participantView.getByLabelText('Owner for Ship the API'),
    ).toBeDisabled();
    cleanup();

    const facilitatorUpdate = vi.fn(async () => true);
    const facilitatorBoard = { ...makeBoard([openItem]), isLocked: true, isFacilitator: true };
    const facilitatorView = render(() => (
      <ActionItemsDrawer
        side="right"
        open={true}
        board={facilitatorBoard}
        cards={facilitatorBoard.cards}
        isLocked={true}
        onClose={() => {}}
        onUpdateActionItem={facilitatorUpdate}
      />
    ));
    flush();

    const checkbox = facilitatorView.getByLabelText('Mark Ship the API as Done');
    const owner = facilitatorView.getByLabelText('Owner for Ship the API');
    expect(checkbox).toBeEnabled();
    expect(owner).toBeEnabled();

    fireEvent.click(checkbox);
    await flushPromises();
    expect(facilitatorUpdate).toHaveBeenCalledWith('open', { actionDone: true });

    fireEvent.input(owner, { target: { value: 'Platform' } });
    flush();
    fireEvent.keyDown(owner, { key: 'Enter' });
    await flushPromises();
    expect(facilitatorUpdate).toHaveBeenCalledWith('open', {
      actionOwner: 'Platform',
    });
  });

  it('wraps Tab and Shift+Tab within Action Items', async () => {
    const board = makeBoard([openItem]);
    const view = render(() => (
      <ActionItemsDrawer
        side="right"
        open={true}
        board={board}
        cards={board.cards}
        isLocked={false}
        onClose={() => {}}
        onUpdateActionItem={vi.fn(async () => true)}
      />
    ));
    await flushPromises();

    const close = view.getByRole('button', { name: 'Close Action Items' });
    const copy = view.getByRole('button', { name: 'Copy as Markdown Checklist' });
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    await flushPromises();
    expect(copy).toHaveFocus();
    fireEvent.keyDown(copy, { key: 'Tab' });
    await flushPromises();
    expect(close).toHaveFocus();
  });

  it('lets Escape close the drawer while the owner text is unchanged, and cancels only the edit once it changed', async () => {
    const board = makeBoard([openItem, doneItem]);
    const onClose = vi.fn();
    const onUpdateActionItem = vi.fn(async () => true);
    const view = render(() => (
      <ActionItemsDrawer
        side="right"
        open={true}
        board={board}
        cards={board.cards}
        isLocked={false}
        onClose={onClose}
        onUpdateActionItem={onUpdateActionItem}
      />
    ));
    flush();
    const drawer = within(view.getByRole('dialog', { name: 'Action Items' }));

    // Unchanged: Escape belongs to the drawer and closes it.
    const owner = drawer.getByLabelText('Owner for Ship the API');
    owner.focus();
    fireEvent.keyDown(owner, { key: 'Escape' });
    flush();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onUpdateActionItem).not.toHaveBeenCalled();

    // Changed: Escape cancels the edit only, restoring the committed owner.
    fireEvent.input(owner, { target: { value: 'Platform' } });
    flush();
    fireEvent.keyDown(owner, { key: 'Escape' });
    flush();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(owner).toHaveValue('');
    expect(onUpdateActionItem).not.toHaveBeenCalled();
  });

  it('renders with zero Solid 2.0 reactivity diagnostics', async () => {
    const { artifact } = await captureArtifact(() => {
      const board = makeBoard([openItem, doneItem]);
      render(() => (
        <ActionItemsDrawer
          side="right"
          open={true}
          board={board}
          cards={board.cards}
          isLocked={false}
          onClose={() => {}}
          onUpdateActionItem={vi.fn(async () => true)}
        />
      ));
      flush();
    });
    expectNoDiagnostics(artifact);
  });
});
