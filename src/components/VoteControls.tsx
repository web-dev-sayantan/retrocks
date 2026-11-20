import { Minus, Plus } from 'lucide';
import { Show, createMemo } from 'solid-js';

import type { CardViewDTO } from '../lib/board-types';
import type { ChangeVoteInput } from '../lib/voting-schemas';
import LucideIcon from './LucideIcon';

type VoteDelta = ChangeVoteInput['delta'];

export interface WorkspaceVoting {
  remainingVotes: number | null;
  maxVotesPerCard: number | null;
  pending: boolean;
  optimisticVote: { targetId: string; delta: VoteDelta } | null;
  onChange: (
    targetType: 'card' | 'group',
    targetId: string,
    delta: VoteDelta,
  ) => void;
}

const buttonClass = [
  'spring-press inline-flex h-full min-w-11 cursor-pointer items-center justify-center text-text sm:min-w-7',
  'transition-colors hover:bg-surface-subtle active:bg-surface-subtle focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
  'disabled:cursor-not-allowed disabled:text-text-muted disabled:opacity-50',
];

export default function VoteControls(props: {
  target: Pick<CardViewDTO, 'id' | 'myVotes' | 'votes'>;
  targetType?: 'card' | 'group';
  voting: WorkspaceVoting;
  isLocked: boolean;
}) {
  const delta = createMemo(() => {
    const vote = props.voting.optimisticVote;
    return vote?.targetId === props.target.id ? vote.delta : 0;
  });
  const myVotes = createMemo(() => props.target.myVotes + delta());
  const votes = createMemo(() => props.target.votes === null ? null : props.target.votes + delta());
  const canCast = createMemo(() =>
    (props.voting.remainingVotes === null || props.voting.remainingVotes > 0) &&
    (props.voting.maxVotesPerCard === null || myVotes() < props.voting.maxVotesPerCard),
  );

  return (
    <div
      role="group"
      aria-label="Voting"
      class={[
        'inline-flex h-[calc(2.75rem+2px)] w-fit shrink-0 items-center rounded-lg border transition-colors sm:h-7',
        myVotes() > 0 ? 'border-accent/30 bg-accent/10' : 'border-border/75 bg-surface-subtle/75',
      ]}
    >
      <Show when={!props.isLocked}>
        <button
          type="button"
          data-print-hide="true"
          class={[buttonClass, 'rounded-l-lg']}
          aria-label="Remove Vote"
          disabled={props.voting.pending || myVotes() === 0}
          onClick={() => props.voting.onChange(props.targetType ?? 'card', props.target.id, -1)}
        >
          <LucideIcon icon={Minus} class="size-3.5" strokeWidth={2} />
        </button>
      </Show>
      <span
        class="min-w-[2.5ch] px-0.5 text-center text-xs font-medium whitespace-nowrap text-text tabular-nums"
        title={votes() === null ? `${myVotes()} of your Votes` : `${votes()} total Votes · ${myVotes()} yours`}
      >
        {votes() === null ? `${myVotes()} yours` : votes()}
      </span>
      <Show when={!props.isLocked}>
        <button
          type="button"
          data-print-hide="true"
          class={[buttonClass, 'rounded-r-lg']}
          aria-label="Cast Vote"
          disabled={props.voting.pending || !canCast()}
          onClick={() => props.voting.onChange(props.targetType ?? 'card', props.target.id, 1)}
        >
          <LucideIcon icon={Plus} class="size-3.5" strokeWidth={2} />
        </button>
      </Show>
    </div>
  );
}
