import { OverlayHost } from '@ui-sdk/solid/overlays';
import { Toast, ToastDescription, ToastTitle } from '@ui-sdk/solid/toast';
import { Title } from '@solidjs/meta';
import { useLocation } from '@solidjs/router';
import { Columns3 } from 'lucide';
import { Errored, Loading, Show, type ParentProps } from 'solid-js';
import { env } from 'virtual:solid-env/client';

import './App.css';
import BoardConfirmDialog from './components/BoardConfirmDialog';
import BoardRobotsMeta from './components/BoardRobotsMeta';
import LucideIcon from './components/LucideIcon';
import PageMessage from './components/PageMessage';
import ThemeToggle from './components/ThemeToggle';
import { isPokerRoomPathname, pokerSetupPath } from './lib/poker-routes';
import { isBoardPathname, retroSetupPath } from './lib/routes';
import { Router, paths } from './router';

function AppShell(props: ParentProps) {
  const location = useLocation();
  const isPokerActive = () => location.pathname === pokerSetupPath || isPokerRoomPathname(location.pathname);

  return (
    <>
      <Title>{env.VITE_APP_NAME}</Title>
      <BoardRobotsMeta pathname={location.pathname} />
      <Show when={!isBoardPathname(location.pathname)}>
        <header class="pointer-events-none sticky top-0 z-30 px-4 pt-3 pb-1 sm:px-6 sm:pt-4 print:hidden">
          <div class="mx-auto flex max-w-6xl justify-center">
            <div class="home-island pointer-events-auto inline-flex w-full max-w-md items-center justify-between gap-1.5 rounded-full px-2 py-1.5 sm:w-auto sm:max-w-none sm:gap-2.5">
              <a
                href={paths()}
                aria-current={location.pathname === '/' ? 'page' : undefined}
                class="home-nav-link spring-press board-focus-ring board-touch-target gap-1.5 pl-2 pr-2.5 text-sm font-semibold tracking-tight sm:gap-2 sm:pr-3"
              >
                <span
                  aria-hidden="true"
                  class="inline-flex size-6 items-center justify-center rounded-full bg-accent text-accent-contrast"
                >
                  <LucideIcon icon={Columns3} class="size-3.5" strokeWidth={2.1} />
                </span>
                <span>{env.VITE_APP_NAME}</span>
              </a>

              <span aria-hidden="true" class="h-4 w-px shrink-0 bg-border/80" />

              <nav aria-label="Retrocks tools" class="flex items-center gap-1">
                <a
                  href={retroSetupPath}
                  aria-label="Retrospectives"
                  aria-current={location.pathname === retroSetupPath ? 'page' : undefined}
                  class="home-nav-link spring-press board-focus-ring board-touch-target px-2.5 text-[13px] font-medium sm:px-3"
                >
                  <span>Retro<span class="hidden min-[420px]:inline">spectives</span></span>
                </a>
                <a
                  href={pokerSetupPath}
                  aria-label="Pointing Poker"
                  aria-current={isPokerActive() ? 'page' : undefined}
                  class="home-nav-link spring-press board-focus-ring board-touch-target px-2.5 text-[13px] font-medium sm:px-3"
                >
                  <span><span class="hidden min-[420px]:inline">Pointing&nbsp;</span>Poker</span>
                </a>
              </nav>

              <span aria-hidden="true" class="h-4 w-px shrink-0 bg-border/80" />

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
      <OverlayHost
        toast={{
          align: 'center',
          children: () => (
            <Toast class="board-toast rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text shadow-lg">
              <ToastTitle />
              <ToastDescription />
            </Toast>
          ),
        }}
      />
      <BoardConfirmDialog />
    </>
  );
}

export default function App() {
  return (
    <Router>{(props) => <AppShell>{props.children}</AppShell>}</Router>
  );
}
