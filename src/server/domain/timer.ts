import 'server-only';

import type { TimerStateDTO } from '../../lib/board-types';
import type { TimerChange } from '../../lib/schemas';
import { MS_PER_MINUTE } from '../../lib/timer';
import type { RawBoardRow } from '../db/raw-types';

export function applyTimerChange(
  board: RawBoardRow,
  change: TimerChange,
  now: number,
): TimerStateDTO | null {
  const { timerEndsAt: endsAt, timerRemainingMs: remainingMs, timerDurationMs: durationMs } = board;

  switch (change.action) {
    case 'start': {
      const durationMs = change.minutes * MS_PER_MINUTE;
      return { endsAt: now + durationMs, remainingMs: null, durationMs };
    }
    case 'pause':
      if (endsAt === null || endsAt <= now) return null;
      return { endsAt: null, remainingMs: endsAt - now, durationMs };
    case 'resume':
      if (remainingMs === null || remainingMs <= 0) return null;
      return { endsAt: now + remainingMs, remainingMs: null, durationMs };
    case 'extend':
      if (durationMs === null) return null;
      if (remainingMs !== null) {
        return { endsAt: null, remainingMs: remainingMs + MS_PER_MINUTE, durationMs: durationMs + MS_PER_MINUTE };
      }
      return { endsAt: Math.max(now, endsAt ?? now) + MS_PER_MINUTE, remainingMs: null, durationMs: durationMs + MS_PER_MINUTE };
    case 'dismiss':
      if (durationMs === null) return null;
      return { endsAt: null, remainingMs: null, durationMs: null };
  }
}
