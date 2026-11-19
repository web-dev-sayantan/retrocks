import { Title } from '@solidjs/meta';

export default function Home() {
  return (
    <main class="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      <Title>Retrocks — Instant, Privacy-First Retrospectives</Title>
      <section class="rounded-2xl border border-border bg-surface p-8 shadow-xs sm:p-10">
        <p class="text-xs font-medium tracking-wide text-text-muted uppercase">
          Zero login · Privacy-first · Free
        </p>
        <h1 class="mt-3 text-3xl font-semibold tracking-tight text-text sm:text-4xl">
          Collaborative retrospective boards, ready in seconds.
        </h1>
        <p class="mt-4 max-w-2xl text-base text-text-muted">
          Create a shareable Board with no accounts, no personal information,
          and no tracking. Private Mode, Voting, Card Groups, Action Items, and
          exports included.
        </p>
      </section>
    </main>
  );
}
