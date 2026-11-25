import { Check, ChevronUp, EyeOff, Flag } from 'lucide';

import LucideIcon from '../LucideIcon';
import SnapshotFrame from './SnapshotFrame';

function VoteCount(props: { count: number }) {
  return (
    <span class="mt-1.5 inline-flex items-center gap-0.5 self-end rounded-sm border border-border bg-surface-subtle/60 px-1.5 py-0.5 font-semibold text-accent">
      <LucideIcon icon={ChevronUp} class="size-3 shrink-0" strokeWidth={2} />
      {props.count}
    </span>
  );
}

export default function RetroSnapshot() {
  return (
    <SnapshotFrame
      title="Sprint 42 Retro"
      status={
        <>
          <span class="home-snapshot-pill text-text">
            <LucideIcon icon={EyeOff} class="size-3 shrink-0" />
            Private Mode
          </span>
          <span class="home-snapshot-pill">3 votes left</span>
        </>
      }
    >
      <div class="home-retro-columns grid flex-1 gap-2.5 bg-canvas/70 p-3">
        <div class="home-snapshot-column rounded-md border-t-col-sage">
          <p class="home-snapshot-column-title bg-col-sage-tint">Went Well</p>
          <div class="grid content-start gap-2 p-2">
            <div class="home-snapshot-card">
              <p>Zero-downtime deploy worked</p>
              <VoteCount count={4} />
            </div>
            <div class="home-snapshot-card bg-surface-subtle/40">
              <div class="grid gap-1.5 py-1 opacity-65 blur-[2px]">
                <span class="h-1.5 w-5/6 rounded-full bg-text-muted/65" />
                <span class="h-1.5 w-3/5 rounded-full bg-text-muted/65" />
              </div>
            </div>
          </div>
        </div>

        <div class="home-snapshot-column rounded-md border-t-col-amber">
          <p class="home-snapshot-column-title bg-col-amber-tint">To Improve</p>
          <div class="grid content-start gap-2 p-2">
            <div class="home-snapshot-card">
              <p>Review queue backed up</p>
              <VoteCount count={3} />
            </div>
            <div class="home-snapshot-card">
              <p>Flaky staging seed data</p>
              <VoteCount count={2} />
            </div>
          </div>
        </div>

        <div class="home-snapshot-column home-retro-action-column rounded-md border-t-col-sky">
          <p class="home-snapshot-column-title bg-col-sky-tint">
            <LucideIcon icon={Flag} class="size-3 shrink-0 text-col-sky" />
            Action Items
          </p>
          <div class="home-retro-action-cards grid content-start gap-2 p-2">
            <div class="home-snapshot-card">
              <p>Automate preview envs</p>
              <span class="mt-1.5 inline-flex items-center gap-1 self-start font-semibold text-text-muted">
                <LucideIcon icon={Flag} class="size-3 shrink-0 text-col-sky" />
                Open
              </span>
            </div>
            <div class="home-snapshot-card">
              <p>Trim CI test runtime</p>
              <span class="mt-1.5 inline-flex items-center gap-1 self-start font-semibold text-text-muted">
                <LucideIcon icon={Check} class="size-3 shrink-0" />
                Done
              </span>
            </div>
          </div>
        </div>
      </div>
    </SnapshotFrame>
  );
}
