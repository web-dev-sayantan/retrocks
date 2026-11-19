import { Show, createSignal, onSettled } from 'solid-js';

import {
  applyTheme,
  readDocumentTheme,
  readStoredTheme,
  type Theme,
} from '../lib/theme';

export default function ThemeToggle(props: { menuItem?: boolean }) {
  // Always start with 'light' to match SSR output without hydration mismatch;
  // onSettled syncs immediately with the pre-painted `data-theme` attribute.
  const [theme, setTheme] = createSignal<Theme>('light');

  onSettled(() => {
    const initial = readDocumentTheme();
    setTheme(initial);

    if (typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = (event: MediaQueryListEvent) => {
      if (readStoredTheme() !== null) {
        return;
      }
      const next: Theme = event.matches ? 'dark' : 'light';
      applyTheme(next);
      setTheme(next);
    };

    mediaQuery.addEventListener('change', handleSystemChange);
    return () => {
      mediaQuery.removeEventListener('change', handleSystemChange);
    };
  });

  const handleToggle = () => {
    const next: Theme = theme() === 'dark' ? 'light' : 'dark';
    applyTheme(next, { persist: true });
    setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      role={props.menuItem ? 'menuitem' : undefined}
      aria-pressed={theme() === 'dark' ? 'true' : 'false'}
      aria-label={
        theme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
      }
      title={
        theme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
      }
      class={props.menuItem ? 'board-menu-item' : [
        'inline-flex h-11 w-11 cursor-pointer sm:h-9 sm:w-9 items-center justify-center rounded-lg',
        'border border-border bg-surface text-text-muted transition-colors',
        'hover:bg-surface-subtle hover:text-text',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
      ]}
    >
      <Show when={props.menuItem}>
        <span>{theme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}</span>
      </Show>
      <Show
        when={theme() === 'dark'}
        fallback={
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="h-4 w-4"
          >
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
          </svg>
        }
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-4 w-4"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </svg>
      </Show>
    </button>
  );
}
