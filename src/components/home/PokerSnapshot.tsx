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
      <div class="home-poker-layout grid flex-1 bg-canvas/70">
        <div class="home-poker-rail grid min-w-0 content-start border-b border-border/70 p-2.5">
          <div class="mb-2 flex items-center justify-between gap-2 text-text-muted">
            <p class="font-semibold">Story queue</p>
            <span>1 / 3</span>
          </div>
          <div class="home-poker-row home-poker-row-active">
            <span class="size-1.5 shrink-0 rounded-full bg-accent" />
            <p class="min-w-0 flex-1 font-semibold text-text">{activeStory}</p>
          </div>
          <div class="home-poker-row">
            <span class="size-1.5 shrink-0 rounded-full bg-accent/80" />
            <p class="min-w-0 flex-1 text-text">Export CSV summary</p>
            <span class="rounded-full bg-surface-subtle px-1.5 py-0.5 text-[10px] font-semibold text-text">5</span>
          </div>
          <div class="home-poker-row">
            <span class="size-1.5 shrink-0 rounded-full border border-control" />
            <p class="min-w-0 flex-1 text-text-muted">Filter by owner tag</p>
          </div>
        </div>

        <div class="flex min-w-0 flex-col items-center justify-between gap-3 p-3 text-center">
          <div class="grid justify-items-center gap-0.5">
            <p class="text-[10px] font-medium text-text-muted">Revealed votes</p>
            <p class="text-sm font-semibold tracking-tight text-text">{activeStory}</p>
          </div>

          <div class="flex flex-wrap justify-center gap-2.5">
            <For each={ballots}>
              {(ballot) => (
                <div class="grid justify-items-center gap-1">
                  <span
                    class={[
                      'grid h-8 w-6 place-items-center rounded-md border bg-surface text-xs font-bold',
                      ballot.value === 5 ? 'border-accent text-accent' : 'border-border text-text',
                    ]}
                  >
                    {ballot.value}
                  </span>
                  <span class="text-[10px] text-text-muted">{ballot.name}</span>
                </div>
              )}
            </For>
          </div>

          <div class="flex w-full justify-center gap-1 border-t border-border/60 pt-2.5">
            <For each={deck}>
              {(value) => (
                <span
                  class={[
                    'grid h-8 w-6 place-items-center rounded-md border font-semibold',
                    value === 5
                      ? '-translate-y-0.5 border-accent bg-accent text-accent-contrast'
                      : 'border-border bg-surface text-text',
                  ]}
                >
                  {value}
                </span>
              )}
            </For>
          </div>
        </div>
      </div>
    </SnapshotFrame>
  );
}
