import { Button } from '@ui-sdk/solid/button';
import { Check, SquareCheck, Users, X } from 'lucide';
import { For, Show, createMemo, onSettled } from 'solid-js';

import { createInlineEditSession, type InlineEditOutcome } from '../../lib/inline-edit';
import type { PokerChangeOptions, PokerChangeOutcome } from '../../lib/poker-controller';
import {
  POKER_DEFAULT_ROOM_NAME,
  POKER_ROOM_NAME_LIMIT,
  type PokerLiveRoomView,
  type PokerRoomChange,
} from '../../lib/poker-types';
import LucideIcon from '../LucideIcon';
import PokerDeckSettings from './PokerDeckSettings';
import PokerRoomDeletion from './PokerRoomDeletion';
import PokerRoomSharing from './PokerRoomSharing';
import PokerStoryQueue from './PokerStoryQueue';
import PokerStoryTitleEditor from './PokerStoryTitleEditor';
import PokerVotingRound from './PokerVotingRound';
import './poker.css';

function toInlineEditOutcome(result: PokerChangeOutcome): InlineEditOutcome {
  if (result.ok) return true;
  if ('reason' in result) {
    if (result.reason === 'network') return result.message;
    return result.reason === 'cancelled';
  }
  return result.message;
}

export default function PokerWorkspace(props: {
  room: PokerLiveRoomView;
  online: string[];
  status: 'connecting' | 'live' | 'reconnecting';
  busy?: boolean;
  error?: string;
  focusHeading?: boolean;
  claimError?: string;
  onUnavailable: () => void;
  onChange: (command: PokerRoomChange, options?: PokerChangeOptions) => Promise<PokerChangeOutcome>;
  onClearError?: () => void;
}) {
  const activeStory = createMemo(() => props.room.stories.find((story) => story.id === props.room.activeStoryId));
  const onlineSet = createMemo(() => new Set(props.online));
  const openRound = createMemo(() => (props.room.round?.phase === 'open' ? props.room.round : null));
  const revealedRound = createMemo(() => (props.room.round && props.room.round.phase !== 'open' ? props.room.round : null));
  const submitted = createMemo(() => {
    const round = openRound();
    return round ? new Set(round.submittedParticipantIds) : null;
  });

  const voteSpread = createMemo(() => {
    const round = revealedRound();
    if (!round || round.ballots.length === 0) return null;
    const counts = new Map<string, number>();
    for (const ballot of round.ballots) {
      counts.set(ballot.choice, (counts.get(ballot.choice) ?? 0) + 1);
    }
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const topCount = entries[0]?.[1] ?? 0;
    const unanimous = entries.length === 1 && round.ballots.length > 1;
    const topChoices = new Set(entries.filter(([, count]) => count === topCount && count > 1).map(([choice]) => choice));
    return { entries, unanimous, topChoices };
  });
  const nonVoters = createMemo(() => {
    const round = revealedRound();
    if (!round) return [];
    const voted = new Set(round.ballots.map((ballot) => ballot.participantId));
    return props.room.participants.filter((participant) => !voted.has(participant.id));
  });

  const onlineStatusLabel = createMemo(() => (props.status === 'live' ? `${props.online.length} online` : 'Connecting to Room…'));
  const isBusy = () => Boolean(props.busy);

  async function editActiveStoryTitle(
    storyId: string,
    title: string,
    isCurrent: () => boolean,
  ): Promise<InlineEditOutcome> {
    const result = await props.onChange(
      { type: 'edit-story', storyId, title },
      { shouldContinue: isCurrent },
    );
    return toInlineEditOutcome(result);
  }

  let heading!: HTMLHeadingElement;
  let activeHeading!: HTMLHeadingElement;

  const canManage = () => props.room.viewer?.isFacilitator === true;

  const roomNameEdit = createInlineEditSession({
    value: () => props.room.name,
    target: () => props.room.id,
    disabled: () => !canManage(),
    save: saveRoomNameText,
    fallbackFocus: () => heading?.focus(),
    acceptsTarget: (target) => !(target instanceof Element && target.closest('button')),
  });

  async function saveRoomNameText(text: string): Promise<InlineEditOutcome> {
    const nextName = text.trim() || POKER_DEFAULT_ROOM_NAME;
    if (nextName === props.room.name) return true;
    const result = await props.onChange({ type: 'rename-room', name: nextName });
    return toInlineEditOutcome(result);
  }

  onSettled(() => {
    if (props.focusHeading) heading.focus();
  });

  const alertMessage = () => props.error || roomNameEdit.error() || props.claimError || '';

  return (
    <main class="poker-workspace" data-deck-type={props.room.deckType}>
      <header class="poker-room-bar">
        <div class="flex min-w-0 flex-wrap items-center gap-2.5 sm:gap-3">
          <Show
            when={!roomNameEdit.isEditing()}
            fallback={
              <div ref={roomNameEdit.containerRef} class="poker-room-title-wrap">
                <input
                  ref={roomNameEdit.inputRef}
                  type="text"
                  aria-label="Room name"
                  placeholder={POKER_DEFAULT_ROOM_NAME}
                  maxlength={POKER_ROOM_NAME_LIMIT}
                  {...roomNameEdit.inputProps}
                  class="poker-input poker-room-title-input board-focus-ring"
                />
                <div class="poker-room-title-actions">
                  <Button
                    type="button"
                    aria-label="Save Room name"
                    title="Save Room name"
                    disabled={roomNameEdit.isSaving() || isBusy()}
                    focusableWhenDisabled
                    onClick={roomNameEdit.submit}
                    class="poker-inline-action poker-inline-action-save spring-press board-focus-ring"
                  >
                    <LucideIcon icon={Check} class="size-3.5 shrink-0" strokeWidth={2.2} />
                  </Button>
                  <Button
                    type="button"
                    aria-label="Cancel Room rename"
                    title="Cancel Room rename"
                    onClick={() => {
                      props.onClearError?.();
                      roomNameEdit.cancel();
                    }}
                    class="poker-inline-action spring-press board-focus-ring"
                  >
                    <LucideIcon icon={X} class="size-3.5 shrink-0" strokeWidth={2} />
                  </Button>
                </div>
              </div>
            }
          >
            <div {...roomNameEdit.triggerProps} class="poker-room-title-wrap">
              <h1
                ref={heading}
                tabindex={-1}
                title={canManage() ? `${props.room.name} — Double-click to rename` : props.room.name}
                class={[
                  'poker-room-bar-title board-focus-ring min-w-0 truncate rounded-sm',
                  canManage() && 'cursor-text touch-manipulation',
                ]}
              >
                {props.room.name}
              </h1>
            </div>
          </Show>
          <PokerDeckSettings
            deck={props.room.deck}
            deckType={props.room.deckType}
            canManage={props.room.viewer?.isFacilitator === true}
            busy={isBusy()}
            onChange={props.onChange}
            onClearError={props.onClearError}
          />
          <p
            class="poker-bar-chip poker-online-pill tabular-nums"
            data-state={props.status === 'live' ? 'online' : 'reconnecting'}
            title={onlineStatusLabel()}
            aria-live="polite"
          >
            <LucideIcon icon={Users} class="poker-online-icon size-3.5 shrink-0" strokeWidth={2} />
            <span aria-hidden="true">{props.online.length}</span>
            <span class="sr-only">{onlineStatusLabel()}</span>
          </p>
        </div>

        <div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <PokerRoomSharing
            roomId={props.room.id}
            isFacilitator={props.room.viewer?.isFacilitator ?? false}
            revision={props.room.facilitatorLinkRevision}
          />
          <Show when={props.room.viewer?.isFacilitator}>
            <span aria-hidden="true" class="mx-0.5 h-4 w-px bg-border/70" />
            <Button
              class="poker-icon-btn spring-press board-focus-ring"
              aria-label="Close Room"
              title="Close Room"
              disabled={isBusy()}
              focusableWhenDisabled
              onClick={() => void props.onChange({ type: 'close-room' })}
            >
              <LucideIcon icon={SquareCheck} class="size-4 shrink-0" strokeWidth={1.85} />
            </Button>
            <PokerRoomDeletion roomId={props.room.id} onUnavailable={props.onUnavailable} />
          </Show>
        </div>
      </header>

      <p
        role="alert"
        class={alertMessage() ? 'poker-error-text border-b border-border/60 px-4 py-2.5 text-sm font-medium sm:px-6' : 'sr-only'}
      >
        {alertMessage()}
      </p>

      <div class="poker-split">
        <PokerStoryQueue
          stories={props.room.stories}
          activeStoryId={props.room.activeStoryId}
          canManage={props.room.viewer?.isFacilitator === true}
          deck={props.room.deck}
          round={props.room.round}
          busy={isBusy()}
          onChange={props.onChange}
        />

        <section class="poker-stage" aria-labelledby="poker-active-story">
          <div class="poker-stage-inner">
            <h2 ref={activeHeading} id="poker-active-story" tabindex={-1} class="sr-only">
              Active Story
            </h2>

            <Show
              when={activeStory()}
              fallback={
                <div class="flex flex-1 flex-col items-center justify-center gap-3 py-8 sm:py-14">
                  <p class="text-lg font-semibold tracking-tight text-text text-balance">
                    {props.room.stories.length === 0
                      ? (props.room.viewer?.isFacilitator ? 'Add a Story to begin estimating' : 'Waiting for Stories')
                      : (props.room.viewer?.isFacilitator ? 'Select a Story from the queue' : 'Waiting for the Facilitator to select a Story')}
                  </p>
                  <p class="max-w-sm text-sm leading-relaxed text-text-muted text-pretty">
                    {props.room.stories.length === 0 && props.room.viewer?.isFacilitator
                      ? 'Add your first Story in the queue on the left, or adjust the Deck in the top bar anytime.'
                      : 'Votes stay private until the Facilitator reveals them.'}
                  </p>
                </div>
              }
            >
              {(story) => (
                <div class="flex flex-col items-center gap-2.5">
                  <Show when={openRound()}>
                    {(round) => (
                      <span class="poker-phase-pill tabular-nums">
                        <span aria-hidden="true" class="poker-presence-dot" />
                        <span>
                          {round().submittedParticipantIds.length} of {Math.max(props.room.participants.length, round().submittedParticipantIds.length)} voted
                        </span>
                      </span>
                    )}
                  </Show>
                  <Show when={revealedRound()}>
                    {(round) => (
                      <span class="poker-phase-pill">
                        {round().phase === 'accepted' ? 'Estimate recorded' : 'Revealed votes'}
                      </span>
                    )}
                  </Show>

                  <PokerStoryTitleEditor
                    story={story()}
                    canEdit={props.room.viewer?.isFacilitator === true}
                    busy={isBusy()}
                    variant="stage"
                    onSave={editActiveStoryTitle}
                    fallbackFocus={() => activeHeading.focus()}
                  />

                  <Show when={story().acceptedEstimate !== undefined}>
                    <p class="poker-accepted-pill" role="status">
                      <LucideIcon icon={Check} class="size-3.5 text-accent" strokeWidth={2.4} />
                      <span>Accepted Estimate</span>
                      <strong class="font-bold">{story().acceptedEstimate}</strong>
                    </p>
                  </Show>

                  <Show when={voteSpread()}>
                    {(spread) => (
                      <div class="poker-spread" aria-label="Vote breakdown">
                        <Show
                          when={spread().unanimous}
                          fallback={
                            <For each={spread().entries}>
                              {([choice, count], idx) => (
                                <>
                                  <Show when={idx() > 0}>
                                    <span aria-hidden="true" class="opacity-35">/</span>
                                  </Show>
                                  <span>
                                    <strong class="font-semibold text-text">{choice}</strong> ×{count}
                                  </span>
                                </>
                              )}
                            </For>
                          }
                        >
                          <span class="font-medium text-accent">
                            Unanimous <strong class="font-semibold text-text">{spread().entries[0]?.[0]}</strong>
                          </span>
                        </Show>
                      </div>
                    )}
                  </Show>
                </div>
              )}
            </Show>

            <Show
              when={revealedRound()}
              fallback={
                <Show when={props.room.participants.length > 0}>
                  <ul class="poker-seats" aria-label="Participants">
                    <For each={props.room.participants} keyed={(participant) => participant.id}>
                      {(participant) => {
                        const isOnline = () => onlineSet().has(participant().id);
                        const isSelf = () => participant().id === props.room.viewer?.id;
                        const hasVoted = () => submitted()?.has(participant().id) ?? false;
                        return (
                          <li
                            class="poker-seat"
                            data-online={isOnline() ? 'true' : 'false'}
                            data-self={isSelf() ? 'true' : undefined}
                          >
                            <Show when={openRound()}>
                              <div
                                class="poker-seat-card"
                                data-seat-state={hasVoted() ? 'voted' : 'waiting'}
                                data-self={isSelf() ? 'true' : undefined}
                                aria-hidden="true"
                              >
                                <Show when={hasVoted()}>
                                  <LucideIcon icon={Check} class="size-4" strokeWidth={2.4} />
                                </Show>
                              </div>
                            </Show>
                            <span class="poker-seat-name inline-flex max-w-full items-center gap-1.5 text-xs">
                              <span
                                aria-hidden="true"
                                class="poker-presence-dot"
                                data-state={isOnline() ? 'online' : 'offline'}
                              />
                              <span class="truncate">
                                {participant().displayName}
                                <Show when={isSelf()}> (you)</Show>
                              </span>
                            </span>
                            <span class="sr-only">
                              {isOnline() ? 'Online' : 'Offline'}
                              <Show when={submitted()}>
                                {(ids) => <span>{ids().has(participant().id) ? ', Voted' : ', Awaiting vote'}</span>}
                              </Show>
                            </span>
                            <Show when={participant().isFacilitator}>
                              <span class="text-[11px] leading-none text-text-muted">Facilitator</span>
                            </Show>
                          </li>
                        );
                      }}
                    </For>
                  </ul>
                </Show>
              }
            >
              {(round) => (
                <>
                  <ul class="poker-seats" aria-label="Revealed votes">
                    <For each={round().ballots} keyed={(ballot) => ballot.participantId}>
                      {(ballot) => {
                        const isOnline = () => onlineSet().has(ballot().participantId);
                        const isSelf = () => ballot().participantId === props.room.viewer?.id;
                        const isConsensus = () => voteSpread()?.topChoices.has(ballot().choice) ?? false;
                        return (
                          <li
                            class="poker-seat grid justify-items-center"
                            data-online={isOnline() ? 'true' : 'false'}
                            data-self={isSelf() ? 'true' : undefined}
                          >
                            <span class="poker-seat-name order-2 inline-flex max-w-full items-center gap-1.5 text-xs">
                              <span
                                aria-hidden="true"
                                class="poker-presence-dot"
                                data-state={isOnline() ? 'online' : 'offline'}
                              />
                              <span class="truncate">
                                {ballot().displayName}
                                <Show when={isSelf()}> (you)</Show>
                              </span>
                            </span>
                            <span
                              class="poker-seat-card order-1"
                              data-seat-state="revealed"
                              data-self={isSelf() ? 'true' : undefined}
                              data-consensus={isConsensus() ? 'true' : undefined}
                            >
                              {ballot().choice}
                            </span>
                          </li>
                        );
                      }}
                    </For>
                  </ul>
                  <Show when={nonVoters().length > 0}>
                    <p class="text-xs text-text-muted">
                      Did not vote: {nonVoters().map((participant) => participant.displayName).join(', ')}
                    </p>
                  </Show>
                </>
              )}
            </Show>
          </div>

          <Show when={props.room.round}>
            {(round) => (
              <div class="w-full max-w-176">
                <PokerVotingRound
                  round={round()}
                  deck={props.room.deck}
                  participantCount={props.room.participants.length}
                  hasEstimate={activeStory()?.acceptedEstimate !== undefined}
                  busy={isBusy()}
                  onSkip={() => activeHeading.focus()}
                  canManage={props.room.viewer?.isFacilitator === true}
                  onChange={props.onChange}
                />
              </div>
            )}
          </Show>
        </section>
      </div>
    </main>
  );
}
