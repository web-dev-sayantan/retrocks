export type LiveHeartbeatMessage = { type: 'heartbeat' };

export const LIVE_CONNECTION_HEADER = 'x-retrocks-live-connection';
export const LIVE_HEARTBEAT_MS = 30_000;
export const LIVE_HEARTBEAT_TIMEOUT_MS = 2 * LIVE_HEARTBEAT_MS + 5_000;
