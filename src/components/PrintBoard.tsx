import { For, Show, createMemo } from 'solid-js';

import {
  prepareBoardExport,
  type BoardExportJson,
} from '../lib/board-export';
import type { BoardViewDTO } from '../lib/board-types';

type ExportCard = BoardExportJson['cards'][number];

function voteSummary(total: number | null, mine: number): string {
  if (total === null) {
    return mine > 0 ? `${mine} of your Votes` : '';
  }
  return total > 0 ? `${total} ${total === 1 ? 'Vote' : 'Votes'}` : '';
}

function PrintedCard(props: { card: ExportCard; votes?: string }) {
  return (
    <li>
      <p class="board-print-content">{props.card.content}</p>
      <Show when={props.votes}>
        <p class="board-print-meta">{props.votes}</p>
      </Show>
      <Show when={props.card.isActionItem}>
        <p class="board-print-meta">
          Action Item · {props.card.actionDone ? 'Done' : 'Open'}
          {props.card.actionOwner.trim() ? ` · Owner: ${props.card.actionOwner}` : ''}
        </p>
      </Show>
      <Show when={Object.keys(props.card.reactions).length > 0}>
        <p class="board-print-meta">
          Reactions · {Object.entries(props.card.reactions).map(([emoji, count]) => `${emoji} ${count}`).join(' · ')}
        </p>
      </Show>
      <Show when={props.card.comments.length > 0}>
        <p class="board-print-meta">Comments</p>
        <ul>
          <For each={props.card.comments}>
            {(comment) => <li class="board-print-content">{comment.content}</li>}
          </For>
        </ul>
      </Show>
    </li>
  );
}

export default function PrintBoard(props: { board: BoardViewDTO }) {
  const document = createMemo(() => prepareBoardExport(props.board));

  const boardStates = createMemo(() => [
    document().board.isLocked ? 'Locked' : '',
    document().board.isBlurred ? 'Private Mode' : '',
    document().board.blindVoting ? 'Blind Voting' : '',
  ].filter(Boolean).join(' · '));

  return (
    <article aria-label="Printable Board" class="board-print">
      <h1>{document().board.title}</h1>
      <Show when={document().board.subtitle.trim()}>
        <p class="board-print-content">{document().board.subtitle}</p>
      </Show>
      <Show when={boardStates()}>
        <p class="board-print-meta">{boardStates()}</p>
      </Show>
      <For each={document().columns}>
        {({ column, groups, cards }) => (
          <section>
            <h2>{column.title}</h2>
            <Show when={groups.length || cards.length} fallback={<p>No Cards</p>}>
              <For each={groups}>
                {({ group, heading, cards: members }) => (
                  <div>
                    <h3>{heading}</h3>
                    <Show when={!group.redacted && voteSummary(group.votes, document().ownGroupVotes.get(group.id) ?? 0)}>
                      {(votes) => <p class="board-print-meta">{votes()}</p>}
                    </Show>
                    <ul>
                      <For each={members}>
                        {(card) => <PrintedCard card={card} />}
                      </For>
                    </ul>
                  </div>
                )}
              </For>
              <Show when={cards.length > 0}>
                <ul>
                  <For each={cards}>
                    {(card) => (
                      <PrintedCard
                        card={card}
                        votes={card.redacted ? '' : voteSummary(card.votes, document().ownCardVotes.get(card.id) ?? 0)}
                      />
                    )}
                  </For>
                </ul>
              </Show>
            </Show>
          </section>
        )}
      </For>
    </article>
  );
}
