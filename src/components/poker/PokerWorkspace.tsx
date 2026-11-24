import { Button } from '@ui-sdk/solid/button';
import { usePrimitive } from '@ui-sdk/solid/primitive';
import { Check, Pencil, SquareCheck, Users, X } from 'lucide';
import { For, Show, createEffect, createMemo, createSignal, onSettled } from 'solid-js';

import { confirmBoardAction } from '../../lib/board-confirm';
import { createDoubleTap } from '../../lib/double-tap';
import { createInlineEditSave, inlineEdit, type InlineEditOutcome } from '../../lib/inline-edit';
import {
  POKER_DEFAULT_ROOM_NAME,
  POKER_ROOM_NAME_LIMIT,
  unresolvedPokerRoundId,
  unresolvedPokerRoundWithVotesId,
  type PokerLiveRoomView,
  type PokerResult,
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

  const [closeError, setCloseError] = createSignal('');
  const [closing, setClosing] = createSignal(false);
  let closeInProgress = false;

  async function closeRoom() {
    if (closeInProgress) return;
    closeInProgress = true;
    setCloseError('');
    const discardRoundId = unresolvedPokerRoundId(props.room.round);
    try {
      const confirmed = await confirmBoardAction(
        discardRoundId !== undefined
          ? {
              title: 'Close Room?',
              description:
                'Closing discards the current Voting Round and its votes while keeping Accepted Estimates in the summary. A Facilitator can reopen the Room later.',
              confirmLabel: 'Close and discard votes',
              agentConfirm:
                'Closes the Room and discards the current Voting Round and its votes. Accepted Estimates stay in the summary, and a Facilitator can reopen the Room later.',
            }
          : {
              title: 'Close Room?',
              description:
                'Closing moves the Room to a read-only summary of Stories and Accepted Estimates. A Facilitator can reopen the Room later.',
              confirmLabel: 'Close Room',
              agentConfirm:
                'Closes the Room and moves it to a read-only summary of Stories and Accepted Estimates. A Facilitator can reopen the Room later.',
            },
      );
      if (!confirmed) return;

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

  async function editActiveStoryTitle(
    storyId: string,
    title: string,
    discardRoundId?: string,
  ): Promise<InlineEditOutcome> {
    try {
      const result = await props.onChange({
        type: 'edit-story',
        storyId,
        title,
        ...(discardRoundId === undefined ? {} : { discardRoundId }),
      });
      return result.ok ? true : result.message;
    } catch {
      return 'Could not update the Story title. Try again.';
    }
  }

  let heading!: HTMLHeadingElement;
  let activeHeading!: HTMLHeadingElement;
  let roomNameEditorEl: HTMLDivElement | undefined;
  let roomNameInputEl: HTMLInputElement | undefined;
  let renameRoomButtonEl: HTMLButtonElement | undefined;

  const canManage = () => props.room.viewer?.isFacilitator === true;

  const roomNameField = usePrimitive(inlineEdit, () => ({
    value: () => props.room.name,
    commit: (text: string) => roomNameSave.commit(text),
    disabled: () => !canManage(),
  }));
  const roomNameEdit = roomNameField.api.edit;
  const roomNameSave = createInlineEditSave(saveRoomNameText, () => roomNameEdit.cancel());
  const isRenamingRoom = () => roomNameField.present('input');
  const roomNameTap = createDoubleTap(isRoomNameEditTarget, startRoomRename);

  function isRoomNameEditTarget(target: EventTarget | null): boolean {
    if (!canManage()) return false;
    return !(target instanceof Element && target.closest('button'));
  }

  function startRoomRename(): void {
    roomNameTap.reset();
    if (!canManage()) return;
    roomNameEdit.start(props.room.id);
  }

  function handleRoomNameDoubleClick(event: MouseEvent): void {
    if (!isRoomNameEditTarget(event.target)) return;
    roomNameTap.reset();
    startRoomRename();
  }

  function cancelRoomRename(): void {
    roomNameTap.reset();
    roomNameSave.resetError();
    roomNameEdit.cancel();
  }

  async function saveRoomNameText(text: string): Promise<InlineEditOutcome> {
    const nextName = text.trim() || POKER_DEFAULT_ROOM_NAME;
    if (nextName === props.room.name) return true;
    try {
      const result = await props.onChange({ type: 'rename-room', name: nextName });
      return result.ok ? true : result.message;
    } catch {
      return 'Could not rename the Room. Try again.';
    }
  }

  createEffect(isRenamingRoom, (renaming) => {
    if (renaming && roomNameInputEl) roomNameEdit.bindInput(roomNameInputEl);
  });

  createEffect(isRenamingRoom, (renaming, wasRenaming) => {
    if (!renaming && wasRenaming && document.activeElement === document.body) {
      renameRoomButtonEl?.focus();
    }
  });

  onSettled(() => {
    if (props.focusHeading) heading.focus();
  });

  const alertMessage = () => closeError() || roomNameSave.error() || props.claimError || '';

  return (
    <main class="poker-workspace" data-deck-type={props.room.deckType}>
      <header class="poker-room-bar">
        <div class="flex min-w-0 flex-wrap items-center gap-2.5 sm:gap-3">
          <Show
            when={!isRenamingRoom()}
            fallback={
              <div ref={roomNameEditorEl} class="poker-room-title-wrap">
                <input
                  ref={roomNameInputEl}
                  type="text"
                  aria-label="Room name"
                  placeholder={POKER_DEFAULT_ROOM_NAME}
                  maxlength={POKER_ROOM_NAME_LIMIT}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) return;
                    roomNameEdit.inputKeydown(event);
                  }}
                  onFocusOut={(event) => {
                    if (event.relatedTarget instanceof Node && roomNameEditorEl?.contains(event.relatedTarget)) return;
                    roomNameEdit.end('focus-out', event);
                  }}
                  class="poker-input poker-room-title-input board-focus-ring"
                />
                <Button
                  type="button"
                  aria-label="Save Room name"
                  title="Save Room name"
                  disabled={roomNameSave.isSaving()}
                  focusableWhenDisabled
                  onClick={() => roomNameEdit.end()}
                  class="poker-inline-action poker-inline-action-save spring-press board-focus-ring"
                >
                  <LucideIcon icon={Check} class="size-3.5 shrink-0" strokeWidth={2.2} />
                </Button>
                <Button
                  type="button"
                  aria-label="Cancel Room rename"
                  title="Cancel Room rename"
                  onClick={cancelRoomRename}
                  class="poker-inline-action spring-press board-focus-ring"
                >
                  <LucideIcon icon={X} class="size-3.5 shrink-0" strokeWidth={2} />
                </Button>
              </div>
            }
          >
            <div
              onDblClick={handleRoomNameDoubleClick}
              onPointerDown={roomNameTap.onPointerDown}
              onPointerUp={roomNameTap.onPointerUp}
              onPointerCancel={roomNameTap.onPointerCancel}
              class="poker-room-title-wrap"
            >
              <h1
                ref={heading}
                tabindex={-1}
                title={canManage() ? `${props.room.name} — Double-click to rename` : props.room.name}
                class={[
                  'poker-room-bar-title board-focus-ring min-w-0 truncate rounded',
                  canManage() && 'cursor-text touch-manipulation',
                ]}
              >
                {props.room.name}
              </h1>
              <Show when={canManage()}>
                <Button
                  ref={renameRoomButtonEl}
                  type="button"
                  aria-label="Rename Room"
                  title="Rename Room"
                  onClick={startRoomRename}
                  class="poker-icon-btn spring-press board-focus-ring"
                >
                  <LucideIcon icon={Pencil} class="size-3.5 shrink-0" strokeWidth={1.85} />
                </Button>
              </Show>
            </div>
          </Show>
          <PokerDeckSettings
            deck={props.room.deck}
            deckType={props.room.deckType}
            locked={props.room.deckLocked}
            canManage={props.room.viewer?.isFacilitator === true}
            onChange={props.onChange}
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
              disabled={closing()}
              focusableWhenDisabled
              onClick={() => void closeRoom()}
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
          roundId={props.room.round?.id}
          discardRoundId={unresolvedPokerRoundId(props.room.round)}
          activeRoundWithVotesId={unresolvedPokerRoundWithVotesId(props.room.round)}
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
                  <p class="max-w-sm text-sm leading-relaxed text-text-muted [text-wrap:pretty]">
                    {props.room.stories.length === 0 && props.room.viewer?.isFacilitator
                      ? 'Add your first Story in the queue on the left, or adjust the Deck in the top bar before round one starts.'
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
                    discardRoundId={unresolvedPokerRoundWithVotesId(props.room.round)}
                    variant="stage"
                    onSave={(title, discardRoundId) => editActiveStoryTitle(story().id, title, discardRoundId)}
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
              <div class="w-full max-w-[44rem]">
                <PokerVotingRound
                  round={round()}
                  deck={props.room.deck}
                  participantCount={props.room.participants.length}
                  hasEstimate={activeStory()?.acceptedEstimate !== undefined}
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
