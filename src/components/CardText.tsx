import { For, Match, Switch, createMemo } from 'solid-js';

import { tokenizeCardText } from '../lib/card-text';

export interface CardTextProps {
  text: string;
}

/**
 * Safely renders Card plain text via Solid JSX nodes (never `innerHTML`),
 * preserving line breaks, clickable `https?://` auto-links, and inline
 * backtick code spans.
 */
export default function CardText(props: CardTextProps) {
  const tokens = createMemo(() => tokenizeCardText(props.text));

  return (
    <span class="break-words whitespace-pre-wrap">
      <For each={tokens()}>
        {(token) => (
          <Switch>
            <Match when={token.type === 'text'}>
              {token.type === 'text' ? token.value : ''}
            </Match>
            <Match when={token.type === 'newline'}>
              <br />
            </Match>
            <Match when={token.type === 'code'}>
              <code class="rounded bg-surface-subtle px-1 py-0.5 font-mono text-[0.85em] text-text">
                {token.type === 'code' ? token.value : ''}
              </code>
            </Match>
            <Match when={token.type === 'link'}>
              <a
                href={token.type === 'link' ? token.href : '#'}
                target="_blank"
                rel="noopener noreferrer"
                class={[
                  'break-all text-text underline decoration-text-muted/60 underline-offset-2',
                  'transition-colors hover:decoration-text',
                  'focus-visible:rounded-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                ]}
              >
                {token.type === 'link' ? token.label : ''}
              </a>
            </Match>
          </Switch>
        )}
      </For>
    </span>
  );
}
