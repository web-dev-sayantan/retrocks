import { createColorScheme, createLocalStorage, createPreference } from '@ui-sdk/core';

import { SECRET_THEMES } from './easter-eggs';

export type Theme = 'light' | 'dark';
type SecretTheme = (typeof SECRET_THEMES)[number];
export type ActiveTheme = Theme | SecretTheme['id'];

export const THEME_STORAGE_KEY = 'retrocks-theme';

const BURST_LENGTH = 7;
const BURST_WINDOW_MS = 3_000;
const UNLOCK_NOTICE_MS = 2_800;

type ThemeSubscriber = (theme: ActiveTheme, announcement: string | null) => void;

// The standard light/dark choice: storage-backed through the ui-sdk color
// scheme preference, whose 'system' default follows the browser until the
// first explicit toggle persists a choice.
const colorScheme = createColorScheme({
  storage: createLocalStorage(THEME_STORAGE_KEY),
});

// The active secret-theme override. Never persisted — reloading drops it, so
// the storage key only ever holds a standard scheme.
const secretTheme = createPreference({
  values: ['none', ...SECRET_THEMES.map((secret) => secret.id)],
  defaultValue: 'none',
  attribute: 'data-theme',
});

const subscribers = new Set<ThemeSubscriber>();
let recentClicks: number[] = [];
let nextSecretThemeIndex = 0;
let announcement = '';
let announcementTimer: ReturnType<typeof setTimeout> | undefined;

export function getSecretTheme(theme: string | undefined): SecretTheme | undefined {
  return SECRET_THEMES.find((secret) => secret.id === theme);
}

/**
 * Tiny synchronous inline script embedded in `<head>` by `src/Document.tsx`
 * so the saved or system theme is applied to `<html data-theme="...">`
 * before first paint (zero FOUC).
 */
export const THEME_INIT_SCRIPT = `(function(){var s=null;try{s=localStorage.getItem('${THEME_STORAGE_KEY}');}catch(e){}var t=(s==='dark'||s==='light')?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');var r=document.documentElement;r.dataset.theme=t;r.style.colorScheme=t;})();`;

function resolvedStandardTheme(): Theme {
  return colorScheme.get().resolved === 'dark' ? 'dark' : 'light';
}

function activeSecretTheme(): SecretTheme | undefined {
  return getSecretTheme(secretTheme.get().value);
}

function readDocumentTheme(): ActiveTheme {
  const current = document.documentElement.dataset.theme;
  if (current === 'dark' || current === 'light') {
    return current;
  }
  return getSecretTheme(current)?.id ?? resolvedStandardTheme();
}

function applyTheme(): void {
  const secret = activeSecretTheme();
  const theme: ActiveTheme = secret ? secret.id : resolvedStandardTheme();
  const scheme: Theme = secret ? secret.colorScheme : resolvedStandardTheme();
  const root = document.documentElement;
  // Preference subscriptions also call this; apply once per state.
  if (root.dataset.theme === theme && root.style.colorScheme === scheme) return;
  root.dataset.theme = theme;
  root.style.colorScheme = scheme;
  notifySubscribers();
}

function notifySubscribers(): void {
  // The first mounted control hosts the single live region for all controls.
  const announcer = subscribers.values().next().value;
  for (const subscriber of subscribers) {
    subscriber(readDocumentTheme(), subscriber === announcer ? announcement : null);
  }
}

function clearAnnouncement(): void {
  clearTimeout(announcementTimer);
  announcementTimer = undefined;
  announcement = '';
}

function syncTheme(): void {
  applyTheme();
}

let unsubscribeScheme: (() => void) | undefined;
let unsubscribeSecret: (() => void) | undefined;

export function subscribeTheme(subscriber: ThemeSubscriber): () => void {
  if (subscribers.size === 0) {
    // The first subscription starts watching the stored choice, the browser's
    // scheme, and the secret-theme override.
    unsubscribeScheme = colorScheme.subscribe(syncTheme);
    unsubscribeSecret = secretTheme.subscribe(syncTheme);
  }
  subscribers.add(subscriber);
  subscriber(readDocumentTheme(), subscribers.size === 1 ? announcement : null);

  return () => {
    const wasAnnouncer = subscribers.values().next().value === subscriber;
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      unsubscribeScheme?.();
      unsubscribeSecret?.();
      unsubscribeScheme = undefined;
      unsubscribeSecret = undefined;
      recentClicks = [];
      clearAnnouncement();
    } else if (wasAnnouncer) {
      notifySubscribers();
    }
  };
}

export function toggleTheme(): void {
  const now = performance.now();
  recentClicks = recentClicks.filter((time) => now - time <= BURST_WINDOW_MS);
  recentClicks.push(now);

  if (recentClicks.length === BURST_LENGTH) {
    recentClicks.length = 0;
    // The index is kept in range by the modulo below; no assertion needed.
    const secret = SECRET_THEMES[nextSecretThemeIndex];
    nextSecretThemeIndex = (nextSecretThemeIndex + 1) % SECRET_THEMES.length;
    announcement = `${secret.name} unlocked. Select the theme toggle again to exit.`;
    announcementTimer = setTimeout(() => {
      clearAnnouncement();
      notifySubscribers();
    }, UNLOCK_NOTICE_MS);
    secretTheme.set(secret.id);
    applyTheme();
    return;
  }

  clearAnnouncement();
  // Leaving a secret theme flips the standard scheme that was active before
  // it; the painted document is the source of truth for that direction.
  const active = readDocumentTheme();
  const current: Theme = active === 'light' || active === 'dark'
    ? active
    : resolvedStandardTheme();
  secretTheme.set('none');
  colorScheme.set(current === 'dark' ? 'light' : 'dark');
  applyTheme();
}
