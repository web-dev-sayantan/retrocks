export const POKER_LIVE_VIEWER_HEADER = 'x-retrocks-poker-viewer';
export const POKER_DISPLAY_NAME_LIMIT = 60;

export interface PokerParticipant {
  id: string;
  displayName: string;
  isFacilitator: boolean;
}

export interface PokerRoomView {
  id: string;
  version: number;
  viewer: PokerParticipant | null;
  participants: PokerParticipant[];
}

export type PokerRoomCommand = { type: 'join'; displayName: string };

export type PokerResult<T = PokerRoomView> =
  | { ok: true; room: T }
  | { ok: false; code: 'ROOM_NOT_FOUND' | 'INVALID_INPUT' | 'RATE_LIMITED'; message: string };

export type PokerLiveMessage =
  | { type: 'room:snapshot'; room: PokerRoomView; connectionId?: string }
  | { type: 'room:missing' }
  | { type: 'room:presence'; online: string[] }
  | { type: 'heartbeat' };
