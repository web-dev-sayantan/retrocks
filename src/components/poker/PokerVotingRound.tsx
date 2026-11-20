import { Button } from '@ui-sdk/solid/button';
import { Radio, RadioGroup } from '@ui-sdk/solid/radio';
import { For, Show, createMemo, createSignal, createUniqueId } from 'solid-js';

import type { PokerResult, PokerRoundView, PokerVotingCommand } from '../../lib/poker-types';

export default function PokerVotingRound(props: {
  round: PokerRoundView;
  deck: readonly string[];
  canReveal: boolean;
  onChange: (command: PokerVotingCommand) => Promise<PokerResult>;
}) {
  const headingId = createUniqueId();
  const [pendingRound, setPendingRound] = createSignal<string>();
  const [failure, setFailure] = createSignal<{ roundId: string; message: string }>();
  const busy = () => pendingRound() !== undefined;
  const open = createMemo(() => props.round.phase === 'open' ? props.round : null);
  const revealed = createMemo(() => props.round.phase === 'revealed' ? props.round : null);
  const error = () => {
    const current = failure();
    return current?.roundId === props.round.id ? current.message : '';
  };

  async function change(command: PokerVotingCommand) {
    if (busy()) return;
    setPendingRound(command.roundId);
    setFailure(undefined);
    try {
      const result = await props.onChange(command);
      if (!result.ok) setFailure({ roundId: command.roundId, message: result.message });
    } catch {
      setFailure({ roundId: command.roundId, message: 'Could not update the Voting Round. Try again.' });
    } finally {
      setPendingRound(undefined);
    }
  }

  return (
    <div class="poker-voting mt-5 border-t pt-4">
      <h3 id={headingId} class="text-base font-semibold">
        {open() ? 'Cast your vote' : 'Revealed votes'}
      </h3>
      <Show when={open()}>
        {(round) => (
          <>
            <RadioGroup
              class="poker-deck mt-3"
              aria-labelledby={headingId}
              value={round().ownChoice}
              readOnly={busy()}
              onValueChange={(choice) => void change({ type: 'vote', roundId: round().id, choice })}
            >
              <For each={props.deck}>
                {(choice) => <Radio class="poker-vote-tile board-focus-ring" value={choice}>{choice}</Radio>}
              </For>
            </RadioGroup>
            <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <p role="status" class="text-sm">
                  {round().ownChoice === null ? 'Your vote is private until reveal.' : `Your vote is ${round().ownChoice}.`}
                </p>
                <Show when={round().ownChoice !== null}>
                  <Button
                    type="button"
                    class="poker-story-control board-focus-ring"
                    disabled={busy()}
                    focusableWhenDisabled
                    onClick={() => void change({ type: 'vote', roundId: round().id, choice: null })}
                  >
                    Clear vote
                  </Button>
                </Show>
              </div>
              <Show when={props.canReveal}>
                <Button
                  type="button"
                  class="poker-primary board-focus-ring aria-disabled:cursor-default aria-disabled:opacity-65"
                  disabled={busy() || round().submittedParticipantIds.length === 0}
                  focusableWhenDisabled
                  onClick={() => void change({ type: 'reveal', roundId: round().id })}
                >
                  Reveal votes
                </Button>
              </Show>
            </div>
          </>
        )}
      </Show>
      <Show when={revealed()}>
        {(round) => (
          <>
            <p class="mt-1 text-sm" role="status">Waiting for an Accepted Estimate.</p>
            <ul aria-labelledby={headingId} class="mt-3 grid gap-2 sm:grid-cols-2">
              <For each={round().ballots} keyed={(ballot) => ballot.participantId}>
                {(ballot) => (
                  <li class="poker-ballot flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                    <span class="text-sm font-semibold [overflow-wrap:anywhere]">{ballot().displayName}</span>
                    <span class="text-base font-bold tabular-nums [overflow-wrap:anywhere]">{ballot().choice}</span>
                  </li>
                )}
              </For>
            </ul>
          </>
        )}
      </Show>
      <p class="text-sm font-medium text-[var(--poker-error)] [&:not(:empty)]:mt-3" role="alert">{error()}</p>
    </div>
  );
}
