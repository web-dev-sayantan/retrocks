import { Portal } from '@solidjs/web';
import { Show, createSignal, onSettled } from 'solid-js';

import { getSecretTheme, subscribeTheme, toggleTheme, type ActiveTheme } from '../lib/theme';

export default function ThemeToggle(props: { menuItem?: boolean }) {
  // Start with light to match SSR, then sync with the pre-painted document.
  const [theme, setTheme] = createSignal<ActiveTheme>('light');
  const [announcement, setAnnouncement] = createSignal<string | null>(null);

  onSettled(() => subscribeTheme((active, message) => {
    setTheme(active);
    setAnnouncement(message);
  }));

  const dark = () => theme() === 'dark' || getSecretTheme(theme())?.colorScheme === 'dark';
  const label = () => {
    const secret = getSecretTheme(theme());
    if (secret) return `Exit ${secret.name} theme`;
    return dark() ? 'Switch to light theme' : 'Switch to dark theme';
  };

  return (
    <>
      <Show when={announcement() !== null}>
        <Portal>
          <div role="status" aria-live="polite" aria-atomic="true" data-print-hide="true">
            <Show when={announcement()}>
              <p class="theme-unlock-toast">{announcement()}</p>
            </Show>
          </div>
        </Portal>
      </Show>
      <button
        type="button"
        onClick={toggleTheme}
        role={props.menuItem ? 'menuitem' : undefined}
        tabindex={props.menuItem ? -1 : undefined}
        aria-pressed={props.menuItem ? undefined : dark() ? 'true' : 'false'}
        aria-label={label()}
        title={label()}
        class={props.menuItem ? 'board-menu-item' : [
          'inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg',
          'border border-border bg-surface text-text-muted transition-colors',
          'hover:bg-surface-subtle hover:text-text active:bg-surface-subtle',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        ]}
      >
        <Show when={props.menuItem}>
          <span>{label()}</span>
        </Show>
        <Show
          when={dark()}
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
    </>
  );
}
