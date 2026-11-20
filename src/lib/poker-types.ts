export const POKER_LIVE_VIEWER_HEADER = 'x-retrocks-poker-viewer';
export const POKER_DISPLAY_NAME_LIMIT = 60;
export const POKER_STORY_TITLE_LIMIT = 200;
export const FIBONACCI_DECK = ['0', '1', '2', '3', '5', '8', '13', '21'] as const;

export interface PokerParticipant {
  id: string;
  displayName: string;
  isFacilitator: boolean;
}

export interface PokerStory {
  id: string;
  title: string;
  status: 'pending' | 'estimated' | 'skipped';
  acceptedEstimate?: string;
}

export type PokerRoundView =
  | { id: string; phase: 'open'; submittedParticipantIds: string[]; ownChoice: string | null }
  | { id: string; phase: 'revealed' | 'accepted'; ballots: { participantId: string; displayName: string; choice: string }[] };

export interface PokerRoomView {
  id: string;
  version: number;
  viewer: PokerParticipant | null;
  facilitatorLinkRevision?: number;
  participants: PokerParticipant[];
  stories: PokerStory[];
  activeStoryId: string | null;
  deck: readonly string[];
  round: PokerRoundView | null;
}

export type PokerStoryCommand =
  | { type: 'add-story'; title: string }
  | { type: 'edit-story'; storyId: string; title: string }
  | { type: 'move-story'; storyId: string; targetId: string; placement: 'before' | 'after' }
  | { type: 'correct-estimate'; storyId: string; expectedEstimate: string; choice: string }
  | { type: 'return-story'; storyId: string }
  | { type: 'select-story'; storyId: string; discardRoundId?: string };

export type PokerVotingCommand =
  | { type: 'vote'; roundId: string; choice: string | null }
  | { type: 'reveal'; roundId: string }
  | { type: 'restart-round'; roundId: string }
  | { type: 'skip-story'; roundId: string }
  | { type: 'confirm-estimate'; roundId: string; choice: string };

export type PokerRoomCommand =
  | { type: 'join'; displayName: string }
  | PokerStoryCommand
  | PokerVotingCommand;

export type PokerResult<T = PokerRoomView> =
  | { ok: true; room: T }
  | { ok: false; code: 'ROOM_NOT_FOUND' | 'INVALID_INPUT' | 'FORBIDDEN' | 'RATE_LIMITED' | 'ROUND_CHANGED'; message: string };

export type PokerLiveMessage =
  | { type: 'room:snapshot'; room: PokerRoomView; connectionId?: string }
  | { type: 'room:missing' }
  | { type: 'room:presence'; online: string[] }
  | { type: 'heartbeat' };
