import { For, Show, createEffect, createMemo, createSignal, createUniqueId, onSettled, untrack } from 'solid-js';

import type { BoardMutationResponse, TimerStateDTO } from '../lib/board-types';
import {
  hasOpenBoardOverlay,
  isTypingInEditableElement,
} from '../lib/board-view';
import type { TimerChange } from '../lib/schemas';
import { MAX_TIMER_MINUTES, MIN_TIMER_MINUTES, type ServerClockSample } from '../lib/timer';
import { createTimerChime } from '../lib/timer-chime';
import { CloseIcon } from './Icons';

const MUTE_STORAGE_KEY = 'retrocks-timer-muted';
const presets = [3, 5, 10, 15];
const controlClass =
  'min-h-11 rounded-lg border border-border px-2.5 text-xs font-medium text-text hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 sm:min-h-9';

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.ceil(remainingMs / 1_000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export default function CountdownTimer(props: {
  timer: TimerStateDTO;
  clock: ServerClockSample | null;
  canControl: boolean;
  onChange: (change: TimerChange) => Promise<BoardMutationResponse>;
}) {
  const panelId = createUniqueId();
  const titleId = createUniqueId();
  const durationId = createUniqueId();
  let root!: HTMLDivElement;
  let trigger!: HTMLButtonElement;
  let panel: HTMLDivElement | undefined;
  let durationInput: HTMLInputElement | undefined;
  let observedDeadline: number | null = null;

  const chime = createTimerChime();
  const [muted, setMuted] = createSignal(false);
  const [sampledAt, setSampledAt] = createSignal(0);
  const [open, setOpen] = createSignal(false);
  const [minutesDraft, setMinutesDraft] = createSignal('5');
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
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
    const minutes = Number(minutesDraft());
    return Number.isInteger(minutes) && minutes >= MIN_TIMER_MINUTES && minutes <= MAX_TIMER_MINUTES;
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

  createEffect(open, (isOpen) => {
    if (isOpen) panel?.focus();
  });

  function closePanel(restoreFocus: boolean) {
    setOpen(false);
    setError('');
    if (restoreFocus) trigger.focus();
  }

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

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      if (open() && event.key === 'Escape') {
        event.preventDefault();
        closePanel(true);
        return;
      }
      if (!props.canControl || event.repeat || event.key.toLowerCase() !== 't' ||
          event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTypingInEditableElement(event)) return;
      if (open()) {
        event.preventDefault();
        closePanel(true);
        return;
      }
      if (hasOpenBoardOverlay()) return;
      event.preventDefault();
      setOpen(true);
    }

    function handlePointerDown(event: PointerEvent) {
      if (open() && event.target instanceof Node && !root.contains(event.target)) {
        closePanel(false);
      }
    }

    document.addEventListener('click', prepareChime, true);
    document.addEventListener('keydown', prepareChime, true);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('storage', syncMute);
    return () => {
      document.removeEventListener('click', prepareChime, true);
      document.removeEventListener('keydown', prepareChime, true);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
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
    <div
      ref={root}
      class="shrink-0 sm:relative"
      onFocusOut={(event) => {
        if (open() && event.relatedTarget instanceof Node &&
            !event.currentTarget.contains(event.relatedTarget)) {
          closePanel(false);
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={isConfigured() ? `Countdown Timer, ${isPaused() ? 'paused at ' : ''}${timeLabel()}` : 'Countdown Timer'}
        aria-keyshortcuts={props.canControl ? 'T' : undefined}
        aria-haspopup="dialog"
        aria-expanded={open() ? 'true' : 'false'}
        aria-controls={open() ? panelId : undefined}
        onClick={() => {
          if (open()) closePanel(true);
          else setOpen(true);
        }}
        class={[
          'relative inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 overflow-hidden rounded-full border border-border bg-surface px-2.5 text-xs font-semibold text-text tabular-nums hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:min-h-9 sm:px-3',
          expiryAnnounced() && 'motion-safe:animate-[timer-expiry-pulse_1.2s_ease-in-out_2]',
        ]}
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          aria-hidden="true"
          class={['size-4', isConfigured() && !isPaused() && 'hidden sm:block']}
        >
          <Show when={isPaused()} fallback={<path d="M8 4.75V8l2 1.25" />}>
            <path d="M6.5 5.5v5m3-5v5" />
          </Show>
          <circle cx="8" cy="8" r="6" />
        </svg>
        <Show when={isConfigured()} fallback={<span class="hidden sm:inline">Timer</span>}>
          <span>{timeLabel()}</span>
          <span aria-hidden="true" class="absolute inset-x-0 bottom-0 h-0.5 bg-accent/15">
            <span class="block h-full bg-accent/80" style={{ width: `${progress()}%` }} />
          </span>
        </Show>
      </button>
      <span aria-live="polite" aria-atomic="true" class="sr-only">
        {expiryAnnounced() ? 'Time is up.' : ''}
      </span>

      <Show when={open()}>
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          tabindex={-1}
          data-board-overlay
          class="fixed inset-x-4 top-14 z-30 rounded-xl border border-border bg-surface p-3.5 text-text shadow-lg focus:outline-none sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-64"
        >
          <div class="flex items-center justify-between gap-2">
            <h2 id={titleId} class="text-sm font-semibold">Countdown Timer</h2>
            <button type="button" class={`${controlClass} inline-flex min-w-11 items-center justify-center sm:min-w-9`} aria-label="Close Countdown Timer" onClick={() => closePanel(true)}>
              <CloseIcon />
            </button>
          </div>
          <Show when={props.canControl}>
            <form
              class="mt-3 space-y-2.5"
              onSubmit={(event) => {
                event.preventDefault();
                if (validMinutes()) void updateTimer({ action: 'start', minutes: Number(minutesDraft()) });
              }}
            >
              <div class="grid grid-cols-4 gap-1.5">
                <For each={presets}>
                  {(minutes) => (
                    <button
                      type="button"
                      aria-pressed={Number(minutesDraft()) === minutes ? 'true' : 'false'}
                      class={`${controlClass} aria-pressed:border-focus aria-pressed:bg-surface-subtle`}
                      onClick={() => setMinutesDraft(String(minutes))}
                    >
                      {minutes}m
                    </button>
                  )}
                </For>
              </div>
              <div class="flex items-end gap-2">
                <div class="min-w-0 flex-1">
                  <label for={durationId} class="block text-xs font-medium text-text-muted">Minutes</label>
                  <input
                    ref={durationInput}
                    id={durationId}
                    type="number"
                    min={MIN_TIMER_MINUTES}
                    max={MAX_TIMER_MINUTES}
                    step="1"
                    required
                    value={minutesDraft()}
                    onInput={(event) => setMinutesDraft(event.currentTarget.value)}
                    class="mt-1 min-h-11 w-full rounded-lg border border-border bg-canvas px-2.5 text-sm tabular-nums focus:border-focus focus:outline-none sm:min-h-9"
                  />
                </div>
                <button
                  type="submit"
                  class="min-h-11 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-contrast hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 sm:min-h-9"
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
            Mute timer chime
            <span aria-hidden="true" class="text-text-muted">{muted() ? 'On' : 'Off'}</span>
          </button>
        </div>
      </Show>
    </div>
  );
}
