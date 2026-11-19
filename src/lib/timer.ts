export const MIN_TIMER_MINUTES = 1;
export const MAX_TIMER_MINUTES = 60;
export const MS_PER_MINUTE = 60_000;

export interface ServerClockSample {
  serverNow: number;
  receivedAt: number;
}
