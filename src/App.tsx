import { Title } from '@solidjs/meta';
import { useLocation } from '@solidjs/router';
import { Errored, Loading, Show, type ParentProps } from 'solid-js';
import { env } from 'virtual:solid-env/client';

import './App.css';
import BoardRobotsMeta from './components/BoardRobotsMeta';
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
        <header class="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur-sm">
          <div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
            <a
              href={paths()}
              class={[
                'inline-flex items-center gap-2 rounded-md text-sm font-semibold tracking-tight text-text',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
              ]}
            >
              <span
                aria-hidden="true"
                class="inline-block h-2.5 w-2.5 rounded-sm bg-accent"
              />
              <span>{env.VITE_APP_NAME}</span>
            </a>
            <ThemeToggle />
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
    </>
  );
}

export default function App() {
  return (
    <Router>{(props) => <AppShell>{props.children}</AppShell>}</Router>
  );
}
