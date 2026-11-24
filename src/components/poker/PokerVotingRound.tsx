import { Button } from '@ui-sdk/solid/button';
import { Radio, RadioGroup } from '@ui-sdk/solid/radio';
import { For, Show, createMemo, createSignal, createUniqueId } from 'solid-js';

import type { PokerResult, PokerRoundView, PokerVotingCommand } from '../../lib/poker-types';
import PokerEstimateForm from './PokerEstimateForm';

export default function PokerVotingRound(props: {
  round: PokerRoundView;
  deck: readonly string[];
  participantCount: number;
  canManage: boolean;
  hasEstimate: boolean;
  onSkip: () => void;
  onChange: (command: PokerVotingCommand) => Promise<PokerResult>;
}) {
  const headingId = createUniqueId();
  let heading!: HTMLHeadingElement;
  const [pendingRound, setPendingRound] = createSignal<string>();
  const [failure, setFailure] = createSignal<{ roundId: string; message: string }>();
  const busy = () => pendingRound() !== undefined;
  const open = createMemo(() => (props.round.phase === 'open' ? props.round : null));
  const revealed = createMemo(() => (props.round.phase !== 'open' ? props.round : null));
  const votedChoices = createMemo(() => {
    const current = revealed();
    if (!current) return undefined;
    return new Set(current.ballots.map((ballot) => ballot.choice));
  });
  const error = () => {
    const current = failure();
    return current?.roundId === props.round.id ? current.message : '';
  };

  async function change(command: PokerVotingCommand) {
    if (busy()) return;
    const control = heading.ownerDocument.activeElement;
    const hadFocus = control !== null && heading.parentElement?.contains(control);
    setPendingRound(command.roundId);
    setFailure(undefined);
    try {
      const result = await props.onChange(command);
      if (!result.ok) {
        setFailure({ roundId: command.roundId, message: result.message });
      } else if (hadFocus && !control.isConnected && control.ownerDocument.activeElement === control.ownerDocument.body) {
        if (command.type === 'skip-story') props.onSkip();
        else heading.focus();
      }
    } catch {
      setFailure({ roundId: command.roundId, message: 'Could not update the Voting Round. Try again.' });
    } finally {
      setPendingRound(undefined);
    }
  }

  return (
    <div class="poker-hand-section">
      <h3 ref={heading} id={headingId} tabindex={-1} class="sr-only">
        {open() ? 'Cast your vote' : 'Revealed votes'}
      </h3>
      <Show when={open()}>
        {(round) => (
          <>
            <Show when={props.canManage}>
              <div class="mb-2 flex justify-center">
                <Button
                  type="button"
                  class="poker-primary spring-press board-focus-ring !rounded-full !px-5"
                  disabled={busy() || round().submittedParticipantIds.length === 0}
                  focusableWhenDisabled
                  onClick={() => void change({ type: 'reveal', roundId: round().id })}
                >
                  Reveal votes
                </Button>
              </div>
            </Show>

            <RadioGroup
              class="poker-deck"
              aria-labelledby={headingId}
              value={round().ownChoice}
              readOnly={busy()}
              onValueChange={(choice) => void change({ type: 'vote', roundId: round().id, choice })}
            >
              <For each={props.deck}>
                {(choice) => (
                  <Radio class="poker-vote-tile spring-press board-focus-ring" value={choice}>
                    {choice}
                  </Radio>
                )}
              </For>
            </RadioGroup>

            <div class="flex flex-wrap items-center justify-center gap-3 text-xs text-text-muted">
              <p role="status">
                {round().ownChoice === null ? 'Your vote is private until reveal.' : `Your vote is ${round().ownChoice}.`}
              </p>
              <Show when={round().ownChoice !== null}>
                <Button
                  type="button"
                  class="board-focus-ring cursor-pointer font-medium text-text underline underline-offset-2 transition-opacity hover:opacity-80 disabled:opacity-50"
                  disabled={busy()}
                  focusableWhenDisabled
                  onClick={() => void change({ type: 'vote', roundId: round().id, choice: null })}
                >
                  Clear vote
                </Button>
              </Show>
            </div>
          </>
        )}
      </Show>

      <Show when={revealed()}>
        {(round) => (
          <>
            <Show when={round().phase === 'revealed' && !props.canManage}>
              <p class="text-sm text-text-muted" role="status">Waiting for an Accepted Estimate.</p>
            </Show>
            <Show when={props.canManage}>
              <Show when={round().phase === 'revealed' && round().id} keyed>
                {(roundId) => (
                  <PokerEstimateForm
                    deck={props.deck}
                    busy={busy()}
                    votedChoices={votedChoices()}
                    onSave={(choice) => void change({ type: 'confirm-estimate', roundId, choice })}
                  />
                )}
              </Show>
              <div class="flex flex-wrap items-center justify-center gap-2">
                <Button
                  type="button"
                  class="poker-ghost spring-press board-focus-ring !rounded-full"
                  disabled={busy()}
                  focusableWhenDisabled
                  onClick={() => void change({ type: 'restart-round', roundId: round().id })}
                >
                  {round().phase === 'accepted' ? 'Reconsider Story' : 'Start fresh round'}
                </Button>
                <Show when={round().phase === 'revealed'}>
                  <Button
                    type="button"
                    class="poker-ghost spring-press board-focus-ring !rounded-full"
                    disabled={busy()}
                    focusableWhenDisabled
                    onClick={() => void change({ type: 'skip-story', roundId: round().id })}
                  >
                    {props.hasEstimate ? 'Skip this round' : 'Skip Story'}
                  </Button>
                </Show>
              </div>
            </Show>
          </>
        )}
      </Show>

      <p class="poker-error-text text-sm font-medium [&:empty]:hidden" role="alert">{error()}</p>
    </div>
  );
}
