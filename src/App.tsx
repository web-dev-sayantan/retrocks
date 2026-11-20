import { OverlayHost } from '@ui-sdk/solid/overlays';
import { Title } from '@solidjs/meta';
import { useLocation } from '@solidjs/router';
import { Clock, Columns3, ShieldCheck } from 'lucide';
import { Errored, Loading, Show, type ParentProps } from 'solid-js';
import { env } from 'virtual:solid-env/client';

import './App.css';
import BoardConfirmDialog from './components/BoardConfirmDialog';
import BoardRobotsMeta from './components/BoardRobotsMeta';
import LucideIcon from './components/LucideIcon';
import PageMessage from './components/PageMessage';
import ThemeToggle from './components/ThemeToggle';
import { isBoardPathname } from './lib/routes';
import { Router, paths } from './router';

function AppShell(props: ParentProps) {
  const location = useLocation();

  return (
    <>
      <Title>{env.VITE_APP_NAME}</Title>
      <BoardRobotsMeta pathname={location.pathname} />
      <Show when={!isBoardPathname(location.pathname)}>
        <header class="pointer-events-none sticky top-0 z-30 px-4 pt-3 pb-1 sm:px-6 sm:pt-4">
          <div class="mx-auto flex max-w-6xl justify-center">
            <div class="home-island pointer-events-auto inline-flex w-full max-w-md items-center justify-between gap-2 rounded-full px-2 py-1.5 sm:w-auto sm:max-w-none sm:gap-2.5">
              <a
                href={paths()}
                class={[
                  'spring-press inline-flex min-h-10 items-center gap-2 rounded-full pl-2 pr-3 text-sm font-semibold tracking-tight text-text',
                  'hover:bg-surface-subtle/80 active:bg-surface-subtle',
                  'board-focus-ring',
                ]}
              >
                <span
                  aria-hidden="true"
                  class="inline-flex size-6 items-center justify-center rounded-full bg-accent text-accent-contrast"
                >
                  <LucideIcon icon={Columns3} class="size-3.5" strokeWidth={2.1} />
                </span>
                <span>{env.VITE_APP_NAME}</span>
              </a>

              <span aria-hidden="true" class="hidden h-4 w-px bg-border/80 sm:block" />

              <div class="hidden items-center gap-1.5 sm:flex">
                <span class="inline-flex items-center gap-1.5 rounded-full bg-surface-subtle/85 px-2.5 py-1 text-xs font-medium text-text-muted">
                  <LucideIcon icon={ShieldCheck} class="size-3.5 text-accent" strokeWidth={1.9} />
                  <span>Zero-login</span>
                </span>
                <span class="inline-flex items-center gap-1.5 rounded-full bg-surface-subtle/85 px-2.5 py-1 text-xs font-medium text-text-muted">
                  <LucideIcon icon={Clock} class="size-3.5 text-text-muted" strokeWidth={1.9} />
                  <span>Ready in seconds</span>
                </span>
              </div>

              <span aria-hidden="true" class="hidden h-4 w-px bg-border/80 sm:block" />

              <ThemeToggle variant="island" />
            </div>
          </div>
        </header>
      </Show>
      <Errored
        fallback={(error, reset) => (
          <PageMessage
            title="Something went wrong"
            message={error instanceof Error ? error.message : 'An unexpected error occurred.'}
          >
            <button type="button" onClick={reset} class="page-message-action">
              Try again
            </button>
          </PageMessage>
        )}
      >
        <Loading
          fallback={
            <main class="mx-auto flex min-h-[60vh] max-w-6xl items-center justify-center px-6 py-16">
              <p class="text-sm text-text-muted">Loading…</p>
            </main>
          }
        >
          {props.children}
        </Loading>
      </Errored>
      <OverlayHost />
      <BoardConfirmDialog />
    </>
  );
}

export default function App() {
  return (
    <Router>{(props) => <AppShell>{props.children}</AppShell>}</Router>
  );
}
