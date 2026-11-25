import 'server-only';

import { safeParse } from 'valibot';

import { pokerDiscardDecision, type PokerDiscardIntent } from '../../lib/poker-discard-policy';
import { isSamePokerDeck } from '../../lib/poker-deck-policy';
import { PokerDisplayName, PokerRoomNameInput } from '../../lib/poker-schemas';
import {
  POKER_DECK_PRESETS,
  POKER_DEFAULT_ROOM_NAME,
  unresolvedPokerRoundId,
  type PokerDeckType,
  type PokerDeleteResult,
  type PokerParticipant,
  type PokerResult,
  type PokerRoomCommand,
  type PokerRoomView,
  type PokerRoundView,
  type PokerStory,
} from '../../lib/poker-types';
import type { PokerSharingResult } from '../../lib/poker-sharing-types';
import { generateEntityId, tokenHashesMatch } from '../crypto';
import type { SqlRunner } from '../db/sql-runner';
import { createBoardWriteRateLimiter } from '../rate-limit';

const ROOM_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const notFound = {
  ok: false,
  code: 'ROOM_NOT_FOUND',
  message: 'This Room is no longer available.',
} as const;

const roomClosed = {
  ok: false,
  code: 'ROOM_CLOSED',
  message: 'This Room is closed.',
} as const;

const forbidden = {
  ok: false,
  code: 'FORBIDDEN',
  message: 'Facilitator access is required.',
} as const;
export const invalidPokerFacilitatorLink = {
  ok: false,
  code: 'INVALID_LINK',
  message: 'This Co-Facilitator Link is invalid or has expired.',
} as const;
const linkReplaced = {
  ok: false,
  code: 'LINK_REPLACED',
  message: 'The Co-Facilitator Link was already replaced. Show the current link to try again.',
} as const;
const rateLimited = {
  ok: false,
  code: 'RATE_LIMITED',
  message: 'Too many changes. Try again shortly.',
} as const;

export interface PokerFacilitatorCapability {
  hash: string;
  encrypted: string;
  revision: number;
}

const storyMissing = {
  ok: false,
  code: 'INVALID_INPUT',
  message: 'That Story is no longer in the queue.',
} as const;

const storyLocked = {
  ok: false,
  code: 'STORY_LOCKED',
  message: 'Unlock this Story before changing it.',
} as const;

const roundChanged = {
  ok: false,
  code: 'ROUND_CHANGED',
  message: 'The Voting Round has changed. Check the active Story and try again.',
} as const;
const discardRequired = {
  ok: false,
  code: 'ROUND_CHANGED',
  message: 'Confirm that you want to discard the current Voting Round before switching Stories.',
} as const;
const lockDiscardRequired = {
  ok: false,
  code: 'ROUND_CHANGED',
  message: 'Confirm that you want to discard the current Voting Round before locking this Story.',
} as const;
const deleteDiscardRequired = {
  ok: false,
  code: 'ROUND_CHANGED',
  message: 'Confirm that you want to discard the current Voting Round before deleting this Story.',
} as const;
const editDiscardRequired = {
  ok: false,
  code: 'ROUND_CHANGED',
  message: 'Confirm that you want to restart the current Voting Round before editing this Story title.',
} as const;
const deckDiscardRequired = {
  ok: false,
  code: 'ROUND_CHANGED',
  message: 'Confirm that you want to restart the current Voting Round before changing the Deck.',
} as const;

const invalidDeckChoice = {
  ok: false,
  code: 'INVALID_INPUT',
  message: 'Choose a value from the Deck.',
} as const;

interface StoredVotingRound {
  id: string;
  phase: 'open' | 'revealed' | 'accepted';
  ballots: Record<string, string>;
}

function startVotingRound(): StoredVotingRound {
  return { id: generateEntityId(), phase: 'open', ballots: {} };
}

function storedDiscardDecision(
  room: StoredPokerRoom,
  intent: PokerDiscardIntent,
  targetsActiveRound: boolean,
  confirmedRoundId?: string,
) {
  const round = room.round;
  return pokerDiscardDecision(intent, targetsActiveRound, round && {
    id: round.id,
    phase: round.phase,
    hasVotes: Object.keys(round.ballots).length > 0,
  }, confirmedRoundId);
}

function validateActiveRoundDiscard(
  room: StoredPokerRoom,
  command: { type: PokerDiscardIntent; discardRoundId?: string },
  targetsActiveRound: boolean,
  requiredError: typeof roundChanged | typeof discardRequired | typeof lockDiscardRequired
    | typeof deleteDiscardRequired | typeof editDiscardRequired,
) {
  const decision = storedDiscardDecision(room, command.type, targetsActiveRound, command.discardRoundId);
  if (decision.type === 'stale') return roundChanged;
  if (decision.type === 'confirm') return requiredError;
  return null;
}

interface StoredParticipant extends PokerParticipant {
  hash: string;
}

export interface StoredPokerRoom {
  id: string;
  name: string;
  version: number;
  expiresAt: number;
  participants: StoredParticipant[];
  closedAt?: number;
  closedFacilitatorHashes?: string[];
  facilitatorCapability?: PokerFacilitatorCapability;
  pendingFacilitatorClaims?: string[];
  stories: PokerStory[];
  activeStoryId: string | null;
  deck: readonly string[];
  deckType: PokerDeckType;
  round: StoredVotingRound | null;
}

export function pokerDeckContains(room: StoredPokerRoom, choice: string): boolean {
  return room.deck.includes(choice);
}

export function pokerDisplayName(input: unknown): string | undefined {
  const parsed = safeParse(PokerDisplayName, input);
  return parsed.success ? parsed.output : undefined;
}

export function pokerRoomName(input: unknown): string | undefined {
  if (input === undefined || input === null) return POKER_DEFAULT_ROOM_NAME;
  const parsed = safeParse(PokerRoomNameInput, input);
  return parsed.success ? parsed.output : undefined;
}

function projectParticipant(p: StoredParticipant): PokerParticipant {
  return { id: p.id, displayName: p.displayName, isFacilitator: p.isFacilitator };
}

export function pokerParticipant(room: StoredPokerRoom, hash: string): PokerParticipant | null {
  const participant = room.participants.find((p) => p.hash === hash);
  return participant ? projectParticipant(participant) : null;
}

function projectRound(room: StoredPokerRoom, viewerId: string): PokerRoundView | null {
  const round = room.round;
  if (!round) return null;

  if (round.phase === 'open') {
    return {
      id: round.id,
      phase: 'open',
      ownChoice: round.ballots[viewerId] ?? null,
      submittedParticipantIds: Object.keys(round.ballots),
    };
  }

  return {
    id: round.id,
    phase: round.phase,
    ballots: room.participants.flatMap(({ id, displayName }) => {
      const choice = round.ballots[id];
      return choice === undefined ? [] : [{ participantId: id, displayName, choice }];
    }),
  };
}

export function pokerCanDeleteRoom(room: StoredPokerRoom, hash: string): boolean {
  return room.closedAt === undefined
    ? pokerParticipant(room, hash)?.isFacilitator === true
    : room.closedFacilitatorHashes?.includes(hash) === true;
}

export function projectPokerRoom(room: StoredPokerRoom, hash: string): PokerRoomView {
  if (room.closedAt !== undefined) {
    return {
      closed: true,
      id: room.id,
      name: room.name,
      version: room.version,
      canDelete: pokerCanDeleteRoom(room, hash),
      stories: room.stories.map(({ title, status, acceptedEstimate }) => ({
        title, status, ...(acceptedEstimate === undefined ? {} : { acceptedEstimate }),
      })),
    };
  }

  const viewer = pokerParticipant(room, hash);
  return {
    closed: false,
    id: room.id,
    name: room.name,
    version: room.version,
    viewer,
    ...(viewer?.isFacilitator && room.facilitatorCapability
      ? { facilitatorLinkRevision: room.facilitatorCapability.revision }
      : {}),
    participants: viewer ? room.participants.map(projectParticipant) : [],
    stories: viewer ? room.stories : [],
    activeStoryId: viewer ? room.activeStoryId : null,
    deck: viewer ? room.deck : [],
    deckType: viewer ? room.deckType : 'fibonacci',
    round: viewer ? projectRound(room, viewer.id) : null,
  };
}

export class PokerRoomStorage {
  private readonly writeLimiter = createBoardWriteRateLimiter();

  private ready = false;

  constructor(private readonly db: SqlRunner) {}

  private hasSchema(): boolean {
    if (!this.ready) {
      this.ready = Boolean(this.db.get(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'poker_rooms'",
      ));
    }
    return this.ready;
  }

  private ensureSchema(): void {
    if (this.hasSchema()) return;
    this.db.exec(`CREATE TABLE IF NOT EXISTS poker_rooms (
      id TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      data TEXT NOT NULL
    )`);
    this.db.exec('CREATE INDEX IF NOT EXISTS poker_rooms_expiry ON poker_rooms(expires_at)');
    this.ready = true;
  }

  isAvailable(id: string, now = Date.now()): boolean {
    return this.hasSchema() && Boolean(this.db.get(
      'SELECT 1 FROM poker_rooms WHERE id = ? AND expires_at > ?',
      id,
      now,
    ));
  }

  snapshot(id: string, now = Date.now()): StoredPokerRoom | null {
    if (!this.hasSchema()) return null;
    const row = this.db.get<{ data: string }>(
      'SELECT data FROM poker_rooms WHERE id = ? AND expires_at > ?',
      id,
      now,
    );
    if (!row) return null;
    const room = JSON.parse(row.data) as StoredPokerRoom;
    room.name = typeof room.name === 'string' && room.name.trim() ? room.name.trim() : POKER_DEFAULT_ROOM_NAME;
    room.stories ??= [];
    for (const story of room.stories) story.locked ??= false;
    room.activeStoryId ??= null;
    room.deck ??= POKER_DECK_PRESETS.fibonacci;
    room.deckType ??= 'fibonacci';
    room.round ??= null;
    return room;
  }

  read(id: string, hash: string): PokerRoomView | null {
    const room = this.snapshot(id);
    return room && projectPokerRoom(room, hash);
  }

  create(id: string, hash: string, displayName: string, name = POKER_DEFAULT_ROOM_NAME): StoredPokerRoom {
    this.ensureSchema();
    const room: StoredPokerRoom = {
      id,
      name: name.trim() || POKER_DEFAULT_ROOM_NAME,
      version: 1,
      expiresAt: Date.now() + ROOM_TTL_MS,
      participants: [{ id: generateEntityId(), hash, displayName, isFacilitator: true }],
      stories: [],
      activeStoryId: null,
      deck: POKER_DECK_PRESETS.fibonacci,
      deckType: 'fibonacci',
      round: null,
    };
    this.db.run(
      'INSERT INTO poker_rooms (id, expires_at, data) VALUES (?, ?, ?)',
      id,
      room.expiresAt,
      JSON.stringify(room),
    );
    return room;
  }

  mutate(id: string, hash: string, command: PokerRoomCommand): PokerResult<StoredPokerRoom> & { updated?: true } {
    if (!this.writeLimiter.check(id, hash, Date.now()).allowed) return rateLimited;
    return this.db.transaction(() => {
      const now = Date.now();
      const room = this.snapshot(id, now);
      if (!room) return notFound;

      if (room.closedAt !== undefined) {
        if (command.type === 'close-room') {
          return pokerCanDeleteRoom(room, hash) ? { ok: true, room } : forbidden;
        }
        if (command.type !== 'reopen-room') return roomClosed;
        if (!pokerCanDeleteRoom(room, hash)) return forbidden;
        delete room.closedAt;
        room.pendingFacilitatorClaims = [...new Set(room.closedFacilitatorHashes ?? [])];
        delete room.closedFacilitatorHashes;
        room.participants = [];
        delete room.facilitatorCapability;
        room.activeStoryId = null;
        room.round = null;
        for (const story of room.stories) story.locked = true;
        room.expiresAt = now + ROOM_TTL_MS;
        this.save(room);
        return { ok: true, room, updated: true };
      }

      switch (command.type) {
        case 'rename-room': {
          if (!pokerParticipant(room, hash)?.isFacilitator) return forbidden;
          const nextName = command.name.trim() || POKER_DEFAULT_ROOM_NAME;
          if (room.name === nextName) return { ok: true, room };
          room.name = nextName;
          break;
        }
        case 'reopen-room': {
          const isAuthorized = pokerParticipant(room, hash)?.isFacilitator === true
            || room.pendingFacilitatorClaims?.includes(hash) === true;
          return isAuthorized ? { ok: true, room } : forbidden;
        }
        case 'close-room': {
          if (!pokerCanDeleteRoom(room, hash)) return forbidden;
          const discardError = validateActiveRoundDiscard(room, command, true, roundChanged);
          if (discardError) return discardError;
          room.closedAt = now;
          room.closedFacilitatorHashes = [
            ...new Set([
              ...room.participants.filter((p) => p.isFacilitator).map((p) => p.hash),
              ...(room.pendingFacilitatorClaims ?? []),
            ]),
          ];
          room.participants = [];
          delete room.facilitatorCapability;
          delete room.pendingFacilitatorClaims;
          room.activeStoryId = null;
          room.round = null;
          break;
        }
        case 'join': {
          if (pokerParticipant(room, hash)) return { ok: true, room };
          const displayName = pokerDisplayName(command.displayName);
          if (!displayName) {
            return { ok: false, code: 'INVALID_INPUT', message: 'Enter a valid Display Name.' };
          }
          const claimed = room.pendingFacilitatorClaims?.includes(hash) ?? false;
          room.participants.push({ id: generateEntityId(), hash, displayName, isFacilitator: claimed });
          if (claimed) {
            room.pendingFacilitatorClaims = room.pendingFacilitatorClaims?.filter((claim) => claim !== hash);
          }
          break;
        }
        case 'set-deck': {
          if (!pokerParticipant(room, hash)?.isFacilitator) return forbidden;
          const { deck } = command;
          const choices = deck.type === 'custom' ? deck.choices : POKER_DECK_PRESETS[deck.type];
          if (isSamePokerDeck(room, deck.type, choices)) return { ok: true, room };
          const change = storedDiscardDecision(room, command.type, room.activeStoryId !== null, command.discardRoundId);
          if (change.type === 'stale') return roundChanged;
          if (change.type === 'confirm') return deckDiscardRequired;
          room.deckType = deck.type;
          room.deck = choices;
          if (change.type === 'discard') room.round = startVotingRound();
          break;
        }
        case 'add-story': {
          if (!pokerParticipant(room, hash)?.isFacilitator) return forbidden;
          if (command.makeActive) {
            const discardError = validateActiveRoundDiscard(room, command, true, discardRequired);
            if (discardError) return discardError;
            if (room.activeStoryId) {
              const previousStory = room.stories.find((entry) => entry.id === room.activeStoryId);
              if (previousStory) previousStory.locked = true;
            }
            const story: PokerStory = { id: generateEntityId(), title: command.title, status: 'pending', locked: false };
            room.stories.push(story);
            room.activeStoryId = story.id;
            room.round = startVotingRound();
            break;
          }
          room.stories.push({ id: generateEntityId(), title: command.title, status: 'pending', locked: false });
          break;
        }
        case 'edit-story': {
          if (!pokerParticipant(room, hash)?.isFacilitator) return forbidden;
          const story = room.stories.find((entry) => entry.id === command.storyId);
          if (!story) return storyMissing;
          if (story.locked) return storyLocked;
          if (story.title === command.title) return { ok: true, room };
          const isActive = room.activeStoryId === story.id;
          const discardError = validateActiveRoundDiscard(room, command, isActive, editDiscardRequired);
          if (discardError) return discardError;
          story.title = command.title;
          if (isActive && unresolvedPokerRoundId(room.round) !== undefined) {
            room.round = startVotingRound();
          }
          break;
        }
        case 'move-story': {
          if (!pokerParticipant(room, hash)?.isFacilitator) return forbidden;
          const stories = room.stories;
          const from = stories.findIndex((entry) => entry.id === command.storyId);
          const target = stories.findIndex((entry) => entry.id === command.targetId);
          if (from < 0 || target < 0) return storyMissing;
          if (from === target) return { ok: true, room };
          const insertAt = target + Number(command.placement === 'after') - Number(from < target);
          if (from === insertAt) return { ok: true, room };
          const [story] = stories.splice(from, 1);
          stories.splice(insertAt, 0, story);
          break;
        }
        case 'correct-estimate': {
          if (!pokerParticipant(room, hash)?.isFacilitator) return forbidden;
          const story = room.stories?.find((entry) => entry.id === command.storyId);
          if (!story) return storyMissing;
          if (story.locked) return storyLocked;
          if (story.acceptedEstimate !== command.expectedEstimate) {
            return { ok: false, code: 'INVALID_INPUT', message: 'The Accepted Estimate changed. Reopen the editor and try again.' };
          }
          if (!pokerDeckContains(room, command.choice)) return invalidDeckChoice;
          if (story.acceptedEstimate === command.choice) return { ok: true, room };
          story.acceptedEstimate = command.choice;
          break;
        }
        case 'return-story': {
          if (!pokerParticipant(room, hash)?.isFacilitator) return forbidden;
          const story = room.stories?.find((entry) => entry.id === command.storyId);
          if (!story) return storyMissing;
          if (story.locked) return storyLocked;
          if (story.status === 'pending') return { ok: true, room };
          if (story.status !== 'skipped') {
            return { ok: false, code: 'INVALID_INPUT', message: 'Choose a skipped Story.' };
          }
          story.status = 'pending';
          break;
        }
        case 'select-story': {
          if (!pokerParticipant(room, hash)?.isFacilitator) return forbidden;
          const story = room.stories.find((entry) => entry.id === command.storyId);
          if (!story) return storyMissing;
          if (story.locked) return storyLocked;
          if (story.status === 'skipped') {
            return { ok: false, code: 'INVALID_INPUT', message: 'Return this Story to the queue before selecting it.' };
          }
          const decision = storedDiscardDecision(room, command.type, true, command.discardRoundId);
          if (decision.type === 'stale') return roundChanged;
          if (room.round && room.activeStoryId === story.id) return { ok: true, room };
          if (decision.type === 'confirm') return discardRequired;
          room.activeStoryId = story.id;
          room.round = startVotingRound();
          break;
        }
        case 'set-story-lock': {
          if (!pokerParticipant(room, hash)?.isFacilitator) return forbidden;
          const story = room.stories.find((entry) => entry.id === command.storyId);
          if (!story) return storyMissing;
          const isActive = room.activeStoryId === story.id;
          if (command.locked) {
            const discardError = validateActiveRoundDiscard(room, command, isActive, lockDiscardRequired);
            if (discardError) return discardError;
            if (story.locked && !isActive) return { ok: true, room };
            story.locked = true;
            if (isActive) {
              room.activeStoryId = null;
              room.round = null;
            }
          } else {
            if (!story.locked) return { ok: true, room };
            story.locked = false;
          }
          break;
        }
        case 'delete-story': {
          if (!pokerParticipant(room, hash)?.isFacilitator) return forbidden;
          const index = room.stories.findIndex((entry) => entry.id === command.storyId);
          if (index < 0) return storyMissing;
          const story = room.stories[index];
          if (story.locked) return storyLocked;
          const isActive = room.activeStoryId === story.id;
          const discardError = validateActiveRoundDiscard(room, command, isActive, deleteDiscardRequired);
          if (discardError) return discardError;
          room.stories.splice(index, 1);
          if (isActive) {
            room.activeStoryId = null;
            room.round = null;
          }
          break;
        }
        case 'vote': {
          const participant = pokerParticipant(room, hash);
          if (!participant) return { ok: false, code: 'FORBIDDEN', message: 'Join the Room to vote.' };
          const round = room.round;
          if (round?.id !== command.roundId || round.phase !== 'open') return roundChanged;
          const { choice } = command;
          if (choice !== null && !pokerDeckContains(room, choice)) {
            return invalidDeckChoice;
          }
          if ((round.ballots[participant.id] ?? null) === choice) return { ok: true, room };
          if (choice === null) delete round.ballots[participant.id];
          else round.ballots[participant.id] = choice;
          break;
        }
        case 'reveal': {
          if (!pokerParticipant(room, hash)?.isFacilitator) return forbidden;
          const round = room.round;
          if (round?.id !== command.roundId || round.phase !== 'open') return roundChanged;
          if (Object.keys(round.ballots).length === 0) {
            return { ok: false, code: 'INVALID_INPUT', message: 'At least one vote is required to reveal.' };
          }
          round.phase = 'revealed';
          break;
        }
        case 'restart-round': {
          if (!pokerParticipant(room, hash)?.isFacilitator) return forbidden;
          const round = room.round;
          if (round?.id !== command.roundId || round.phase === 'open') return roundChanged;
          room.round = startVotingRound();
          break;
        }
        case 'skip-story': {
          if (!pokerParticipant(room, hash)?.isFacilitator) return forbidden;
          const round = room.round;
          if (round?.id !== command.roundId || round.phase !== 'revealed') return roundChanged;
          const story = room.stories?.find((entry) => entry.id === room.activeStoryId);
          if (!story) return storyMissing;
          if (story.acceptedEstimate === undefined) story.status = 'skipped';
          room.activeStoryId = null;
          room.round = null;
          break;
        }
        case 'confirm-estimate': {
          if (!pokerParticipant(room, hash)?.isFacilitator) return forbidden;
          const round = room.round;
          if (round?.id !== command.roundId || round.phase !== 'revealed') return roundChanged;
          const story = room.stories?.find((entry) => entry.id === room.activeStoryId);
          if (!story) return storyMissing;
          if (!pokerDeckContains(room, command.choice)) return invalidDeckChoice;

          story.acceptedEstimate = command.choice;
          story.status = 'estimated';
          round.phase = 'accepted';
          break;
        }
      }

      if (room.closedAt !== undefined) room.expiresAt = room.closedAt + ROOM_TTL_MS;
      else if (command.type !== 'join') room.expiresAt = Math.max(room.expiresAt, now + ROOM_TTL_MS);
      this.save(room);
      return { ok: true, room, updated: true };
    });
  }

  delete(id: string, hash: string): PokerDeleteResult {
    return this.db.transaction(() => {
      const room = this.snapshot(id);
      if (!room) return notFound;
      if (!pokerCanDeleteRoom(room, hash)) return forbidden;
      this.db.run('DELETE FROM poker_rooms WHERE id = ?', id);
      return { ok: true };
    });
  }

  getFacilitatorCapability(id: string, hash: string): PokerSharingResult<PokerFacilitatorCapability | null> {
    const room = this.snapshot(id);
    if (!room) return notFound;
    if (!pokerParticipant(room, hash)?.isFacilitator) return forbidden;
    return { ok: true, value: room.facilitatorCapability ?? null };
  }

  replaceFacilitatorCapability(
    id: string,
    hash: string,
    expectedRevision: number,
    capability: PokerFacilitatorCapability,
  ): PokerSharingResult<StoredPokerRoom> {
    return this.db.transaction(() => {
      const room = this.snapshot(id);
      if (!room) return notFound;
      if (!pokerParticipant(room, hash)?.isFacilitator) return forbidden;
      if ((room.facilitatorCapability?.revision ?? 0) !== expectedRevision) return linkReplaced;
      if (!this.writeLimiter.check(id, hash, Date.now()).allowed) return rateLimited;

      room.facilitatorCapability = capability;
      this.save(room);
      return { ok: true, value: room };
    });
  }

  claimFacilitator(id: string, hash: string, candidate: string): PokerSharingResult<StoredPokerRoom> {
    const now = Date.now();
    if (!this.writeLimiter.check(id, hash, now).allowed) return rateLimited;
    return this.db.transaction(() => {
      const room = this.snapshot(id, now);
      if (!room?.facilitatorCapability || !tokenHashesMatch(candidate, room.facilitatorCapability.hash)) {
        return invalidPokerFacilitatorLink;
      }

      const participant = room.participants.find((entry) => entry.hash === hash);
      if (participant?.isFacilitator || room.pendingFacilitatorClaims?.includes(hash)) {
        return { ok: true, value: room };
      }
      if (participant) participant.isFacilitator = true;
      else (room.pendingFacilitatorClaims ??= []).push(hash);
      this.save(room);
      return { ok: true, value: room };
    });
  }

  private save(room: StoredPokerRoom): void {
    room.version += 1;
    this.db.run(
      'UPDATE poker_rooms SET expires_at = ?, data = ? WHERE id = ?',
      room.expiresAt,
      JSON.stringify(room),
      room.id,
    );
  }

  purgeExpired(now = Date.now()): void {
    if (!this.hasSchema()) return;
    this.db.run('DELETE FROM poker_rooms WHERE expires_at <= ?', now);
  }
}
