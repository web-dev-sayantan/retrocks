import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
  createPopoverController,
} from '@ui-sdk/solid/popover';
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from '@ui-sdk/solid/segmented-control';
import { NumberInput, NumberInputControl } from '@ui-sdk/solid/number-input';
import { useShortcut } from '@ui-sdk/solid/shortcuts';
import { Clock, Pause, Volume2, VolumeX, X } from 'lucide';
import { For, Show, createEffect, createMemo, createSignal, createUniqueId, onSettled, untrack } from 'solid-js';

import type { BoardMutationResponse, TimerStateDTO } from '../lib/board-types';
import type { TimerChange } from '../lib/schemas';
import { MAX_TIMER_MINUTES, MIN_TIMER_MINUTES, type ServerClockSample } from '../lib/timer';
import { TIMER_MUTE_STORAGE_KEY, createTimerChime } from '../lib/timer-chime';
import LucideIcon from './LucideIcon';

const MUTE_STORAGE_KEY = TIMER_MUTE_STORAGE_KEY;
const presets = [3, 5, 10, 15];
const controlClass =
  'spring-press board-touch-target cursor-pointer rounded-lg border border-border/80 bg-surface px-2.5 text-xs font-medium text-text hover:bg-surface-subtle board-focus-ring disabled:cursor-not-allowed disabled:opacity-50';

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.ceil(remainingMs / 1_000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function formatSpokenDuration(milliseconds: number): string {
  const totalSeconds = Math.ceil(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const secondLabel = `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
  if (minutes === 0) return secondLabel;
  const minuteLabel = `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  return seconds === 0 ? minuteLabel : `${minuteLabel} and ${secondLabel}`;
}

export default function CountdownTimer(props: {
  timer: TimerStateDTO;
  clock: ServerClockSample | null;
  canControl: boolean;
  onChange: (change: TimerChange) => Promise<BoardMutationResponse>;
}) {
  const durationId = createUniqueId();
  const popover = createPopoverController();
  let durationInput: HTMLInputElement | undefined;
  let panel: HTMLDivElement | undefined;
  let observedDeadline: number | null = null;

  const chime = createTimerChime();
  const [muted, setMuted] = createSignal(false);
  const [sampledAt, setSampledAt] = createSignal(0);
  const [open, setOpen] = createSignal(false);
  const [minutesDraft, setMinutesDraft] = createSignal<number | null>(5);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  const [timerAnnouncement, setTimerAnnouncement] = createSignal('');
  const [announcedDeadline, setAnnouncedDeadline] = createSignal<number | null>(null);

  const remainingMs = createMemo(() => {
    const { endsAt, remainingMs } = props.timer;
    if (endsAt === null) return remainingMs;
    const clock = props.clock;
    if (!clock) return null;
    const elapsed = Math.max(0, sampledAt() - clock.receivedAt);
    return Math.max(0, endsAt - clock.serverNow - elapsed);
  });
  const isRunning = createMemo(() => props.timer.endsAt !== null && (remainingMs() ?? 0) > 0);
  const isPaused = createMemo(() => props.timer.remainingMs !== null);
  const isConfigured = createMemo(() => props.timer.durationMs !== null);
  const hasTimeLeft = createMemo(() => isPaused() || (props.timer.endsAt !== null && remainingMs() !== 0));
  const timerState = createMemo<'idle' | 'running' | 'paused' | 'expired'>(() => {
    if (!isConfigured()) return 'idle';
    if (isPaused()) return 'paused';
    if (isRunning()) return 'running';
    return 'expired';
  });
  const expiryAnnounced = createMemo(() =>
    props.timer.endsAt !== null && props.timer.endsAt === announcedDeadline(),
  );
  const timeLabel = createMemo(() => {
    const remaining = remainingMs();
    return remaining === null ? '–:––' : formatCountdown(remaining);
  });
  const progress = createMemo(() =>
    Math.min(100, 100 * (remainingMs() ?? 0) / (props.timer.durationMs || 1)),
  );
  const validMinutes = createMemo(() => {
    const minutes = minutesDraft();
    return minutes !== null && Number.isInteger(minutes) && minutes >= MIN_TIMER_MINUTES && minutes <= MAX_TIMER_MINUTES;
  });

  createEffect(isRunning, (running) => {
    if (!running) return;
    const sample = () => setSampledAt(performance.now());
    const ticker = setInterval(sample, 100);
    document.addEventListener('visibilitychange', sample);
    return () => {
      clearInterval(ticker);
      document.removeEventListener('visibilitychange', sample);
    };
  });

  createEffect(
    () => [props.timer.endsAt, remainingMs(), announcedDeadline()] as const,
    ([endsAt, remaining, announced]) => {
      if (endsAt === null || remaining === null) {
        observedDeadline = null;
      } else if (remaining > 0) {
        observedDeadline = endsAt;
      } else if (observedDeadline === endsAt && announced !== endsAt) {
        setAnnouncedDeadline(endsAt);
        if (!untrack(muted)) chime.play();
      }
    },
  );

  createEffect(
    () => [props.timer.endsAt, props.timer.remainingMs, props.timer.durationMs] as const,
    ([endsAt, remaining, duration], previous) => {
      if (!previous) return;
      const [oldEndsAt, oldRemaining, oldDuration] = previous;
      if (endsAt === oldEndsAt && remaining === oldRemaining && duration === oldDuration) return;
      if (duration === null) {
        setTimerAnnouncement('Timer dismissed.');
      } else if (remaining !== null) {
        setTimerAnnouncement(oldRemaining === null
          ? 'Timer paused.'
          : `Paused timer updated. ${formatSpokenDuration(remaining)} remaining.`);
      } else if (oldDuration === null) {
        setTimerAnnouncement('Timer started.');
      } else if (oldRemaining !== null) {
        setTimerAnnouncement('Timer resumed.');
      } else {
        setTimerAnnouncement(`Timer updated. ${formatSpokenDuration(duration)} total.`);
      }
    },
  );

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setError('');
  }

  // Page-level "t" opens the popover; the popover's own layer wins while it
  // is open, so the same key closes it there (shortcuts pause under modals).
  useShortcut(
    () => (props.canControl ? 't' : null),
    (event) => {
      void popover.open({ reason: 'shortcut', event });
    },
    { description: 'Toggle countdown timer', when: () => !open() },
  );
  useShortcut(
    () => (props.canControl ? 't' : null),
    (event) => {
      popover.close({ reason: 'shortcut', event });
    },
    { layer: () => panel, description: 'Toggle countdown timer' },
  );

  createEffect(open, (isOpen) => {
    if (isOpen && panel && !panel.contains(document.activeElement)) {
      panel.focus();
    }
  });

  onSettled(() => {
    try {
      setMuted(localStorage.getItem(MUTE_STORAGE_KEY) === 'true');
    } catch {
      // The toggle still works for this tab when storage is unavailable.
    }

    function prepareChime() {
      if (!muted()) chime.prepare();
    }

    function syncMute(event: StorageEvent) {
      if (event.key === MUTE_STORAGE_KEY || event.key === null) {
        setMuted(event.newValue === 'true');
      }
    }

    document.addEventListener('click', prepareChime, true);
    document.addEventListener('keydown', prepareChime, true);
    window.addEventListener('storage', syncMute);
    return () => {
      document.removeEventListener('click', prepareChime, true);
      document.removeEventListener('keydown', prepareChime, true);
      window.removeEventListener('storage', syncMute);
      chime.dispose();
    };
  });

  function toggleMute() {
    const nextMuted = !muted();
    setMuted(nextMuted);
    try {
      localStorage.setItem(MUTE_STORAGE_KEY, String(nextMuted));
    } catch {
      // Keep the in-memory preference.
    }
    if (!nextMuted) chime.prepare();
  }

  async function updateTimer(change: TimerChange) {
    if (!props.canControl || pending()) return;
    setPending(true);
    setError('');
    try {
      const result = await props.onChange(change);
      if (!result.ok) {
        setError(result.message);
      } else if (change.action === 'dismiss') {
        durationInput?.focus();
      }
    } catch {
      setError('Could not update the timer. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div class="shrink-0">
      <Popover controller={popover} open={open()} onOpenChange={handleOpenChange} modal={false}>
        <PopoverTrigger
          aria-label={isConfigured() ? `Countdown Timer, ${isPaused() ? 'paused at ' : ''}${timeLabel()}` : 'Countdown Timer'}
          aria-keyshortcuts={props.canControl ? 'T' : undefined}
          aria-haspopup="dialog"
          data-timer-state={timerState()}
          title={
            isPaused()
              ? `Timer paused at ${timeLabel()}`
              : props.canControl
                ? 'Countdown Timer (T)'
                : 'Countdown Timer'
          }
          class={[
            'spring-press relative inline-flex board-touch-target min-w-[5.75rem] cursor-pointer items-center justify-center gap-1.5 overflow-hidden rounded-full border px-2 text-[13px] sm:px-3 leading-none font-medium text-text tabular-nums transition-colors sm:h-9',
            // Idle on phones: a 44px icon button, not an empty oval; running/paused keeps room for the countdown.
            timerState() === 'idle'
              ? 'max-sm:min-w-11 max-sm:w-11 max-sm:gap-0 max-sm:px-0'
              : 'max-sm:min-w-20 max-sm:w-20 max-sm:gap-1',
            'board-focus-ring',
            timerState() === 'paused'
              ? 'border-col-amber/55 bg-col-amber-tint hover:bg-col-amber-tint'
              : timerState() === 'expired'
                ? 'border-col-rose/55 bg-col-rose-tint hover:bg-col-rose-tint'
                : timerState() === 'running'
                  ? 'border-accent/45 bg-surface hover:bg-surface-subtle'
                  : 'border-border/80 bg-surface hover:bg-surface-subtle',
            expiryAnnounced() && 'motion-safe:animate-[timer-expiry-pulse_1.2s_ease-in-out_2]',
          ]}
        >
          <Show
            when={isPaused()}
            fallback={
              <LucideIcon
                icon={Clock}
                class={['size-3.5 shrink-0', isRunning() ? 'text-accent' : 'text-text-muted']}
                strokeWidth={1.9}
              />
            }
          >
            <span aria-hidden="true" class="inline-flex items-center gap-1 text-col-amber">
              <span class="size-1.5 rounded-full bg-col-amber" />
              <LucideIcon icon={Pause} class="size-3 shrink-0" strokeWidth={2.2} />
            </span>
          </Show>
          <Show when={isConfigured()} fallback={<span class="hidden sm:inline">Timer</span>}>
            <span>{timeLabel()}</span>
            <progress
              aria-hidden="true"
              data-paused={isPaused() ? '' : undefined}
              class="board-timer-progress pointer-events-none absolute inset-x-0 bottom-0 h-0.5 w-full"
              max={100}
              value={progress()}
            />
          </Show>
        </PopoverTrigger>

        <PopoverContent
          ref={panel}
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          initialFocus="content"
          finalFocus="trigger"
          data-board-overlay="true"
          class="board-popover max-h-[calc(100dvh-4rem)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl p-4 text-text focus:outline-none"
        >
          <div class="flex items-center justify-between gap-2">
            <PopoverTitle class="text-sm font-semibold tracking-tight text-text">
              Countdown Timer
            </PopoverTitle>
            <PopoverClose
              aria-label="Close Countdown Timer"
              class="spring-press inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full text-text-muted hover:bg-surface-subtle hover:text-text board-focus-ring sm:size-8 sm:min-h-8 sm:min-w-8"
            >
              <LucideIcon icon={X} class="size-4" strokeWidth={1.9} />
            </PopoverClose>
          </div>
          <Show when={props.canControl}>
            <form
              class="mt-3 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const minutes = minutesDraft();
                if (minutes !== null && validMinutes()) void updateTimer({ action: 'start', minutes });
              }}
            >
              <SegmentedControl<string>
                aria-label="Timer presets"
                value={(() => {
                  const draft = minutesDraft();
                  return draft !== null && presets.includes(draft) ? String(draft) : null;
                })()}
                onValueChange={(next) => {
                  if (next) setMinutesDraft(Number(next));
                }}
                class="segmented-track relative isolate grid grid-cols-4 gap-1 rounded-xl border border-border/75 p-1"
              >
                <SegmentedControlIndicator
                  aria-hidden="true"
                  class="segmented-thumb pointer-events-none rounded-lg"
                />
                <For each={presets}>
                  {(minutes) => (
                    <SegmentedControlItem
                      value={String(minutes)}
                      class={[
                        'spring-press board-touch-target min-w-11 cursor-pointer rounded-lg text-xs font-medium text-text-muted tabular-nums transition-colors sm:min-w-0',
                        'hover:text-text board-focus-ring data-checked:font-semibold data-checked:text-text',
                      ]}
                    >
                      {minutes}m
                    </SegmentedControlItem>
                  )}
                </For>
              </SegmentedControl>
              <div class="flex items-end gap-2">
                <div class="min-w-0 flex-1">
                  <label for={durationId} class="block text-xs font-medium text-text-muted">Minutes</label>
                  <NumberInput
                    value={minutesDraft()}
                    onValueChange={(next) => setMinutesDraft(next)}
                    min={MIN_TIMER_MINUTES}
                    max={MAX_TIMER_MINUTES}
                    step={1}
                  >
                    <NumberInputControl
                      ref={durationInput}
                      id={durationId}
                      required
                      class="mt-1 min-h-11 w-full rounded-lg border border-border/85 bg-canvas px-2.5 text-sm tabular-nums focus:border-focus focus:outline-none sm:min-h-9"
                    />
                  </NumberInput>
                </div>
                <button
                  type="submit"
                  class="spring-press min-h-11 cursor-pointer rounded-lg bg-accent px-3.5 text-xs font-semibold text-accent-contrast hover:opacity-92 board-focus-ring disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9"
                  disabled={pending() || !validMinutes()}
                >
                  {hasTimeLeft() ? 'Restart' : 'Start'}
                </button>
              </div>
            </form>
            <Show when={isConfigured()}>
              <div class="mt-2.5 flex flex-wrap gap-1.5">
                <Show when={hasTimeLeft()}>
                  <button
                    type="button"
                    class={controlClass}
                    disabled={pending()}
                    onClick={() => void updateTimer({ action: isPaused() ? 'resume' : 'pause' })}
                  >
                    {isPaused() ? 'Resume' : 'Pause'}
                  </button>
                </Show>
                <button type="button" class={controlClass} disabled={pending()} onClick={() => void updateTimer({ action: 'extend' })}>+1 min</button>
                <button type="button" class={controlClass} disabled={pending()} onClick={() => void updateTimer({ action: 'dismiss' })}>Dismiss timer</button>
              </div>
            </Show>
            <Show when={error()}><p role="alert" class="mt-2 text-xs text-text">{error()}</p></Show>
          </Show>
          <button
            type="button"
            aria-pressed={muted() ? 'true' : 'false'}
            class={`${controlClass} mt-3 flex w-full items-center justify-between gap-2`}
            onClick={toggleMute}
          >
            <span class="inline-flex items-center gap-1.5">
              <Show
                when={muted()}
                fallback={<LucideIcon icon={Volume2} class="size-3.5 text-text-muted" strokeWidth={1.9} />}
              >
                <LucideIcon icon={VolumeX} class="size-3.5 text-text-muted" strokeWidth={1.9} />
              </Show>
              <span>Mute timer chime</span>
            </span>
            <span aria-hidden="true" class="text-text-muted">{muted() ? 'On' : 'Off'}</span>
          </button>
        </PopoverContent>
      </Popover>
      <span aria-live="polite" aria-atomic="true" class="sr-only">
        {expiryAnnounced() ? 'Time is up.' : timerAnnouncement()}
      </span>
    </div>
  );
}
