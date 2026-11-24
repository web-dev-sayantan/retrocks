import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { createSignal, flush, untrack } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from '../../App';
import {
  FIBONACCI_DECK,
  type PokerClosedRoomView,
  type PokerLiveRoomView,
  type PokerResult,
  type PokerRoomChange,
} from '../../lib/poker-types';
import { readRecentPokerRooms } from '../../lib/recent-poker-rooms';
import PokerRoomSummary from './PokerRoomSummary';
import PokerWorkspace from './PokerWorkspace';

vi.mock('virtual:solid-env/client', () => ({ env: { VITE_APP_NAME: 'Retrocks' } }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

function makeRoom(overrides: Partial<PokerLiveRoomView> = {}): PokerLiveRoomView {
  return {
    closed: false,
    id: 'abcdefghijklmnopqrstuv',
    name: 'Sprint 14 Planning',
    version: 1,
    viewer: { id: 'alex', displayName: 'Alex', isFacilitator: true },
    participants: [{ id: 'alex', displayName: 'Alex', isFacilitator: true }],
    stories: [],
    activeStoryId: null,
    deck: FIBONACCI_DECK,
    deckType: 'fibonacci',
    deckLocked: false,
    round: null,
    ...overrides,
  };
}

function stubRouteResponse(value: unknown, status = 200) {
  vi.stubGlobal('fetch', async (resource: string) => {
    if (!new URL(resource, window.location.origin).pathname.startsWith('/_server')) {
      throw new Error(`Unexpected request: ${resource}`);
    }
    return Response.json(value, {
      status,
      headers: { 'X-Server-Function-Format': '8' },
    });
  });
}

describe('Room name display surfaces', () => {
  it('includes an optional Room name input with placeholder Poker Room on the creation form', async () => {
    window.history.replaceState(null, '', '/pointing-poker');
    render(() => <App />);

    const form = await screen.findByRole('form', { name: 'Pointing Poker' });
    const roomNameInput = within(form).getByRole('textbox', { name: 'Room name' });
    expect(roomNameInput).toHaveAttribute('name', 'roomName');
    expect(roomNameInput).toHaveAttribute('placeholder', 'Poker Room');
    expect(roomNameInput).not.toBeRequired();
  });

  it('shows the Room name on the pre-join screen and in the page title', async () => {
    const room = makeRoom({ id: 'prejoinroom12345678901', viewer: null, participants: [] });
    stubRouteResponse(room);
    window.history.replaceState(null, '', `/p/${room.id}`);
    render(() => <App />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Join Sprint 14 Planning' }))
      .toBeInTheDocument();
    expect(document.title).toBe('Sprint 14 Planning — Retrocks');
  });

  it('shows the Room name as the closed Room summary heading and in the page title', async () => {
    const closed: PokerClosedRoomView = {
      closed: true,
      id: 'closedroom123456789012',
      name: 'Checkout Sizing',
      version: 3,
      canDelete: false,
      stories: [],
    };
    stubRouteResponse(closed);
    window.history.replaceState(null, '', `/p/${closed.id}`);
    render(() => <App />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Checkout Sizing' }))
      .toBeInTheDocument();
    expect(document.title).toBe('Checkout Sizing — Retrocks');
  });

  it('shows the Room name in PokerRoomSummary directly', () => {
    const closed: PokerClosedRoomView = {
      closed: true,
      id: 'summaryroom12345678901',
      name: 'Q4 Roadmap Sizing',
      version: 2,
      canDelete: false,
      stories: [],
    };
    render(() => <PokerRoomSummary room={closed} onReopen={vi.fn()} onUnavailable={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Q4 Roadmap Sizing' })).toBeInTheDocument();
  });

  it('records the Room name in Recent Rooms when joined', async () => {
    const room = makeRoom({ id: 'joinedroom123456789012', name: 'Platform Grooming' });
    vi.stubGlobal('EventSource', class extends EventTarget { close() {} });
    stubRouteResponse(room);
    window.history.replaceState(null, '', `/p/${room.id}`);
    render(() => <App />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Platform Grooming' }))
      .toBeInTheDocument();
    expect(document.title).toBe('Platform Grooming — Retrocks');
    await waitFor(() => {
      expect(readRecentPokerRooms()[0]).toMatchObject({ id: room.id, name: 'Platform Grooming' });
    });
  });
});

describe('Inplace top-bar Room name editing', () => {
  it('lets a Facilitator edit via double-click, save on IME-safe Enter or blur, cancel on Escape, and reset blank to Poker Room', async () => {
    const [room, setRoom] = createSignal(makeRoom({ name: 'Sprint 14 Planning' }));
    const change = vi.fn(async (command: PokerRoomChange): Promise<PokerResult> => {
      const current = untrack(room);
      if (command.type === 'rename-room') {
        const next = { ...current, name: command.name.trim() || 'Poker Room', version: current.version + 1 };
        setRoom(next);
        return { ok: true, room: next };
      }
      return { ok: true, room: current };
    });

    render(() => (
      <PokerWorkspace room={room()} online={['alex']} status="live" onUnavailable={vi.fn()} onChange={change} />
    ));

    const heading = screen.getByRole('heading', { level: 1, name: 'Sprint 14 Planning' });
    expect(screen.queryByRole('heading', { name: 'Pointing Poker' })).not.toBeInTheDocument();

    fireEvent.dblClick(heading);
    flush();
    const input = screen.getByRole('textbox', { name: 'Room name' }) as HTMLInputElement;
    expect(input.value).toBe('Sprint 14 Planning');

    fireEvent.input(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    flush();
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Sprint 14 Planning' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rename Room' }));
    flush();
    const editInput = screen.getByRole('textbox', { name: 'Room name' }) as HTMLInputElement;
    fireEvent.input(editInput, { target: { value: 'Payments Estimation' } });
    fireEvent.keyDown(editInput, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(editInput, { key: 'Enter', keyCode: 229 });
    flush();
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Room name' })).toBeInTheDocument();

    fireEvent.keyDown(editInput, { key: 'Enter' });
    await waitFor(() => {
      expect(change).toHaveBeenCalledWith({ type: 'rename-room', name: 'Payments Estimation' });
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Payments Estimation' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rename Room' }));
    flush();
    const resetInput = screen.getByRole('textbox', { name: 'Room name' }) as HTMLInputElement;
    fireEvent.input(resetInput, { target: { value: '   ' } });
    fireEvent.focusOut(resetInput);
    await waitFor(() => {
      expect(change).toHaveBeenCalledWith({ type: 'rename-room', name: 'Poker Room' });
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Poker Room' })).toBeInTheDocument();
  });

  it('cancels Room rename without saving when focusing or clicking the Cancel button', () => {
    const room = makeRoom({ name: 'Sprint 14 Planning' });
    const change = vi.fn(async (): Promise<PokerResult> => ({ ok: true, room }));

    render(() => (
      <PokerWorkspace room={room} online={['alex']} status="live" onUnavailable={vi.fn()} onChange={change} />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Rename Room' }));
    flush();
    const input = screen.getByRole('textbox', { name: 'Room name' }) as HTMLInputElement;
    const cancelButton = screen.getByRole('button', { name: 'Cancel Room rename' });

    fireEvent.input(input, { target: { value: 'Should not save' } });
    fireEvent.focusOut(input, { relatedTarget: cancelButton });
    flush();
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Room name' })).toBeInTheDocument();

    fireEvent.click(cancelButton);
    flush();
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Sprint 14 Planning' })).toBeInTheDocument();
  });

  it('lets a Facilitator open inplace editing via touch double-tap', () => {
    const room = makeRoom({ name: 'Mobile Grooming' });
    render(() => (
      <PokerWorkspace room={room} online={['alex']} status="live" onUnavailable={vi.fn()} onChange={vi.fn()} />
    ));

    const heading = screen.getByRole('heading', { level: 1, name: 'Mobile Grooming' });
    const touch = (type: 'pointerDown' | 'pointerUp') => {
      const event = new Event(type.toLowerCase(), { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        pointerType: { value: 'touch' },
        isPrimary: { value: true },
        pointerId: { value: 1 },
        clientX: { value: 40 },
        clientY: { value: 20 },
      });
      heading.dispatchEvent(event);
    };

    touch('pointerDown');
    touch('pointerUp');
    touch('pointerDown');
    touch('pointerUp');
    flush();

    expect(screen.getByRole('textbox', { name: 'Room name' })).toBeInTheDocument();
  });

  it('renders the Room name read-only for non-Facilitator Participants and reflects live updates', () => {
    const [room, setRoom] = createSignal(
      makeRoom({
        name: 'Sprint 14 Planning',
        viewer: { id: 'sam', displayName: 'Sam', isFacilitator: false },
      }),
    );

    render(() => (
      <PokerWorkspace room={room()} online={['sam']} status="live" onUnavailable={vi.fn()} onChange={vi.fn()} />
    ));

    const heading = screen.getByRole('heading', { level: 1, name: 'Sprint 14 Planning' });
    expect(screen.queryByRole('button', { name: 'Rename Room' })).not.toBeInTheDocument();

    fireEvent.dblClick(heading);
    flush();
    expect(screen.queryByRole('textbox', { name: 'Room name' })).not.toBeInTheDocument();

    setRoom((prev) => ({ ...prev, name: 'Renamed Live', version: 2 }));
    flush();
    expect(screen.getByRole('heading', { level: 1, name: 'Renamed Live' })).toBeInTheDocument();
  });
});
