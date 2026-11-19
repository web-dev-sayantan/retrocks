import { fireEvent, render } from '@solidjs/testing-library';
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
      vi.advanceTimersByTime(1_100);
      flush();
      expect(view.getByText('02:59')).toBeVisible();

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
      fireEvent.keyDown(view.getByRole('textbox', { name: 'Board title' }), { key: 't' });
      flush();
      expect(view.queryByRole('dialog', { name: 'Countdown Timer' })).not.toBeInTheDocument();

      fireEvent.keyDown(document.body, { key: 't' });
      flush();
      expect(view.getByRole('dialog', { name: 'Countdown Timer' })).toBeVisible();
      fireEvent.click(view.getByRole('button', { name: '10m' }));
      flush();
      expect(view.getByRole('spinbutton', { name: 'Minutes' })).toHaveValue(10);
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
      expect(view.getByText('Time is up.')).toHaveAttribute('aria-live', 'polite');

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
      expect(startNote).toHaveBeenCalled();
    } finally {
      nextVisit.unmount();
    }
  });
});
