import { For, Show, createMemo, createSignal } from 'solid-js';

import { REACTION_EMOJIS, type ReactionEmoji } from '../lib/board-types';
import { SmilePlusIcon } from './Icons';

export interface CardReactionsProps {
  cardId: string;
  reactions: Record<string, number>;
  myReactions: readonly string[];
  disabled: boolean;
  onToggleReaction: (cardId: string, emoji: ReactionEmoji) => Promise<boolean>;
}

export default function CardReactions(props: CardReactionsProps) {
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [pendingEmoji, setPendingEmoji] = createSignal<ReactionEmoji | null>(
    null,
  );

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
    setPendingEmoji(emoji);
    try {
      await props.onToggleReaction(props.cardId, emoji);
    } finally {
      setPendingEmoji(null);
    }
  }

  return (
    <div class="relative flex flex-wrap items-center gap-1.5">
      <For each={activeReactions()}>
        {(item) => (
          <button
            type="button"
            disabled={props.disabled || pendingEmoji() !== null}
            aria-label={`${item.emoji} ${item.count} ${item.count === 1 ? 'reaction' : 'reactions'}`}
            aria-pressed={item.isMine ? 'true' : 'false'}
            onClick={() => void handleToggle(item.emoji)}
            class={[
              'inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors sm:min-h-6',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60',
              {
                'border-accent bg-accent/10 font-medium text-text': item.isMine,
                'border-border bg-surface-subtle/70 text-text-muted hover:border-text-muted/50 hover:text-text':
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
        <div data-print-hide="true" class="relative">
          <button
            type="button"
            aria-label="Add reaction"
            aria-expanded={pickerOpen() ? 'true' : 'false'}
            title="Add reaction"
            disabled={pendingEmoji() !== null}
            onClick={() => setPickerOpen((prev) => !prev)}
            class={[
              'inline-flex min-h-8 min-w-8 cursor-pointer items-center justify-center rounded-full border border-transparent text-text-muted sm:min-h-6 sm:min-w-6',
              'transition-colors hover:border-border hover:bg-surface-subtle hover:text-text',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            ]}
          >
            <SmilePlusIcon />
          </button>

          <Show when={pickerOpen()}>
            <div
              role="group"
              aria-label="Choose a reaction"
              class="absolute bottom-full left-0 z-30 mb-1.5 flex items-center gap-1 rounded-full border border-border bg-surface p-1 shadow-md"
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
                      'inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-base transition-colors sm:h-7 sm:w-7 sm:text-sm',
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
          </Show>
        </div>
      </Show>
    </div>
  );
}
