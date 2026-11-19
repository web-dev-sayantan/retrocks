import 'server-only';
import { env } from 'virtual:solid-env/server';

import { getCloudflareEnv } from './cloudflare-context';
import {
  createCloudflareBoardRealtime,
  createCloudflareBoardStore,
} from './cloudflare/cloudflare-board-store';
import { createNodeBoardRealtime } from './node/sse-board-realtime';
import {
  createNodeBoardStore,
  type NodeBoardStore,
} from './node/sqlite-board-store';
import type { BoardRealtime, BoardStore } from './types';

let testStoreOverride: BoardStore | null = null;
let nodeStorePromise: Promise<NodeBoardStore> | null = null;

/** Replaces the active `BoardStore` in server tests; pass `null` to restore default resolution. */
export function setBoardStoreForTests(store: BoardStore | null): void {
  testStoreOverride = store;
}

/**
 * Resolves the active `BoardStore` for the current runtime:
 * - Cloudflare Workers (`BOARD_ROOM` Durable Object binding present) → `CloudflareBoardStore`
 * - Node / Vitest → lazily initialized `NodeBoardStore` (`node:sqlite`)
 */
export async function getBoardStore(): Promise<BoardStore> {
  if (testStoreOverride) {
    return testStoreOverride;
  }

  const cfEnv = getCloudflareEnv();
  if (cfEnv?.BOARD_ROOM) {
    return createCloudflareBoardStore(cfEnv.BOARD_ROOM);
  }

  if (!nodeStorePromise) {
    const dbPath =
      process.env.VITEST ? ':memory:' : (env.DATABASE_URL ?? './data/retrocks.sqlite');
    nodeStorePromise = createNodeBoardStore(dbPath);
  }
  return nodeStorePromise;
}

const nodeRealtime = createNodeBoardRealtime(getBoardStore);

export function getBoardRealtime(): BoardRealtime {
  const cfEnv = getCloudflareEnv();
  return cfEnv?.BOARD_ROOM
    ? createCloudflareBoardRealtime(cfEnv.BOARD_ROOM)
    : nodeRealtime;
}
