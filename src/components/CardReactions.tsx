import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';

import { REACTION_EMOJIS, type ReactionEmoji } from '../lib/board-types';
import { SmilePlusIcon } from './Icons';

export interface CardReactionsProps {
  cardId: string;
  reactions: Record<string, number>;
  myReactions: readonly string[];
  disabled: boolean;
  onToggleReaction: (cardId: string, emoji: ReactionEmoji) => Promise<string | null>;
}

export default function CardReactions(props: CardReactionsProps) {
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [pendingEmoji, setPendingEmoji] = createSignal<ReactionEmoji | null>(
    null,
  );

  const [reactionError, setReactionError] = createSignal<string | null>(null);
  let controls: HTMLDivElement | undefined;
  let pickerTrigger: HTMLButtonElement | undefined;
  let pressingOutside = false;

  createEffect(pickerOpen, (open) => {
    const root = controls;
    if (!open || !root) return;

    const doc = root.ownerDocument;
    let releaseCheck: number | undefined;
    const handleMouseEvent = (event: MouseEvent): void => {
      const outside = event.target instanceof Node && !root.contains(event.target);
      if (event.type === 'mousedown') {
        pressingOutside = event.button === 0 && outside;
        return;
      }

      if (event.type === 'mouseup' && pressingOutside && releaseCheck === undefined) {
        // An outside press can move focus without producing a click.
        releaseCheck = requestAnimationFrame(() => {
          releaseCheck = undefined;
          if (!root.contains(doc.activeElement)) setPickerOpen(false);
        });
      }
      pressingOutside = false;
      if (event.type === 'click' && outside) setPickerOpen(false);
    };

    const mouseEvents = ['mousedown', 'mouseup', 'click'] as const;
    for (const type of mouseEvents) doc.addEventListener(type, handleMouseEvent, true);
    return () => {
      pressingOutside = false;
      if (releaseCheck !== undefined) cancelAnimationFrame(releaseCheck);
      for (const type of mouseEvents) doc.removeEventListener(type, handleMouseEvent, true);
    };
  });

  function handlePickerKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.isComposing || !pickerOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    setPickerOpen(false);
    pickerTrigger?.focus();
  }

  const activeReactions = createMemo(() => {
    const counts = props.reactions;
    const mine = new Set(props.myReactions);
    const items: Array<{ emoji: ReactionEmoji; count: number; isMine: boolean }> =
      [];
    for (const emoji of REACTION_EMOJIS) {
      const count = counts[emoji] ?? 0;
      if (count > 0) {
        items.push({ emoji, count, isMine: mine.has(emoji) });
      }
    }
    return items;
  });

  async function handleToggle(emoji: ReactionEmoji): Promise<void> {
    if (props.disabled || pendingEmoji() !== null) return;
    setPickerOpen(false);
    setReactionError(null);
    setPendingEmoji(emoji);
    try {
      setReactionError(await props.onToggleReaction(props.cardId, emoji));
    } finally {
      setPendingEmoji(null);
    }
  }

  return (
    <div
      ref={controls}
      onKeyDown={handlePickerKeyDown}
      onFocusOut={(event) => {
        // The picker is in flow. Wait for an outside click to reach its target.
        if (!pickerOpen() || pressingOutside) return;
        const nextFocus = event.relatedTarget;
        if (!(nextFocus instanceof Node) || !event.currentTarget.contains(nextFocus)) {
          setPickerOpen(false);
        }
      }}
      class="relative flex flex-wrap items-center gap-1.5"
    >
      <For each={activeReactions()}>
        {(item) => (
          <button
            type="button"
            disabled={props.disabled || pendingEmoji() !== null}
            aria-label={`${item.emoji} ${item.count} ${item.count === 1 ? 'reaction' : 'reactions'}`}
            aria-pressed={item.isMine ? 'true' : 'false'}
            onClick={() => void handleToggle(item.emoji)}
            class={[
              'inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors sm:min-h-6 sm:min-w-0',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60',
              {
                'border-accent bg-accent/10 font-medium text-text': item.isMine,
                'border-border bg-surface-subtle text-text-muted hover:border-text-muted/50 hover:text-text':
                  !item.isMine,
              },
            ]}
          >
            <span aria-hidden="true">{item.emoji}</span>
            <span class="tabular-nums">{item.count}</span>
          </button>
        )}
      </For>

      <Show when={!props.disabled}>
        <>
          <button
            ref={pickerTrigger}
            type="button"
            data-print-hide="true"
            aria-label="Add reaction"
            aria-expanded={pickerOpen() ? 'true' : 'false'}
            title="Add reaction"
            disabled={pendingEmoji() !== null}
            onClick={(event) => {
              const opening = !pickerOpen();
              if (opening) event.currentTarget.focus({ preventScroll: true });
              setPickerOpen(opening);
            }}
            class={[
              'inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border border-transparent text-text-muted sm:min-h-6 sm:min-w-6',
              'transition-colors hover:border-border hover:bg-surface-subtle hover:text-text active:bg-surface-subtle',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            ]}
          >
            <SmilePlusIcon />
          </button>

          <Show when={pickerOpen()}>
            <div class="basis-full" data-print-hide="true">
              <div
                role="group"
                aria-label="Choose a reaction"
                data-board-overlay="true"
                class="flex w-fit max-w-full flex-wrap items-center gap-1 rounded-lg border border-border bg-surface p-1.5 shadow-md"
              >
                <For each={REACTION_EMOJIS}>
                  {(emoji) => (
                    <button
                      type="button"
                      aria-pressed={
                        props.myReactions.includes(emoji) ? 'true' : 'false'
                      }
                      onClick={() => void handleToggle(emoji)}
                      class={[
                        'inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-base transition-colors sm:h-7 sm:w-7 sm:text-sm',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                        {
                          'bg-accent/15 ring-1 ring-accent':
                            props.myReactions.includes(emoji),
                          'hover:bg-surface-subtle':
                            !props.myReactions.includes(emoji),
                        },
                      ]}
                    >
                      {emoji}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </>
      </Show>
      <Show when={pendingEmoji() !== null}>
        <p class="basis-full text-xs text-text-muted" role="status">Updating reaction…</p>
      </Show>
      <Show when={reactionError()}>
        <p class="basis-full text-xs text-rose-700 dark:text-rose-300" role="alert">{reactionError()}</p>
      </Show>
    </div>
  );
}
