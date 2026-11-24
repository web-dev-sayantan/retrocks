import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { fireEvent, render } from '@solidjs/testing-library';
import { shortcuts } from '@ui-sdk/solid/shortcuts';
import { flush } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultBoardWorkspaceActions } from '../lib/board-actions';
import type { BoardLiveMessage } from '../lib/board-live-protocol';
import type { BoardViewDTO } from '../lib/board-types';
import BoardWorkspace from './BoardWorkspace';

const SERVER_TIME = Date.parse('2026-11-19T14:00:00Z');
const streams: BoardEventSource[] = [];

class BoardEventSource extends EventTarget {
  constructor() {
    super();
    streams.push(this);
  }

  close() {}

  receive(message: BoardLiveMessage) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
    flush();
  }
}

function makeBoard(overrides?: Partial<BoardViewDTO>): BoardViewDTO {
  return {
    id: 'board_0123456789abcdef',
    title: 'Sprint Retro',
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
    createdAt: SERVER_TIME,
    lastActiveAt: SERVER_TIME,
    columns: [],
    groups: [],
    cards: [],
    ...overrides,
  };
}

function sendSnapshot(board: BoardViewDTO, serverNow: number) {
  streams.at(-1)!.receive({ type: 'board:snapshot', version: board.version, serverNow, board });
}

beforeEach(() => {
  streams.length = 0;
  localStorage.clear();
  vi.stubGlobal('EventSource', BoardEventSource);
  vi.useFakeTimers({
    toFake: ['Date', 'performance', 'setInterval', 'clearInterval'],
    now: new Date('2026-11-19T10:00:00Z'),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Board Countdown Timer', () => {
  it('tracks the server clock through timer updates and a tab visibility reconnect', () => {
    const board = makeBoard();
    const view = render(() => <BoardWorkspace board={board} boardId={board.id} />);
    try {
      flush();
      sendSnapshot(board, SERVER_TIME);
      streams[0].receive({
        type: 'board:mutation',
        version: 2,
        events: [{
          type: 'timer:updated',
          version: 2,
          serverNow: SERVER_TIME,
          timer: { endsAt: SERVER_TIME + 180_000, remainingMs: null, durationMs: 180_000 },
        }],
      });
      expect(view.getByText('03:00')).toBeVisible();
      const announcement = view.getByText('Timer started.').closest('[aria-live]');
      expect(announcement).toHaveAttribute('aria-live', 'polite');
      vi.advanceTimersByTime(1_100);
      flush();
      expect(view.getByText('02:59')).toBeVisible();
      expect(announcement).toHaveTextContent(/^Timer started\.$/);
      expect(view.getByText('02:59').closest('[aria-live]')).toBeNull();

      vi.setSystemTime(new Date('2026-11-19T20:00:00Z'));
      vi.advanceTimersByTime(1_000);
      flush();
      expect(view.getByText('02:58')).toBeVisible();

      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      try {
        fireEvent(document, new Event('visibilitychange'));
        expect(streams).toHaveLength(2);
        sendSnapshot(makeBoard({
          version: 3,
          timer: { endsAt: null, remainingMs: 72_000, durationMs: 180_000 },
        }), SERVER_TIME + 108_000);
        expect(view.getByText('01:12')).toBeVisible();
        expect(announcement).toHaveTextContent('Timer paused.');
        vi.advanceTimersByTime(3_500);
        flush();
        expect(view.getByText('01:12')).toBeVisible();
      } finally {
        visibility.mockRestore();
      }
    } finally {
      view.unmount();
    }
  });

  it('opens Facilitator controls with T and submits a selected preset', async () => {
    const board = makeBoard({ isFacilitator: true });
    const updateTimer = vi.fn<typeof defaultBoardWorkspaceActions.updateTimer>(async () => ({
      ok: true,
      version: 2,
      events: [{
        type: 'timer:updated',
        version: 2,
        serverNow: SERVER_TIME,
        timer: { endsAt: SERVER_TIME + 600_000, remainingMs: null, durationMs: 600_000 },
      }],
    }));
    const view = render(() => (
      <BoardWorkspace
        board={board}
        boardId={board.id}
        actions={{ ...defaultBoardWorkspaceActions, updateTimer }}
      />
    ));
    try {
      flush();
      fireEvent.click(view.getByRole('button', { name: 'Rename Board' }));
      flush();
      const titleInput = view.getByRole('textbox', { name: 'Board title' });
      fireEvent.keyDown(titleInput, { key: 't' });
      flush();
      expect(view.queryByRole('dialog', { name: 'Countdown Timer' })).not.toBeInTheDocument();

      fireEvent.keyDown(titleInput, { key: 'Escape' });
      flush();
      fireEvent.keyDown(document.body, { key: 't' });
      flush();
      expect(view.getByRole('dialog', { name: 'Countdown Timer' })).toHaveFocus();
      // While the popover is open, its layer owns "t": exactly one listing for it.
      expect(shortcuts.list().filter((entry) => entry.keys === 't')).toHaveLength(1);
      fireEvent.click(view.getByRole('radio', { name: '10m' }));
      flush();
      expect(view.getByRole('textbox', { name: 'Minutes' })).toHaveValue('10');
      fireEvent.click(view.getByRole('button', { name: 'Start' }));
      await Promise.resolve();
      await Promise.resolve();
      flush();
      expect(updateTimer).toHaveBeenCalledWith({
        boardId: board.id, change: { action: 'start', minutes: 10 },
      });
      expect(view.getByText('10:00')).toBeVisible();

      fireEvent.keyDown(view.getByRole('dialog', { name: 'Countdown Timer' }), { key: 'Escape' });
      flush();
      expect(view.queryByRole('dialog', { name: 'Countdown Timer' })).not.toBeInTheDocument();
      expect(view.getByRole('button', { name: /Countdown Timer/ })).toHaveFocus();
    } finally {
      view.unmount();
    }
  });

  it('keeps T facilitator-only: a Participant has no T registration and no popover', () => {
    const board = makeBoard({ isFacilitator: false });
    const view = render(() => <BoardWorkspace board={board} boardId={board.id} />);
    try {
      flush();
      expect(shortcuts.list().map((entry) => entry.keys)).toEqual(['/', 'n', 'a']);
      fireEvent.keyDown(document.body, { key: 't' });
      flush();
      expect(view.queryByRole('dialog', { name: 'Countdown Timer' })).not.toBeInTheDocument();
    } finally {
      view.unmount();
    }
  });

  it('keeps equivalent and identically worded timer updates quiet', () => {
    const board = makeBoard({
      timer: { endsAt: SERVER_TIME + 120_000, remainingMs: null, durationMs: 180_000 },
    });
    const view = render(() => <BoardWorkspace board={board} boardId={board.id} />);
    try {
      flush();
      const region = view.container.querySelector('span[aria-live="polite"][aria-atomic="true"]')!;
      expect(region).toHaveTextContent(/^$/);

      function updateDeadline(version: number, seconds: number) {
        streams[0].receive({
          type: 'board:mutation',
          version,
          events: [{
            type: 'timer:updated',
            version,
            serverNow: SERVER_TIME,
            timer: { ...board.timer, endsAt: SERVER_TIME + seconds * 1_000 },
          }],
        });
      }

      sendSnapshot(board, SERVER_TIME);
      updateDeadline(2, 120);
      expect(region).toHaveTextContent(/^$/);
      updateDeadline(3, 121);
      expect(region).toHaveTextContent('Timer updated. 3 minutes total.');
      const observer = new MutationObserver(() => {});
      observer.observe(region, { childList: true, subtree: true, characterData: true });
      try {
        updateDeadline(4, 121);
        updateDeadline(5, 122);
        expect(region).toHaveTextContent('Timer updated. 3 minutes total.');
        expect(observer.takeRecords()).toEqual([]);
      } finally {
        observer.disconnect();
      }
    } finally {
      view.unmount();
    }
  });

  it('announces consecutive extensions to running and paused timers', () => {
    const board = makeBoard({
      timer: { endsAt: SERVER_TIME + 120_000, remainingMs: null, durationMs: 180_000 },
    });
    const view = render(() => <BoardWorkspace board={board} boardId={board.id} />);
    try {
      flush();
      sendSnapshot(board, SERVER_TIME);

      function updateTimer(version: number, timer: BoardViewDTO['timer']) {
        streams[0].receive({
          type: 'board:mutation',
          version,
          events: [{ type: 'timer:updated', version, serverNow: SERVER_TIME, timer }],
        });
      }

      updateTimer(2, { endsAt: SERVER_TIME + 180_000, remainingMs: null, durationMs: 240_000 });
      const announcement = view.getByText('Timer updated. 4 minutes total.').closest('[aria-live]');
      expect(announcement).toHaveAttribute('aria-live', 'polite');

      updateTimer(3, { endsAt: SERVER_TIME + 240_000, remainingMs: null, durationMs: 300_000 });
      expect(announcement).toHaveTextContent(/^Timer updated\. 5 minutes total\.$/);
      vi.advanceTimersByTime(1_100);
      flush();
      expect(view.getByText('03:59')).toBeVisible();
      expect(announcement).toHaveTextContent(/^Timer updated\. 5 minutes total\.$/);

      updateTimer(4, { endsAt: null, remainingMs: 239_000, durationMs: 300_000 });
      updateTimer(5, { endsAt: null, remainingMs: 299_000, durationMs: 360_000 });
      expect(announcement).toHaveTextContent(/^Paused timer updated\. 4 minutes and 59 seconds remaining\.$/);

      updateTimer(6, { endsAt: null, remainingMs: 359_000, durationMs: 420_000 });
      expect(announcement).toHaveTextContent(/^Paused timer updated\. 5 minutes and 59 seconds remaining\.$/);

      updateTimer(7, { endsAt: SERVER_TIME + 359_000, remainingMs: null, durationMs: 420_000 });
      expect(announcement).toHaveTextContent(/^Timer resumed\.$/);

      updateTimer(8, { endsAt: null, remainingMs: null, durationMs: null });
      expect(announcement).toHaveTextContent(/^Timer dismissed\.$/);
    } finally {
      view.unmount();
    }
  });

  it('announces a live timer reaching zero and does not replay an already-ended snapshot', () => {
    const board = makeBoard({
      timer: { endsAt: SERVER_TIME + 2_000, remainingMs: null, durationMs: 180_000 },
    });
    const view = render(() => <BoardWorkspace board={board} boardId={board.id} />);
    try {
      flush();
      sendSnapshot(board, SERVER_TIME);
      expect(view.getByText('00:02')).toBeVisible();
      expect(view.queryByText('Time is up.')).not.toBeInTheDocument();

      vi.advanceTimersByTime(2_100);
      flush();
      expect(view.getByText('00:00')).toBeVisible();
      expect(view.getByText('Time is up.').closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');

      view.unmount();
      const reloaded = render(() => <BoardWorkspace board={board} boardId={board.id} />);
      try {
        flush();
        sendSnapshot(board, SERVER_TIME + 5_000);
        expect(reloaded.getByText('00:00')).toBeVisible();
        expect(reloaded.queryByText('Time is up.')).not.toBeInTheDocument();
      } finally {
        reloaded.unmount();
      }
    } finally {
      view.unmount();
    }
  });

  it('remembers a Participant’s mute setting and chimes after unmuting', () => {
    const startNote = vi.fn();
    class FakeAudioContext {
      state = 'running';
      currentTime = 0;
      destination = {};
      close = async () => {};
      createOscillator() {
        return {
          frequency: { value: 0 },
          connect() {},
          disconnect() {},
          start: startNote,
          stop() {},
        };
      }
      createGain() {
        return {
          gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
          disconnect() {},
        };
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const board = makeBoard({
      timer: { endsAt: SERVER_TIME + 1_000, remainingMs: null, durationMs: 180_000 },
    });

    function openTimer() {
      const view = render(() => <BoardWorkspace board={board} boardId={board.id} />);
      flush();
      sendSnapshot(board, SERVER_TIME);
      fireEvent.click(view.getByRole('button', { name: /Countdown Timer/ }));
      flush();
      return view;
    }

    const firstVisit = openTimer();
    try {
      const mute = firstVisit.getByRole('button', { name: 'Mute timer chime' });
      expect(mute).toHaveAttribute('aria-pressed', 'false');
      expect(firstVisit.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
      fireEvent.click(mute);
      flush();
      expect(mute).toHaveAttribute('aria-pressed', 'true');
    } finally {
      firstVisit.unmount();
    }

    const nextVisit = openTimer();
    try {
      const mute = nextVisit.getByRole('button', { name: 'Mute timer chime' });
      expect(mute).toHaveAttribute('aria-pressed', 'true');
      vi.advanceTimersByTime(1_100);
      flush();
      expect(nextVisit.getByText('Time is up.')).toBeInTheDocument();
      expect(startNote).not.toHaveBeenCalled();

      fireEvent.click(mute);
      flush();
      streams.at(-1)!.receive({
        type: 'board:mutation',
        version: 2,
        events: [{
          type: 'timer:updated',
          version: 2,
          serverNow: SERVER_TIME + 2_000,
          timer: { endsAt: SERVER_TIME + 3_000, remainingMs: null, durationMs: 180_000 },
        }],
      });
      vi.advanceTimersByTime(1_100);
      flush();
      expect(nextVisit.getByText('Time is up.')).toBeInTheDocument();
      expect(startNote).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(1_100);
      fireEvent(document, new Event('visibilitychange'));
      flush();
      expect(startNote).toHaveBeenCalledTimes(2);
    } finally {
      nextVisit.unmount();
    }
  });

  it('keeps stable trigger width across idle, running, and paused states and floats the popover via @ui-sdk/solid/popover with zero diagnostics', async () => {
    const board = makeBoard({ isFacilitator: true });
    const { artifact } = await captureArtifact(
      () => {
        const view = render(() => <BoardWorkspace board={board} boardId={board.id} />);
        try {
          flush();
          sendSnapshot(board, SERVER_TIME);

          const trigger = view.getByRole('button', { name: 'Countdown Timer' });
          expect(trigger).toHaveClass('rounded-full', 'spring-press', 'board-touch-target', 'min-w-[5.75rem]');
          expect(trigger).toHaveAttribute('data-timer-state', 'idle');

          // Transition to running
          streams[0].receive({
            type: 'board:mutation',
            version: 2,
            events: [{
              type: 'timer:updated',
              version: 2,
              serverNow: SERVER_TIME,
              timer: { endsAt: SERVER_TIME + 180_000, remainingMs: null, durationMs: 180_000 },
            }],
          });
          expect(trigger).toHaveAttribute('data-timer-state', 'running');
          expect(trigger).toHaveAccessibleName('Countdown Timer, 03:00');

          // Transition to paused: keeps compact width (no wide visible "Paused" text node pushing siblings)
          streams[0].receive({
            type: 'board:mutation',
            version: 3,
            events: [{
              type: 'timer:updated',
              version: 3,
              serverNow: SERVER_TIME + 60_000,
              timer: { endsAt: null, remainingMs: 72_000, durationMs: 180_000 },
            }],
          });
          expect(trigger).toHaveAttribute('data-timer-state', 'paused');
          expect(trigger).toHaveAccessibleName('Countdown Timer, paused at 01:12');
          expect(trigger.textContent?.trim()).toBe('01:12');

          // Opening via click mounts top-layer @ui-sdk/solid/popover with data-board-overlay
          fireEvent.click(trigger);
          flush();
          const dialog = view.getByRole('dialog', { name: 'Countdown Timer' });
          expect(dialog).toHaveFocus();
          expect(dialog).toHaveAttribute('data-slot', 'popover-content');
          expect(dialog).toHaveAttribute('data-board-overlay', 'true');
          expect(dialog).toHaveClass('board-popover');

          fireEvent.keyDown(dialog, { key: 'Escape' });
          flush();
          expect(view.queryByRole('dialog', { name: 'Countdown Timer' })).not.toBeInTheDocument();
          expect(trigger).toHaveFocus();
        } finally {
          view.unmount();
        }
      },
      { scenario: 'countdown-timer-popover-zero-cls' },
    );
    expectNoDiagnostics(artifact);
  });
});
