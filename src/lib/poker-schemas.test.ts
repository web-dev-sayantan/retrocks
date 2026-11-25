import * as v from 'valibot';
import { describe, expect, it } from 'vitest';

import {
  FIBONACCI_DECK,
  POKER_DEFAULT_ROOM_NAME,
  POKER_DISPLAY_NAME_LIMIT,
  POKER_ROOM_NAME_LIMIT,
  POKER_STORY_TITLE_LIMIT,
  PokerCommand,
  PokerDeckChoice,
  PokerDisplayName,
  PokerRoomId,
  PokerRoomNameInput,
  parsePokerLiveMessage,
  type PokerClosedRoomView,
  type PokerLiveRoomView,
} from './poker-schemas';

const ROOM_ID = 'abcdefghijklmnopqrstuv';
const STORY_ID = 'story_0123456789abcdef';
const TARGET_ID = 'target0123456789abcdef';
const ROUND_ID = 'round_0123456789abcdef';
const PARTICIPANT_ID = 'part__0123456789abcdef';

function makeLiveRoom(overrides: Partial<PokerLiveRoomView> = {}): PokerLiveRoomView {
  return {
    closed: false,
    id: ROOM_ID,
    name: 'Sprint 42 Estimation',
    version: 1,
    viewer: { id: PARTICIPANT_ID, displayName: 'Ada', isFacilitator: true },
    facilitatorLinkRevision: 1,
    participants: [{ id: PARTICIPANT_ID, displayName: 'Ada', isFacilitator: true }],
    stories: [{ id: STORY_ID, title: 'Checkout flow', status: 'pending', locked: false }],
    activeStoryId: STORY_ID,
    deck: FIBONACCI_DECK,
    deckType: 'fibonacci',
    round: {
      id: ROUND_ID,
      phase: 'open',
      submittedParticipantIds: [PARTICIPANT_ID],
      ownChoice: '5',
    },
    ...overrides,
  };
}

function makeClosedRoom(overrides: Partial<PokerClosedRoomView> = {}): PokerClosedRoomView {
  return {
    closed: true,
    id: ROOM_ID,
    name: 'Sprint 42 Estimation',
    version: 4,
    canDelete: true,
    stories: [
      { title: 'Checkout flow', status: 'estimated', acceptedEstimate: '5' },
      { title: 'Refund flow', status: 'skipped' },
      { title: 'Audit logs', status: 'pending' },
    ],
    ...overrides,
  };
}

describe('Pointing Poker primitive schemas', () => {
  it('validates 22-character URL-safe Room IDs', () => {
    expect(v.safeParse(PokerRoomId, ROOM_ID).success).toBe(true);
    expect(v.safeParse(PokerRoomId, 'short').success).toBe(false);
    expect(v.safeParse(PokerRoomId, `${ROOM_ID}x`).success).toBe(false);
    expect(v.safeParse(PokerRoomId, 'abcdefghijklmnopqrstu!').success).toBe(false);
  });

  it('trims Display Names and enforces length bounds', () => {
    expect(v.parse(PokerDisplayName, '  Ada  ')).toBe('Ada');
    expect(v.safeParse(PokerDisplayName, '   ').success).toBe(false);
    expect(v.safeParse(PokerDisplayName, 'a'.repeat(POKER_DISPLAY_NAME_LIMIT)).success).toBe(true);
    expect(v.safeParse(PokerDisplayName, 'a'.repeat(POKER_DISPLAY_NAME_LIMIT + 1)).success).toBe(false);
  });

  it('defaults blank Room names to POKER_DEFAULT_ROOM_NAME and rejects over-limit names', () => {
    expect(v.parse(PokerRoomNameInput, '   ')).toBe(POKER_DEFAULT_ROOM_NAME);
    expect(v.parse(PokerRoomNameInput, '  Platform Team  ')).toBe('Platform Team');
    expect(v.safeParse(PokerRoomNameInput, 'r'.repeat(POKER_ROOM_NAME_LIMIT)).success).toBe(true);
    expect(v.safeParse(PokerRoomNameInput, 'r'.repeat(POKER_ROOM_NAME_LIMIT + 1)).success).toBe(false);
  });

  it('coerces finite numbers and trims strings for Deck choices while rejecting non-finite or blank values', () => {
    expect(v.parse(PokerDeckChoice, 5)).toBe('5');
    expect(v.parse(PokerDeckChoice, '  XL  ')).toBe('XL');
    expect(v.safeParse(PokerDeckChoice, '   ').success).toBe(false);
    expect(v.safeParse(PokerDeckChoice, Number.NaN).success).toBe(false);
    expect(v.safeParse(PokerDeckChoice, Number.POSITIVE_INFINITY).success).toBe(false);
  });
});

describe('PokerCommand', () => {
  it('parses all Room command variants and normalizes inputs', () => {
    expect(v.parse(PokerCommand, { type: 'join', displayName: '  Ada  ' })).toEqual({
      type: 'join',
      displayName: 'Ada',
    });
    expect(v.parse(PokerCommand, { type: 'rename-room', name: '   ' })).toEqual({
      type: 'rename-room',
      name: POKER_DEFAULT_ROOM_NAME,
    });
    expect(v.parse(PokerCommand, { type: 'close-room', discardRoundId: ROUND_ID })).toEqual({
      type: 'close-room',
      discardRoundId: ROUND_ID,
    });
    expect(v.parse(PokerCommand, { type: 'reopen-room' })).toEqual({ type: 'reopen-room' });
    expect(v.parse(PokerCommand, { type: 'add-story', title: '  API auth  ', makeActive: true })).toEqual({
      type: 'add-story',
      title: 'API auth',
      makeActive: true,
    });
    expect(
      v.parse(PokerCommand, {
        type: 'correct-estimate',
        storyId: STORY_ID,
        expectedEstimate: 3,
        choice: 5,
      }),
    ).toEqual({
      type: 'correct-estimate',
      storyId: STORY_ID,
      expectedEstimate: '3',
      choice: '5',
    });
    expect(v.parse(PokerCommand, { type: 'return-story', storyId: STORY_ID })).toEqual({
      type: 'return-story',
      storyId: STORY_ID,
    });
    expect(v.parse(PokerCommand, { type: 'edit-story', storyId: STORY_ID, title: '  Renamed  ' })).toEqual({
      type: 'edit-story',
      storyId: STORY_ID,
      title: 'Renamed',
    });
    expect(
      v.parse(PokerCommand, {
        type: 'move-story',
        storyId: STORY_ID,
        targetId: TARGET_ID,
        placement: 'before',
      }),
    ).toEqual({
      type: 'move-story',
      storyId: STORY_ID,
      targetId: TARGET_ID,
      placement: 'before',
    });
    expect(v.parse(PokerCommand, { type: 'select-story', storyId: STORY_ID })).toEqual({
      type: 'select-story',
      storyId: STORY_ID,
    });
    expect(v.parse(PokerCommand, { type: 'set-story-lock', storyId: STORY_ID, locked: true })).toEqual({
      type: 'set-story-lock',
      storyId: STORY_ID,
      locked: true,
    });
    expect(v.parse(PokerCommand, { type: 'delete-story', storyId: STORY_ID })).toEqual({
      type: 'delete-story',
      storyId: STORY_ID,
    });
    expect(v.parse(PokerCommand, { type: 'vote', roundId: ROUND_ID, choice: 8 })).toEqual({
      type: 'vote',
      roundId: ROUND_ID,
      choice: '8',
    });
    expect(v.parse(PokerCommand, { type: 'vote', roundId: ROUND_ID, choice: null })).toEqual({
      type: 'vote',
      roundId: ROUND_ID,
      choice: null,
    });
    expect(v.parse(PokerCommand, { type: 'reveal', roundId: ROUND_ID })).toEqual({
      type: 'reveal',
      roundId: ROUND_ID,
    });
    expect(v.parse(PokerCommand, { type: 'restart-round', roundId: ROUND_ID })).toEqual({
      type: 'restart-round',
      roundId: ROUND_ID,
    });
    expect(v.parse(PokerCommand, { type: 'skip-story', roundId: ROUND_ID })).toEqual({
      type: 'skip-story',
      roundId: ROUND_ID,
    });
    expect(v.parse(PokerCommand, { type: 'confirm-estimate', roundId: ROUND_ID, choice: ' 13 ' })).toEqual({
      type: 'confirm-estimate',
      roundId: ROUND_ID,
      choice: '13',
    });
    expect(v.parse(PokerCommand, { type: 'set-deck', deck: { type: 't-shirt' } })).toEqual({
      type: 'set-deck',
      deck: { type: 't-shirt' },
    });
    expect(
      v.parse(PokerCommand, {
        type: 'set-deck',
        deck: { type: 'custom', choices: [1, ' 2 ', '?'] },
        discardRoundId: ROUND_ID,
      }),
    ).toEqual({
      type: 'set-deck',
      deck: { type: 'custom', choices: ['1', '2', '?'] },
      discardRoundId: ROUND_ID,
    });
  });

  it('rejects unknown commands and invalid payloads', () => {
    expect(v.safeParse(PokerCommand, { type: 'explode' }).success).toBe(false);
    expect(v.safeParse(PokerCommand, { type: 'join', displayName: '   ' }).success).toBe(false);
    expect(
      v.safeParse(PokerCommand, {
        type: 'add-story',
        title: 's'.repeat(POKER_STORY_TITLE_LIMIT + 1),
      }).success,
    ).toBe(false);
    expect(
      v.safeParse(PokerCommand, {
        type: 'move-story',
        storyId: STORY_ID,
        targetId: TARGET_ID,
        placement: 'inside',
      }).success,
    ).toBe(false);
    expect(v.safeParse(PokerCommand, { type: 'select-story', storyId: 'bad-id' }).success).toBe(false);
    expect(v.safeParse(PokerCommand, { type: 'vote', roundId: ROUND_ID, choice: '' }).success).toBe(false);
    expect(v.safeParse(PokerCommand, { type: 'set-deck', deck: { type: 'unknown' } }).success).toBe(false);
    expect(v.safeParse(PokerCommand, { type: 'set-deck', deck: { type: 'custom', choices: ['1'] } }).success).toBe(false);
    expect(
      v.safeParse(PokerCommand, { type: 'set-deck', deck: { type: 'custom', choices: ['5', 5] } }).success,
    ).toBe(false);
    expect(
      v.safeParse(PokerCommand, { type: 'set-deck', deck: { type: 'custom', choices: [' M ', 'M'] } }).success,
    ).toBe(false);
  });
});

describe('parsePokerLiveMessage', () => {
  it('parses live and closed Room snapshots, presence, missing, and heartbeat frames', () => {
    const liveSnapshot = parsePokerLiveMessage(
      JSON.stringify({ type: 'room:snapshot', room: makeLiveRoom(), connectionId: 'conn_1' }),
    );
    expect(liveSnapshot).toMatchObject({
      type: 'room:snapshot',
      connectionId: 'conn_1',
      room: { closed: false, id: ROOM_ID, deckType: 'fibonacci' },
    });

    const revealedSnapshot = parsePokerLiveMessage(
      JSON.stringify({
        type: 'room:snapshot',
        room: makeLiveRoom({
          round: {
            id: ROUND_ID,
            phase: 'revealed',
            ballots: [{ participantId: PARTICIPANT_ID, displayName: 'Ada', choice: '5' }],
          },
        }),
      }),
    );
    expect(revealedSnapshot).toMatchObject({
      type: 'room:snapshot',
      room: { round: { phase: 'revealed', ballots: [{ choice: '5' }] } },
    });

    const closedSnapshot = parsePokerLiveMessage(
      JSON.stringify({ type: 'room:snapshot', room: makeClosedRoom() }),
    );
    expect(closedSnapshot).toMatchObject({
      type: 'room:snapshot',
      room: { closed: true, canDelete: true },
    });

    expect(parsePokerLiveMessage('{"type":"room:missing"}')).toEqual({ type: 'room:missing' });
    expect(parsePokerLiveMessage('{"type":"room:presence","online":["p1"]}')).toEqual({
      type: 'room:presence',
      online: ['p1'],
    });
    expect(parsePokerLiveMessage('{"type":"heartbeat"}')).toEqual({ type: 'heartbeat' });
  });

  it('rejects malformed JSON, unknown frames, and drifted Room snapshots', () => {
    expect(() => parsePokerLiveMessage('not json')).toThrow();
    expect(() => parsePokerLiveMessage('{"type":"room:unknown"}')).toThrow();

    expect(() =>
      parsePokerLiveMessage(
        JSON.stringify({ type: 'room:snapshot', room: { ...makeLiveRoom(), version: 0 } }),
      ),
    ).toThrow();

    expect(() =>
      parsePokerLiveMessage(
        JSON.stringify({ type: 'room:snapshot', room: { ...makeLiveRoom(), deckType: 'invalid' } }),
      ),
    ).toThrow();

    expect(() =>
      parsePokerLiveMessage(
        JSON.stringify({
          type: 'room:snapshot',
          room: {
            ...makeLiveRoom(),
            round: { id: ROUND_ID, phase: 'revealed', submittedParticipantIds: [] },
          },
        }),
      ),
    ).toThrow();

    expect(() =>
      parsePokerLiveMessage(
        JSON.stringify({
          type: 'room:snapshot',
          room: { ...makeClosedRoom(), stories: [{ title: 'Bad', status: 'archived' }] },
        }),
      ),
    ).toThrow();
  });
});
