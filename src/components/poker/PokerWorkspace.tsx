import { Button } from '@ui-sdk/solid/button';
import { For, Show, createMemo, createSignal, onSettled } from 'solid-js';

import { confirmBoardAction } from '../../lib/board-confirm';
import { unresolvedPokerRoundId, type PokerResult, type PokerLiveRoomView, type PokerRoomChange } from '../../lib/poker-types';
import PokerDeckSettings from './PokerDeckSettings';
import PokerRoomDeletion from './PokerRoomDeletion';
import PokerRoomSharing from './PokerRoomSharing';
import PokerVotingRound from './PokerVotingRound';
import PokerStoryQueue from './PokerStoryQueue';
import './poker.css';

export default function PokerWorkspace(props: {
  room: PokerLiveRoomView;
  online: string[];
  status: 'connecting' | 'live' | 'reconnecting';
  focusHeading?: boolean;
  claimError?: string;
  onUnavailable: () => void;
  onChange: (command: PokerRoomChange) => Promise<PokerResult>;
}) {
  const activeStory = createMemo(() => props.room.stories.find((story) => story.id === props.room.activeStoryId));
  const submitted = createMemo(() => {
    const round = props.room.round;
    return round?.phase === 'open' ? new Set(round.submittedParticipantIds) : null;
  });
  const [closeError, setCloseError] = createSignal('');
  const [closing, setClosing] = createSignal(false);
  let closeInProgress = false;

  async function closeRoom() {
    if (closeInProgress) return;
    closeInProgress = true;
    setCloseError('');
    const discardRoundId = unresolvedPokerRoundId(props.room.round);
    try {
      if (discardRoundId !== undefined && !await confirmBoardAction({
        title: 'Close Room?',
        description: 'Closing discards the current Voting Round and its votes. Accepted Estimates stay in the read-only summary.',
        confirmLabel: 'Close and discard votes',
        agentConfirm: 'Closes the Room permanently and discards the current Voting Round and its votes.',
      })) return;

      setClosing(true);
      const result = await props.onChange({ type: 'close-room', ...(discardRoundId === undefined ? {} : { discardRoundId }) });
      if (!result.ok) setCloseError(result.message);
    } catch {
      setCloseError('Could not close the Room. Try again.');
    } finally {
      closeInProgress = false;
      setClosing(false);
    }
  }

  let heading!: HTMLHeadingElement;
  let activeHeading!: HTMLHeadingElement;

  onSettled(() => {
    if (props.focusHeading) heading.focus();
  });

  return (
    <main class="poker-workspace" data-deck-type={props.room.deckType}>
      <header class="mb-7 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-5">
        <h1 ref={heading} tabindex={-1} class="poker-title">Pointing Poker</h1>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p class="text-sm font-medium text-text-muted" aria-live="polite">
            {props.status === 'live' ? `${props.online.length} online` : 'Connecting to Room…'}
          </p>
          <Show when={props.room.viewer?.isFacilitator}>
            <Button
              class="poker-story-control board-focus-ring"
              disabled={closing()}
              focusableWhenDisabled
              data-agent-confirm={unresolvedPokerRoundId(props.room.round) === undefined
                ? 'Closes the Room permanently. Accepted Estimates remain in the read-only summary.'
                : undefined}
              onClick={() => void closeRoom()}
            >
              Close Room
            </Button>
            <PokerRoomDeletion roomId={props.room.id} onUnavailable={props.onUnavailable} />
          </Show>
        </div>
      </header>

      <p role="alert" class={(closeError() || props.claimError) ? 'mb-4 text-sm font-medium text-[var(--poker-error)]' : 'sr-only'}>
        {closeError() || props.claimError}
      </p>
      <div class="poker-layout">
        <section class="poker-active min-w-0 rounded-xl p-5 sm:p-7" aria-labelledby="poker-active-story">
          <h2 ref={activeHeading} id="poker-active-story" tabindex={-1} class="text-sm font-semibold">Active Story</h2>
          <Show when={activeStory()} fallback={
            <p class="mt-2 text-base leading-relaxed">
              {props.room.viewer?.isFacilitator ? 'Select a Story from the queue.' : 'Waiting for the Facilitator to select a Story.'}
            </p>
          }>
            {(story) => (
              <>
                <p class="poker-active-title mt-2 font-semibold [overflow-wrap:anywhere]">{story().title}</p>
                <p class="mt-2 text-sm font-semibold [overflow-wrap:anywhere]" role="status">
                  {story().acceptedEstimate !== undefined ? `Accepted Estimate · ${story().acceptedEstimate}` : ''}
                </p>
              </>
            )}
          </Show>
          <Show when={props.room.round} fallback={
            <PokerDeckSettings
              deck={props.room.deck}
              deckType={props.room.deckType}
              locked={props.room.deckLocked}
              canManage={props.room.viewer?.isFacilitator === true}
              onChange={props.onChange}
            />
          }>
            {(round) => (
              <PokerVotingRound
                round={round()}
                deck={props.room.deck}
                hasEstimate={activeStory()?.acceptedEstimate !== undefined}
                onSkip={() => activeHeading.focus()}
                canManage={props.room.viewer?.isFacilitator === true}
                onChange={props.onChange}
              />
            )}
          </Show>
        </section>

        <PokerStoryQueue
          stories={props.room.stories}
          activeStoryId={props.room.activeStoryId}
          canManage={props.room.viewer?.isFacilitator === true}
          deck={props.room.deck}
          roundId={props.room.round?.id}
          discardRoundId={unresolvedPokerRoundId(props.room.round)}
          onChange={props.onChange}
        />

        <section class="poker-roster min-w-0 rounded-xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="poker-participants">
          <h2 id="poker-participants" class="text-xl font-semibold tracking-tight">Participants</h2>
          <ul class="mt-3 divide-y divide-border">
            <For each={props.room.participants} keyed={(participant) => participant.id}>
              {(participant) => (
                <li class="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <div class="min-w-0">
                    <p class="font-medium [overflow-wrap:anywhere]">
                      {participant().displayName}
                      <Show when={participant().id === props.room.viewer?.id}> (you)</Show>
                    </p>
                    <div class="flex flex-wrap gap-x-2 text-xs text-text-muted">
                      <Show when={participant().isFacilitator}><span>Facilitator</span></Show>
                      <Show when={submitted()}>
                        {(ids) => <span>{ids().has(participant().id) ? 'Voted' : 'Awaiting vote'}</span>}
                      </Show>
                    </div>
                  </div>
                  <span class={[
                    'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                    props.online.includes(participant().id)
                      ? 'bg-[var(--poker-pale)] text-[var(--poker-highlight)]'
                      : 'bg-surface-subtle text-text-muted',
                  ]}>
                    {props.online.includes(participant().id) ? 'Online' : 'Offline'}
                  </span>
                </li>
              )}
            </For>
          </ul>
          <PokerRoomSharing
            roomId={props.room.id}
            isFacilitator={props.room.viewer?.isFacilitator ?? false}
            revision={props.room.facilitatorLinkRevision}
          />
        </section>
      </div>
      <p class="mt-5 text-sm text-text-muted">This Room expires 90 days after creation or its most recent vote or content change, whichever is later.</p>
    </main>
  );
}
