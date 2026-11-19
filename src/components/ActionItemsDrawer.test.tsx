import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { flush } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardViewDTO, CardViewDTO } from '../lib/board-types';
import ActionItemsDrawer from './ActionItemsDrawer';

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
  it('lists only Action Items with All/Open/Done filters and inline completion and owner edits', async () => {
    const onUpdateActionItem = vi.fn(async () => true);
    const view = render(() => (
      <ActionItemsDrawer
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

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('shows an empty state and disables copying when no Action Items exist', () => {
    const view = render(() => (
      <ActionItemsDrawer
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

  it('renders with zero Solid 2.0 reactivity diagnostics', async () => {
    const { artifact } = await captureArtifact(() => {
      render(() => (
        <ActionItemsDrawer
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
