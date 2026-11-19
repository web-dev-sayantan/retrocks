import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';

const cloudflareEnvStorage = new AsyncLocalStorage<Cloudflare.Env>();

/**
 * Binds Cloudflare Worker `env` bindings (`BOARD_ROOM`, `BOARD_CREATE_LIMITER`, etc.)
 * to the active async request context without importing `cloudflare:workers`
 * into Node builds or Vitest suites.
 */
export function runWithCloudflareEnv<T>(
  env: Cloudflare.Env,
  fn: () => T,
): T {
  return cloudflareEnvStorage.run(env, fn);
}

/** Returns Cloudflare Worker bindings for the current request, or `undefined` in Node/Vitest. */
export function getCloudflareEnv(): Cloudflare.Env | undefined {
  return cloudflareEnvStorage.getStore();
}
