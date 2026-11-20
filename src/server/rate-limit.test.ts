import { afterEach, describe, expect, it, vi } from 'vitest';

describe('rate-limit module scope', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('generates no random values while the module is evaluated', async () => {
    // Workers rejects uploads whose global scope calls crypto.getRandomValues
    // (error 10021), so the salt must stay lazy.
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');

    await import('./rate-limit');

    expect(spy).not.toHaveBeenCalled();
  });
});
