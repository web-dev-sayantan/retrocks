import { For } from 'solid-js';

import SnapshotFrame from './SnapshotFrame';

const deck = [1, 2, 3, 5, 8, 13];
const ballots = [
  { name: 'Sam', value: 5 },
  { name: 'Priya', value: 5 },
  { name: 'Alex', value: 8 },
  { name: 'Maya', value: 5 },
];
const activeStory = 'Add webhook retries';

export default function PokerSnapshot() {
  return (
    <SnapshotFrame
      title="Pointing Poker"
      status={
        <>
          <span class="home-snapshot-pill">Fibonacci</span>
          <span class="home-snapshot-pill">
            <span class="size-1.5 shrink-0 rounded-full bg-accent" />
            4 online
          </span>
        </>
      }
    >
      <div class="home-poker-layout grid flex-1 gap-2.5 bg-canvas/70 p-3">
        <div class="min-w-0 rounded-lg border border-border bg-surface">
          <div class="grid gap-0.5 rounded-t-lg border-b border-border/70 bg-surface-subtle/75 px-2.5 py-2">
            <p class="text-text-muted">Active Story</p>
            <p class="font-semibold">{activeStory}</p>
          </div>
          <div class="grid gap-2.5 p-2.5">
            <div class="grid grid-cols-6 gap-1">
              <For each={deck}>
                {(value) => (
                  <span class={[
                    'rounded-md border py-1.5 text-center font-semibold',
                    value === 5 ? 'border-accent bg-accent text-accent-contrast' : 'border-border bg-canvas/80',
                  ]}>
                    {value}
                  </span>
                )}
              </For>
            </div>
            <div class="grid grid-cols-2 gap-1.5">
              <For each={ballots}>
                {(ballot) => (
                  <span class="flex items-center justify-between gap-1 rounded-md border border-border/70 bg-canvas/70 px-1.5 py-1">
                    {ballot.name} <strong class="font-semibold">{ballot.value}</strong>
                  </span>
                )}
              </For>
            </div>
          </div>
        </div>

        <div class="grid min-w-0 content-start gap-1.5 rounded-lg border border-border bg-surface p-2.5">
          <p class="mb-0.5 font-semibold">Story queue</p>
          <div class="home-story-row border-accent/45 bg-surface-subtle/60">
            <p class="font-semibold">{activeStory}</p>
            <p class="text-text-muted">Revealed</p>
          </div>
          <div class="home-story-row border-border/80 bg-canvas/70">
            <p>Export CSV summary</p>
            <p class="text-text-muted">Accepted Estimate <strong class="font-semibold text-text">5</strong></p>
          </div>
          <div class="home-story-row border-border/80 bg-canvas/70">
            <p>Filter by owner tag</p>
            <p class="text-text-muted">Pending</p>
          </div>
        </div>
      </div>
    </SnapshotFrame>
  );
}
