import type { JSX } from '@solidjs/web';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleDot,
  Layers,
  Lock,
  Play,
  Plus,
  Share2,
  SquareCheck,
  Trash2,
  Users,
} from 'lucide';
import { For } from 'solid-js';

import { POKER_DEFAULT_ROOM_NAME } from '../../lib/poker-types';
import LucideIcon from '../LucideIcon';
import './poker-snapshot.css';

const deck = ['XS', 'S', 'M', 'L', 'XL'] as const;
const votedChoices = new Set<string>(['S', 'M']);
const activeStory = 'Add webhook retries';

export interface PokerSnapshotProps {
  roomName?: string;
  displayName?: string;
  footer?: JSX.Element;
  decorative?: boolean;
}

export default function PokerSnapshot(props: PokerSnapshotProps) {
  const roomTitle = () => props.roomName?.trim() || POKER_DEFAULT_ROOM_NAME;
  const selfName = () => props.displayName?.trim() || 'Sam';

  const ballots = () => [
    { name: selfName(), value: 'S', self: true, consensus: true },
    { name: 'Priya', value: 'S', self: false, consensus: true },
    { name: 'Alex', value: 'M', self: false, consensus: false },
  ];

  return (
    <div
      aria-hidden={props.decorative === false ? undefined : 'true'}
      class="home-preview-frame poker-snapshot flex min-w-0 flex-col overflow-clip rounded-lg border border-border bg-canvas select-none"
    >
      {/* Top room bar */}
      <div class="poker-snap-bar">
        <div class="flex min-w-0 flex-wrap items-center gap-1.5">
          <p class="max-w-[14rem] truncate text-[13px] font-semibold tracking-[-0.015em] text-text">
            {roomTitle()}
          </p>
          <span class="poker-snap-chip poker-snap-chip-deck">
            <LucideIcon icon={Layers} class="size-3 shrink-0 text-text-muted" strokeWidth={1.9} />
            <span>T-shirt</span>
            <LucideIcon icon={ChevronDown} class="size-2.5 shrink-0 text-text-muted" strokeWidth={2} />
          </span>
          <span class="poker-snap-chip">
            <LucideIcon icon={Users} class="size-3 shrink-0 text-accent" strokeWidth={2} />
            <span>4</span>
          </span>
        </div>

        <div class="flex shrink-0 items-center gap-1.5 text-text-muted">
          <span class="poker-snap-share">
            <LucideIcon icon={Share2} class="size-3 shrink-0" strokeWidth={1.9} />
            <span>Share</span>
          </span>
          <span class="h-3.5 w-px bg-border/70" />
          <LucideIcon icon={SquareCheck} class="size-3.5 shrink-0" strokeWidth={1.85} />
          <LucideIcon icon={Trash2} class="size-3.5 shrink-0" strokeWidth={1.85} />
        </div>
      </div>

      {/* Split queue rail + stage */}
      <div class="poker-snap-split flex-1">
        {/* Left Story queue rail */}
        <div class="poker-snap-rail">
          <div class="flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-text-muted">
            <div class="flex min-w-0 items-center gap-1.5">
              <p class="shrink-0 font-semibold">Story queue</p>
              <span class="poker-snap-mobile-only shrink-0 text-[10px]">1/3</span>
              <span class="poker-snap-mobile-only truncate text-[10px] font-normal">{activeStory}</span>
            </div>
            <span class="poker-snap-desktop-only shrink-0">1 / 3</span>
            <LucideIcon icon={ChevronDown} class="poker-snap-mobile-only size-3 shrink-0" strokeWidth={2} />
          </div>

          <div class="poker-snap-queue-body">
            <div class="grid gap-1.5 px-2.5 pb-2">
              <div class="poker-snap-input">Add a Story…</div>
              <div class="flex gap-1.5">
                <span class="poker-snap-quick-btn poker-snap-quick-btn-primary">
                  <LucideIcon icon={Plus} class="size-2.5 shrink-0" strokeWidth={2.2} />
                  <span>Queue</span>
                </span>
                <span class="poker-snap-quick-btn">
                  <LucideIcon icon={Play} class="size-2.5 shrink-0" strokeWidth={2.1} />
                  <span>Publish</span>
                </span>
              </div>
            </div>

            <div class="flex-1 py-0.5">
              <div class="poker-snap-row">
                <div class="flex items-center gap-2">
                  <LucideIcon icon={CheckCircle2} class="size-3 shrink-0 text-accent" strokeWidth={2.2} />
                  <p class="min-w-0 flex-1 truncate text-[11px] font-medium text-text-muted">
                    Export CSV summary
                  </p>
                  <span class="inline-flex shrink-0 items-center gap-1 text-text-muted">
                    <LucideIcon icon={Lock} class="size-2.5" strokeWidth={2} />
                    <span class="rounded-full bg-surface-subtle px-1.5 py-0.5 text-[10px] font-semibold leading-none text-text">
                      M
                    </span>
                  </span>
                </div>
              </div>

              <div class="poker-snap-row">
                <div class="flex items-center gap-2">
                  <LucideIcon icon={Circle} class="size-3 shrink-0 text-text-muted/70" strokeWidth={2} />
                  <p class="min-w-0 flex-1 truncate text-[11px] font-medium text-text-muted">
                    Filter by owner tag
                  </p>
                  <LucideIcon icon={Lock} class="size-2.5 shrink-0 text-text-muted" strokeWidth={2} />
                </div>
              </div>

              <div class="poker-snap-row poker-snap-row-active">
                <div class="flex items-center gap-2">
                  <LucideIcon icon={CircleDot} class="size-3 shrink-0 text-accent" strokeWidth={2.2} />
                  <p class="min-w-0 flex-1 truncate text-[11px] font-semibold text-text">
                    {activeStory}
                  </p>
                </div>
                <div class="mt-1.5 flex items-center gap-1.5 text-text-muted">
                  <span class="poker-snap-row-pill">Selected</span>
                  <LucideIcon icon={Lock} class="size-2.5 shrink-0" strokeWidth={2} />
                  <LucideIcon icon={Trash2} class="size-2.5 shrink-0" strokeWidth={2} />
                  <span class="ms-auto inline-flex items-center gap-1">
                    <LucideIcon icon={ChevronUp} class="size-3 shrink-0" strokeWidth={2} />
                    <LucideIcon icon={ChevronDown} class="size-3 shrink-0 opacity-45" strokeWidth={2} />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Voting stage */}
        <div class="poker-snap-stage">
          <div class="flex flex-col items-center gap-1">
            <p class="text-[11px] font-medium text-text-muted">Revealed votes</p>
            <p class="text-[14px] font-semibold tracking-[-0.025em] text-text text-balance">
              {activeStory}
            </p>
            <div class="poker-snap-spread">
              <span>
                <strong class="font-semibold text-text">S</strong> ×2
              </span>
              <span class="opacity-35">/</span>
              <span>
                <strong class="font-semibold text-text">M</strong> ×1
              </span>
            </div>
          </div>

          <div class="flex flex-col items-center gap-1.5">
            <div class="poker-snap-seats">
              <For each={ballots()}>
                {(ballot) => (
                  <div class="flex flex-col items-center gap-1">
                    <span
                      class="poker-snap-seat-card"
                      data-self={ballot.self ? 'true' : undefined}
                      data-consensus={ballot.consensus ? 'true' : undefined}
                    >
                      {ballot.value}
                    </span>
                    <span
                      class={[
                        'inline-flex max-w-[6.5rem] items-center gap-1 text-[10px]',
                        ballot.self ? 'poker-snap-seat-self' : 'font-medium text-text',
                      ]}
                    >
                      <span class="size-1.5 shrink-0 rounded-full bg-accent" />
                      <span class="truncate">
                        {ballot.name}
                        {ballot.self ? ' (you)' : ''}
                      </span>
                    </span>
                  </div>
                )}
              </For>
            </div>
            <p class="text-[10px] text-text-muted">Did not vote: Maya</p>
          </div>

          <div class="poker-snap-hand">
            <p class="text-[10px] font-semibold text-text-muted">Accepted Estimate</p>
            <div class="poker-snap-deck">
              <For each={deck}>
                {(value) => (
                  <span
                    class="poker-snap-tile"
                    data-voted-hint={votedChoices.has(value) ? 'true' : undefined}
                  >
                    {value}
                  </span>
                )}
              </For>
            </div>
            <span class="poker-snap-confirm">Confirm estimate</span>
            <div class="flex flex-wrap items-center justify-center gap-3 text-[10px] font-medium text-text-muted">
              <span>Start fresh round</span>
              <span>Skip Story</span>
            </div>
          </div>
        </div>
      </div>

      {props.footer}
    </div>
  );
}
