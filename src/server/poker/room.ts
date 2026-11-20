import 'server-only';

import { safeParse } from 'valibot';

import { PokerDisplayName } from '../../lib/poker-schemas';
import type {
  PokerParticipant,
  PokerResult,
  PokerRoomCommand,
  PokerRoomView,
  PokerStory,
} from '../../lib/poker-types';
import { generateEntityId } from '../crypto';
import type { SqlRunner } from '../db/sql-runner';
import { createBoardWriteRateLimiter } from '../rate-limit';

const ROOM_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const notFound = {
  ok: false,
  code: 'ROOM_NOT_FOUND',
  message: 'This Room is no longer available.',
} as const;

const facilitatorRequired = {
  ok: false,
  code: 'FORBIDDEN',
  message: 'Only a Facilitator can manage Stories.',
} as const;

const storyMissing = {
  ok: false,
  code: 'INVALID_INPUT',
  message: 'That Story is no longer in the queue.',
} as const;

interface StoredParticipant extends PokerParticipant {
  hash: string;
}

export interface StoredPokerRoom {
  id: string;
  version: number;
  expiresAt: number;
  participants: StoredParticipant[];
  stories?: PokerStory[];
  activeStoryId?: string | null;
}

export function pokerDisplayName(input: unknown): string | undefined {
  const parsed = safeParse(PokerDisplayName, input);
  return parsed.success ? parsed.output : undefined;
}

function projectParticipant(p: StoredParticipant): PokerParticipant {
  return { id: p.id, displayName: p.displayName, isFacilitator: p.isFacilitator };
}

export function pokerParticipant(room: StoredPokerRoom, hash: string): PokerParticipant | null {
  const participant = room.participants.find((p) => p.hash === hash);
  return participant ? projectParticipant(participant) : null;
}

export function projectPokerRoom(room: StoredPokerRoom, hash: string): PokerRoomView {
  const viewer = pokerParticipant(room, hash);
  return {
    id: room.id,
    version: room.version,
    viewer,
    participants: viewer ? room.participants.map(projectParticipant) : [],
    stories: viewer ? room.stories ?? [] : [],
    activeStoryId: viewer ? room.activeStoryId ?? null : null,
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

  snapshot(id: string, now = Date.now()): StoredPokerRoom | null {
    if (!this.hasSchema()) return null;
    const row = this.db.get<{ data: string }>(
      'SELECT data FROM poker_rooms WHERE id = ? AND expires_at > ?',
      id,
      now,
    );
    return row ? JSON.parse(row.data) as StoredPokerRoom : null;
  }

  read(id: string, hash: string): PokerRoomView | null {
    const room = this.snapshot(id);
    return room && projectPokerRoom(room, hash);
  }

  create(id: string, hash: string, displayName: string): StoredPokerRoom {
    this.ensureSchema();
    const room: StoredPokerRoom = {
      id,
      version: 1,
      expiresAt: Date.now() + ROOM_TTL_MS,
      participants: [{ id: generateEntityId(), hash, displayName, isFacilitator: true }],
      stories: [],
      activeStoryId: null,
    };
    this.db.run(
      'INSERT INTO poker_rooms (id, expires_at, data) VALUES (?, ?, ?)',
      id,
      room.expiresAt,
      JSON.stringify(room),
    );
    return room;
  }

  mutate(id: string, hash: string, command: PokerRoomCommand): PokerResult<StoredPokerRoom> {
    const now = Date.now();
    if (!this.writeLimiter.check(id, hash, now).allowed) {
      return { ok: false, code: 'RATE_LIMITED', message: 'Too many changes. Try again shortly.' };
    }
    return this.db.transaction(() => {
      const room = this.snapshot(id, now);
      if (!room) return notFound;

      switch (command.type) {
        case 'join': {
          if (pokerParticipant(room, hash)) return { ok: true, room };
          const displayName = pokerDisplayName(command.displayName);
          if (!displayName) {
            return { ok: false, code: 'INVALID_INPUT', message: 'Enter a valid Display Name.' };
          }
          room.participants.push({
            id: generateEntityId(),
            hash,
            displayName,
            isFacilitator: false,
          });
          break;
        }
        case 'add-story': {
          if (!pokerParticipant(room, hash)?.isFacilitator) return facilitatorRequired;
          (room.stories ??= []).push({ id: generateEntityId(), title: command.title, status: 'pending' });
          room.expiresAt = now + ROOM_TTL_MS;
          break;
        }
        case 'edit-story': {
          if (!pokerParticipant(room, hash)?.isFacilitator) return facilitatorRequired;
          const story = room.stories?.find((entry) => entry.id === command.storyId);
          if (!story) return storyMissing;
          if (story.status !== 'pending') {
            return { ok: false, code: 'INVALID_INPUT', message: 'Only pending Stories can be edited.' };
          }
          if (story.title === command.title) return { ok: true, room };
          story.title = command.title;
          room.expiresAt = now + ROOM_TTL_MS;
          break;
        }
        case 'move-story': {
          if (!pokerParticipant(room, hash)?.isFacilitator) return facilitatorRequired;
          const stories = room.stories ?? [];
          const from = stories.findIndex((entry) => entry.id === command.storyId);
          const target = stories.findIndex((entry) => entry.id === command.targetId);
          if (from < 0 || target < 0) return storyMissing;
          if (from === target) return { ok: true, room };
          const insertAt = target + Number(command.placement === 'after') - Number(from < target);
          if (from === insertAt) return { ok: true, room };
          const [story] = stories.splice(from, 1);
          stories.splice(insertAt, 0, story);
          room.expiresAt = now + ROOM_TTL_MS;
          break;
        }
        case 'select-story': {
          if (!pokerParticipant(room, hash)?.isFacilitator) return facilitatorRequired;
          const story = room.stories?.find((entry) => entry.id === command.storyId);
          if (!story) return storyMissing;
          if (story.status !== 'pending') {
            return { ok: false, code: 'INVALID_INPUT', message: 'Choose a pending Story.' };
          }
          if (room.activeStoryId === story.id) return { ok: true, room };
          room.activeStoryId = story.id;
          room.expiresAt = now + ROOM_TTL_MS;
          break;
        }
      }

      room.version += 1;
      this.db.run(
        'UPDATE poker_rooms SET expires_at = ?, data = ? WHERE id = ?',
        room.expiresAt,
        JSON.stringify(room),
        id,
      );
      return { ok: true, room };
    });
  }

  purgeExpired(now = Date.now()): void {
    if (!this.hasSchema()) return;
    this.db.run('DELETE FROM poker_rooms WHERE expires_at <= ?', now);
  }
}
