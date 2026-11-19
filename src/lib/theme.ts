import { SECRET_THEMES } from './easter-eggs';

export type Theme = 'light' | 'dark';
type SecretTheme = (typeof SECRET_THEMES)[number];
export type ActiveTheme = Theme | SecretTheme['id'];

export const THEME_STORAGE_KEY = 'retrocks-theme';

const BURST_LENGTH = 7;
const BURST_WINDOW_MS = 3_000;
const UNLOCK_NOTICE_MS = 2_800;
const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

type ThemeSubscriber = (theme: ActiveTheme, announcement: string | null) => void;

const subscribers = new Set<ThemeSubscriber>();
let recentClicks: number[] = [];
let nextSecretThemeIndex = 0;
let standardTheme: Theme = 'light';
let mediaQuery: MediaQueryList | undefined;
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

export function resolveTheme(
  stored: string | null | undefined,
  prefersDark: boolean,
): Theme {
  if (stored === 'dark' || stored === 'light') {
    return stored;
  }
  return prefersDark ? 'dark' : 'light';
}

export function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'dark' || stored === 'light' ? stored : null;
  } catch {
    return null;
  }
}

function readDocumentTheme(): ActiveTheme {
  const current = document.documentElement.dataset.theme;
  if (current === 'dark' || current === 'light') {
    return current;
  }
  return getSecretTheme(current)?.id ??
    resolveTheme(readStoredTheme(), mediaQuery?.matches ?? false);
}

function applyStandardTheme(theme: Theme, persist: boolean): void {
  standardTheme = theme;
  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage unavailable (e.g., restricted private browsing)
    }
  }
  applyTheme(theme, theme);
}

function applyTheme(theme: ActiveTheme, colorScheme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = colorScheme;
  notifySubscribers(theme);
}

function notifySubscribers(theme: ActiveTheme): void {
  // The first mounted control hosts the single live region for all controls.
  const announcer = subscribers.values().next().value;
  for (const subscriber of subscribers) {
    subscriber(theme, subscriber === announcer ? announcement : null);
  }
}

function clearAnnouncement(): void {
  clearTimeout(announcementTimer);
  announcementTimer = undefined;
  announcement = '';
}

function handleSystemChange(event: MediaQueryListEvent): void {
  if (readStoredTheme() === null && !getSecretTheme(readDocumentTheme())) {
    applyStandardTheme(event.matches ? 'dark' : 'light', false);
  }
}

export function subscribeTheme(subscriber: ThemeSubscriber): () => void {
  if (subscribers.size === 0) {
    mediaQuery = window.matchMedia?.(DARK_SCHEME_QUERY);
    mediaQuery?.addEventListener('change', handleSystemChange);
  }
  subscribers.add(subscriber);
  subscriber(readDocumentTheme(), subscribers.size === 1 ? announcement : null);

  return () => {
    const wasAnnouncer = subscribers.values().next().value === subscriber;
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      mediaQuery?.removeEventListener('change', handleSystemChange);
      mediaQuery = undefined;
      recentClicks = [];
      clearAnnouncement();
    } else if (wasAnnouncer) {
      notifySubscribers(readDocumentTheme());
    }
  };
}

export function toggleTheme(): void {
  const now = performance.now();
  recentClicks = recentClicks.filter((time) => now - time <= BURST_WINDOW_MS);
  recentClicks.push(now);

  if (recentClicks.length === BURST_LENGTH) {
    recentClicks.length = 0;
    const secret = SECRET_THEMES[nextSecretThemeIndex]!;
    nextSecretThemeIndex = (nextSecretThemeIndex + 1) % SECRET_THEMES.length;
    announcement = `${secret.name} unlocked. Select the theme toggle again to exit.`;
    announcementTimer = setTimeout(() => {
      clearAnnouncement();
      notifySubscribers(readDocumentTheme());
    }, UNLOCK_NOTICE_MS);
    applyTheme(secret.id, secret.colorScheme);
    return;
  }

  clearAnnouncement();
  const active = readDocumentTheme();
  const current = active === 'light' || active === 'dark' ? active : standardTheme;
  applyStandardTheme(current === 'dark' ? 'light' : 'dark', true);
}
