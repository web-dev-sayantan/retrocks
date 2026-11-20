import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { cleanup, fireEvent, render, waitFor, within } from '@solidjs/testing-library';
import { createStore, flush } from 'solid-js';
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
  await Promise.resolve();
  await Promise.resolve();
  flush();
}

afterEach(cleanup);

describe('<ActionItemsDrawer />', () => {
  it('moves focus between Action Items filters with the arrow keys', async () => {
    const { artifact } = await captureArtifact(() => {
      const view = render(() => (
        <ActionItemsDrawer
          open={true}
          board={makeBoard([openItem, doneItem])}
          isLocked={false}
          onClose={() => {}}
          onUpdateActionItem={() => Promise.resolve(true)}
        />
      ));
      flush();

      const filters = within(view.getByRole('group', { name: 'Filter Action Items' }));
      const all = filters.getByRole('button', { name: 'All (2)' });
      const open = filters.getByRole('button', { name: 'Open (1)' });
      const done = filters.getByRole('button', { name: 'Done (1)' });
      all.focus();
      fireEvent.keyDown(all, { key: 'ArrowRight' });
      flush();
      expect(open).toHaveFocus();
      fireEvent.keyDown(open, { key: 'ArrowRight' });
      flush();
      expect(done).toHaveFocus();
      fireEvent.keyDown(done, { key: 'ArrowLeft' });
      flush();
      expect(open).toHaveFocus();
      fireEvent.click(open);
      flush();
      expect(open).toHaveAttribute('aria-pressed', 'true');
      expect(view.queryByText('Write runbook')).not.toBeInTheDocument();
    });
    expectNoDiagnostics(artifact);
  });

  it('lists only Action Items with All/Open/Done filters and inline completion and owner edits', async () => {
    const onUpdateActionItem = vi.fn(async () => true);
    const view = render(() => (
      <ActionItemsDrawer
        open={true}
        board={makeBoard([openItem, doneItem, regularCard])}
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
    expect(drawer.getByRole('button', { name: 'All (2)' })).toHaveAttribute(
      'aria-pressed',
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

    fireEvent.click(drawer.getByRole('button', { name: 'Open (1)' }));
    flush();
    expect(drawer.getByText('Ship the API')).toBeInTheDocument();
    expect(drawer.queryByText('Write runbook')).not.toBeInTheDocument();

    fireEvent.click(drawer.getByRole('button', { name: 'Done (1)' }));
    flush();
    expect(drawer.queryByText('Ship the API')).not.toBeInTheDocument();
    expect(drawer.getByText('Write runbook')).toBeInTheDocument();
    expect(drawer.getByLabelText('Mark Write runbook as Done')).toBeChecked();
  });

  it('keeps a failed owner draft and rolls back a failed Done change so both can be retried', async () => {
    let completeOwnerSave!: (ok: boolean) => void;
    const onUpdate = vi.fn<() => Promise<boolean>>()
      .mockImplementationOnce(() => new Promise((resolve) => { completeOwnerSave = resolve; }))
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('Disconnected'))
      .mockResolvedValueOnce(true);
    const view = render(() => (
      <ActionItemsDrawer
        open={true}
        board={makeBoard([openItem])}
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
        const ok = await update(id, patch);
        if (ok) setBoard((draft) => { Object.assign(draft.cards[0], patch); });
        return ok;
      };
      return (
        <ActionItemsDrawer
          open={true}
          board={board}
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
      const { getByRole, getByText } = render(() => (
        <ActionItemsDrawer
          open={true}
          board={makeBoard([openItem, doneItem])}
          isLocked={false}
          onClose={onClose}
          onUpdateActionItem={vi.fn(async () => true)}
        />
      ));
      flush();

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

      fireEvent.click(getByRole('button', { name: 'Open (1)' }));
      flush();
      fireEvent.click(
        getByRole('button', { name: 'Copy as Markdown Checklist' }),
      );
      await flushPromises();
      expect(writeText).toHaveBeenLastCalledWith('- [ ] Ship the API');

      fireEvent(
        getByRole('dialog', { name: 'Action Items' }),
        new Event('cancel', { cancelable: true }),
      );
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('shows an empty state and disables copying when no Action Items exist', () => {
    const view = render(() => (
      <ActionItemsDrawer
        open={true}
        board={makeBoard([regularCard])}
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
    const participantView = render(() => (
      <ActionItemsDrawer
        open={true}
        board={{ ...makeBoard([openItem]), isLocked: true, isFacilitator: false }}
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
    const facilitatorView = render(() => (
      <ActionItemsDrawer
        open={true}
        board={{ ...makeBoard([openItem]), isLocked: true, isFacilitator: true }}
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

  it('wraps Tab and Shift+Tab within Action Items', () => {
    const view = render(() => (
      <ActionItemsDrawer
        open={true}
        board={makeBoard([openItem])}
        isLocked={false}
        onClose={() => {}}
        onUpdateActionItem={vi.fn(async () => true)}
      />
    ));
    flush();

    const close = view.getByRole('button', { name: 'Close Action Items' });
    const copy = view.getByRole('button', { name: 'Copy as Markdown Checklist' });
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(copy).toHaveFocus();
    fireEvent.keyDown(copy, { key: 'Tab' });
    expect(close).toHaveFocus();
  });

  it('renders with zero Solid 2.0 reactivity diagnostics', async () => {
    const { artifact } = await captureArtifact(() => {
      render(() => (
        <ActionItemsDrawer
          open={true}
          board={makeBoard([openItem, doneItem])}
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
