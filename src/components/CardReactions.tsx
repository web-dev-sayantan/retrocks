import { Popover, PopoverContent, PopoverTrigger } from '@ui-sdk/solid/popover';
import { SmilePlus } from 'lucide';
import { For, Show, createMemo, createSignal } from 'solid-js';

import { REACTION_EMOJIS, type ReactionEmoji } from '../lib/board-types';
import LucideIcon from './LucideIcon';

export interface CardReactionsProps {
  cardId: string;
  reactions: Partial<Record<ReactionEmoji, number>>;
  myReactions: readonly ReactionEmoji[];
  disabled: boolean;
  inCardFooter?: boolean;
  onToggleReaction: (cardId: string, emoji: ReactionEmoji) => Promise<string | null>;
}

export default function CardReactions(props: CardReactionsProps) {
  const [pickerOpen, setPickerOpen] = createSignal<boolean | null>(() => props.disabled ? null : false);
  const [pendingEmoji, setPendingEmoji] = createSignal<ReactionEmoji | null>(
    null,
  );

  const [reactionError, setReactionError] = createSignal<string | null>(null);
  let pickerTrigger: HTMLButtonElement | undefined;

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

  const belongsOnOwnRow = () => activeReactions().length > 0 || !!reactionError();

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
      class={[
        'flex flex-wrap items-center gap-1.5',
        {
          'order-first basis-full sm:col-span-full': props.inCardFooter && belongsOnOwnRow(),
          'sm:col-start-2 sm:justify-self-end': props.inCardFooter && !belongsOnOwnRow(),
          hidden: props.disabled && activeReactions().length === 0 && !reactionError(),
        },
      ]}
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
              'board-focus-ring disabled:cursor-not-allowed disabled:opacity-60',
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
        <Popover
          open={pickerOpen() === true}
          onOpenChange={(open) => setPickerOpen(open)}
        >
          <PopoverTrigger
            ref={pickerTrigger}
            data-print-hide="true"
            aria-label="Add reaction"
            title="Add reaction"
            disabled={pendingEmoji() !== null}
            focusableWhenDisabled
            onClick={(event) => event.currentTarget.focus({ preventScroll: true })}
            class={[
              'spring-press inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg text-text-muted sm:min-h-7 sm:min-w-7',
              'transition-colors hover:bg-surface-subtle hover:text-text data-open:bg-surface-subtle data-open:text-text data-disabled:cursor-not-allowed data-disabled:opacity-60',
              'board-focus-ring',
            ]}
          >
            <LucideIcon icon={SmilePlus} />
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            sideOffset={6}
            collisionPadding={10}
            initialFocus="none"
            finalFocus="trigger"
            aria-label="Reactions"
            data-board-overlay={pickerOpen() ? 'true' : undefined}
            data-print-hide="true"
            class="board-popover w-max max-w-[calc(100vw-1.25rem)] rounded-xl border border-border bg-surface p-1.5 text-text"
          >
            <div role="group" aria-label="Choose a reaction" class="flex flex-wrap items-center gap-1">
              <For each={REACTION_EMOJIS}>
                {(emoji) => (
                  <button
                    type="button"
                    aria-pressed={props.myReactions.includes(emoji) ? 'true' : 'false'}
                    onClick={() => {
                      pickerTrigger?.focus({ preventScroll: true });
                      void handleToggle(emoji);
                    }}
                    class={[
                      'inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-base transition-colors sm:size-7 sm:text-sm',
                      'board-focus-ring',
                      {
                        'bg-accent/15 ring-1 ring-accent': props.myReactions.includes(emoji),
                        'hover:bg-surface-subtle': !props.myReactions.includes(emoji),
                      },
                    ]}
                  >
                    {emoji}
                  </button>
                )}
              </For>
            </div>
          </PopoverContent>
        </Popover>
      </Show>
      <p class="sr-only" aria-live="polite" aria-atomic="true">{pendingEmoji() !== null ? 'Updating reaction…' : ''}</p>
      <Show when={reactionError()}>
        <p class="basis-full text-xs text-rose-700 dark:text-rose-300" role="alert">{reactionError()}</p>
      </Show>
    </div>
  );
}
