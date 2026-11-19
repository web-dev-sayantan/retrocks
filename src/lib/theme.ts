export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'retrocks-theme';

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

export function readDocumentTheme(): Theme {
  const current = document.documentElement.dataset.theme;
  if (current === 'dark' || current === 'light') {
    return current;
  }
  const prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return resolveTheme(readStoredTheme(), prefersDark);
}

export function applyTheme(
  theme: Theme,
  options?: { persist?: boolean },
): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;

  if (options?.persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage unavailable (e.g., restricted private browsing)
    }
  }
}
