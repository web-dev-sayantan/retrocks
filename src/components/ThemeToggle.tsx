import { Portal, type JSX } from '@solidjs/web';
import { Moon, Sun } from 'lucide';
import { Show, createSignal, onSettled } from 'solid-js';

import { getSecretTheme, subscribeTheme, toggleTheme, type ActiveTheme } from '../lib/theme';
import LucideIcon from './LucideIcon';

export default function ThemeToggle(props: {
  menuItem?: boolean;
  variant?: 'default' | 'island';
  menuItemProps?: JSX.ButtonHTMLAttributes<HTMLButtonElement>;
}) {
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

  const buttonClass = () => {
    if (props.menuItem) return 'board-menu-item';
    if (props.variant === 'island') {
      return [
        'spring-press inline-flex size-10 cursor-pointer items-center justify-center rounded-full',
        'border border-transparent bg-surface-subtle/75 text-text-muted',
        'hover:border-border/80 hover:bg-surface-subtle hover:text-text active:bg-surface-subtle',
        'board-focus-ring',
      ];
    }
    return [
      'spring-press inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg',
      'border border-border bg-surface text-text-muted',
      'hover:bg-surface-subtle hover:text-text active:bg-surface-subtle',
      'board-focus-ring',
    ];
  };

  function handleClick(event: MouseEvent & { currentTarget: HTMLButtonElement; target: Element }) {
    const menuClick = props.menuItemProps?.onClick;
    if (typeof menuClick === 'function') {
      menuClick(event);
      return;
    }
    toggleTheme();
  }

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
        {...props.menuItemProps}
        onClick={handleClick}
        role={props.menuItemProps?.role ?? (props.menuItem ? 'menuitem' : undefined)}
        tabindex={props.menuItemProps?.tabindex ?? (props.menuItem ? -1 : undefined)}
        aria-pressed={props.menuItem ? undefined : dark() ? 'true' : 'false'}
        aria-label={label()}
        title={label()}
        class={buttonClass()}
      >
        <Show when={props.menuItem}>
          <span>{label()}</span>
        </Show>
        <Show
          when={dark()}
          fallback={<LucideIcon icon={Moon} class="size-4" strokeWidth={1.8} />}
        >
          <LucideIcon icon={Sun} class="size-4" strokeWidth={1.8} />
        </Show>
      </button>
    </>
  );
}
