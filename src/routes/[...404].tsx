import { Title } from '@solidjs/meta';
import type { RouteDefinition } from '@solidjs/router';
import { httpStatus } from '@solidjs/web';

import { paths } from '../router';

export const route = {
  preload: () => httpStatus(404),
} satisfies RouteDefinition;

export default function NotFound() {
  return (
    <main class="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
      <Title>Page Not Found — Retrocks</Title>
      <p class="text-xs font-medium tracking-wide text-text-muted uppercase tabular-nums">
        404
      </p>
      <h1 class="mt-2 text-2xl font-semibold tracking-tight text-text">
        Page not found
      </h1>
      <p class="mt-3 text-sm text-text-muted">
        The page you requested does not exist or may have expired.
      </p>
      <a
        href={paths()}
        class={[
          'mt-6 inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-contrast',
          'transition-opacity hover:opacity-90',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        ]}
      >
        Back to Retrocks
      </a>
    </main>
  );
}
