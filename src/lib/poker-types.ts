export const POKER_LIVE_VIEWER_HEADER = 'x-retrocks-poker-viewer';
export const POKER_DISPLAY_NAME_LIMIT = 60;
export const POKER_STORY_TITLE_LIMIT = 200;
export const FIBONACCI_DECK = ['0', '1', '2', '3', '5', '8', '13', '21'] as const;

export const POKER_DECK_PRESETS = {
  fibonacci: FIBONACCI_DECK,
  't-shirt': ['XS', 'S', 'M', 'L', 'XL'],
} as const;

export type PokerDeckPreset = keyof typeof POKER_DECK_PRESETS;
export type PokerDeckType = PokerDeckPreset | 'custom';
export type PokerDeckCommand = {
  type: 'set-deck';
  deck: { type: PokerDeckPreset } | { type: 'custom'; choices: string[] };
};

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
  deckType: PokerDeckType;
  deckLocked: boolean;
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

export type PokerRoomChange = PokerStoryCommand | PokerVotingCommand | PokerDeckCommand;

export type PokerRoomCommand = { type: 'join'; displayName: string } | PokerRoomChange;

export type PokerResult<T = PokerRoomView> =
  | { ok: true; room: T }
  | { ok: false; code: 'ROOM_NOT_FOUND' | 'INVALID_INPUT' | 'FORBIDDEN' | 'RATE_LIMITED' | 'ROUND_CHANGED' | 'DECK_LOCKED'; message: string };

export type PokerLiveMessage =
  | { type: 'room:snapshot'; room: PokerRoomView; connectionId?: string }
  | { type: 'room:missing' }
  | { type: 'room:presence'; online: string[] }
  | { type: 'heartbeat' };
