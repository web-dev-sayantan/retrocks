import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { fireEvent, render } from '@solidjs/testing-library';
import { flush } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from '../lib/theme';
import ThemeToggle from './ThemeToggle';

function mockMatchMedia(prefersDark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mql = {
    matches: prefersDark,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn((_type: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.add(cb);
    }),
    removeEventListener: vi.fn((_type: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.delete(cb);
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn(() => mql),
  });

  return { mql, listeners };
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = '';
  mockMatchMedia(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('zero-FOUC theme init script', () => {
  it('applies saved dark or light preference from localStorage before first paint', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');

    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('falls back to system prefers-color-scheme when localStorage is empty or invalid', () => {
    mockMatchMedia(true);
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.dataset.theme).toBe('dark');

    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    mockMatchMedia(false);
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('falls back safely when localStorage throws', () => {
    mockMatchMedia(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => new Function(THEME_INIT_SCRIPT)()).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('<ThemeToggle />', () => {
  it('syncs to pre-applied theme, toggles data-theme, and persists to localStorage', () => {
    document.documentElement.dataset.theme = 'dark';
    const { getByRole } = render(() => <ThemeToggle />);
    flush();

    const button = getByRole('button');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('aria-label', 'Switch to light theme');

    fireEvent.click(button);
    flush();

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveAttribute('aria-label', 'Switch to dark theme');

    fireEvent.click(button);
    flush();

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles with zero Solid 2.0 reactivity diagnostics', async () => {
    const { artifact } = await captureArtifact(
      () => {
        const { getByRole } = render(() => <ThemeToggle />);
        flush();
        const button = getByRole('button');
        fireEvent.click(button);
        flush();
        expect(document.documentElement.dataset.theme).toBe('dark');
      },
      { scenario: 'theme-toggle-click' },
    );
    expectNoDiagnostics(artifact);
  });
});
