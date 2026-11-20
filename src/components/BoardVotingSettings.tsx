import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
} from '@ui-sdk/solid/dialog';
import { ChevronDown } from 'lucide';
import { For, Show, createEffect, createMemo, createSignal, createUniqueId, untrack } from 'solid-js';

import { VOTE_LIMIT_OPTIONS, type BoardViewDTO } from '../lib/board-types';
import { confirmBoardAction } from '../lib/board-confirm';
import { canControlFacilitation } from '../lib/board-permissions';
import type { UpdateVotingSettingsInput } from '../lib/voting-schemas';
import BoardOverlayHeader from './BoardOverlayHeader';
import LucideIcon from './LucideIcon';

export type VotingSettingsPatch = Omit<UpdateVotingSettingsInput, 'boardId'>;

const buttonClass = [
  'inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg px-3 py-1.5 text-xs font-medium sm:min-h-9',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50',
];

const fieldClass = 'board-modal-field min-h-11 w-full px-3 py-2 text-base sm:min-h-9 sm:text-sm';
const mutedButtonClass = [buttonClass, 'border border-border bg-surface text-text hover:bg-surface-subtle'];
const destructiveButtonClass = [buttonClass, 'bg-rose-700 text-white hover:bg-rose-800'];

export default function BoardVotingSettings(props: {
  board: Pick<
    BoardViewDTO,
    'voteLimit' | 'maxVotesPerCard' | 'blindVoting' | 'allowParticipantGroup' | 'isLocked' | 'isFacilitator'
  >;
  open: boolean;
  onClose: () => void;
  onUpdate: (patch: VotingSettingsPatch) => Promise<string | null>;
  onReset: () => Promise<string | null>;
  onToggleLock: (isLocked: boolean) => Promise<string | null>;
  onDeleteBoard: () => Promise<string | null>;
}) {
  const destructiveActionsId = createUniqueId();
  const [voteLimitChoice, setVoteLimitChoice] = createSignal('5');
  const [customLimit, setCustomLimit] = createSignal('');
  const [singleVote, setSingleVote] = createSignal(false);
  const [blindVoting, setBlindVoting] = createSignal(false);
  const [allowParticipantGroup, setAllowParticipantGroup] = createSignal(false);
  const [pending, setPending] = createSignal<'save' | 'reset' | 'lock' | 'delete' | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  let initialSettings: Pick<
    BoardViewDTO,
    'voteLimit' | 'maxVotesPerCard' | 'blindVoting' | 'allowParticipantGroup'
  >;

  const voteLimit = createMemo(() => {
    const choice = voteLimitChoice();
    return choice === 'unlimited' ? null : Number(choice === 'custom' ? customLimit() : choice);
  });
  const validLimit = createMemo(() => {
    const limit = voteLimit();
    return limit === null || (Number.isSafeInteger(limit) && limit >= 1);
  });

  createEffect(() => props.open, (open) => {
    if (!open) return;
    untrack(() => {
      const { voteLimit, maxVotesPerCard, blindVoting, allowParticipantGroup } =
        props.board;
      initialSettings = {
        voteLimit,
        maxVotesPerCard,
        blindVoting,
        allowParticipantGroup,
      };
      setVoteLimitChoice(voteLimit === null ? 'unlimited' : VOTE_LIMIT_OPTIONS.some((option) => option === voteLimit) ? String(voteLimit) : 'custom');
      setCustomLimit(voteLimit === null ? '' : String(voteLimit));
      setSingleVote(maxVotesPerCard === 1);
      setBlindVoting(blindVoting);
      setAllowParticipantGroup(allowParticipantGroup);
      setError(null);
    });
  });

  async function saveSettings(event: SubmitEvent) {
    event.preventDefault();
    if (pending() || !validLimit() || !canControlFacilitation(props.board)) return;

    const patch: VotingSettingsPatch = {};
    const limit = voteLimit();
    const cap = singleVote() ? 1 : null;
    const blind = blindVoting();
    const grouping = allowParticipantGroup();
    if (initialSettings.voteLimit !== limit) patch.voteLimit = limit;
    if (initialSettings.maxVotesPerCard !== cap) patch.maxVotesPerCard = cap;
    if (initialSettings.blindVoting !== blind) patch.blindVoting = blind;
    if (initialSettings.allowParticipantGroup !== grouping) {
      patch.allowParticipantGroup = grouping;
    }
    if (Object.keys(patch).length === 0) {
      props.onClose();
      return;
    }

    setPending('save');
    setError(null);
    try {
      const message = await props.onUpdate(patch);
      setError(message);
      if (message === null) props.onClose();
    } finally {
      setPending(null);
    }
  }

  async function resetVotes() {
    if (pending() || !canControlFacilitation(props.board)) return;
    const confirmed = await confirmBoardAction({
      title: 'Remove every Vote from this Board?',
      description: 'Every Participant’s Votes go back to zero. This cannot be undone.',
      confirmLabel: 'Reset All Votes',
    });
    if (!confirmed) return;
    setPending('reset');
    setError(null);
    try {
      setError(await props.onReset());
    } finally {
      setPending(null);
    }
  }

  async function toggleLock() {
    if (pending()) return;
    const nextLocked = !props.board.isLocked;
    setPending('lock');
    setError(null);
    try {
      setError(await props.onToggleLock(nextLocked));
    } finally {
      setPending(null);
    }
  }

  async function deleteBoard() {
    if (pending()) return;
    const confirmed = await confirmBoardAction({
      title: 'Permanently delete this Board?',
      description: 'The Board and every Card, Column, Vote, and comment are erased immediately. This cannot be undone.',
      confirmLabel: 'Delete Board',
    });
    if (!confirmed) return;
    setPending('delete');
    setError(null);
    try {
      const message = await props.onDeleteBoard();
      setError(message);
      if (message === null) props.onClose();
    } finally {
      setPending(null);
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogBackdrop data-print-hide="true" class="board-dialog-backdrop z-40" />
      <DialogContent
        data-board-overlay="true"
        data-print-hide="true"
        class="board-dialog-surface z-50 flex w-[min(28rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-surface text-text shadow-2xl"
      >
        <BoardOverlayHeader closeLabel="Close Board Settings" onClose={() => props.onClose()}>
          <DialogTitle class="truncate">Board Settings</DialogTitle>
        </BoardOverlayHeader>

        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          <Show when={props.board.isLocked}>
            <p class="mb-3 rounded-lg border border-border bg-surface-subtle px-3 py-2 text-xs text-text">
              This Board is Locked. Unlock the Board to adjust Voting settings or reset Votes.
            </p>
          </Show>

          <form onSubmit={(event) => void saveSettings(event)}>
            <fieldset disabled={pending() !== null || !canControlFacilitation(props.board)} class="space-y-4">
              <label class="grid gap-1.5 text-sm font-medium">
                Vote limit
                <span class="relative grid">
                  <select
                    class={[fieldClass, 'appearance-none pr-9']}
                    value={voteLimitChoice()}
                    onChange={(event) => setVoteLimitChoice(event.currentTarget.value)}
                  >
                    <For each={VOTE_LIMIT_OPTIONS}>
                      {(option) => <option value={option ?? 'unlimited'}>{option ?? 'Unlimited'}</option>}
                    </For>
                    <option value="custom">Custom</option>
                  </select>
                  <LucideIcon
                    icon={ChevronDown}
                    class="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-text-muted"
                  />
                </span>
              </label>
              <Show when={voteLimitChoice() === 'custom'}>
                <label class="grid gap-1.5 text-sm font-medium">
                  Custom Vote limit
                  <input
                    type="number"
                    min="1"
                    max={Number.MAX_SAFE_INTEGER}
                    step="1"
                    required
                    class={fieldClass}
                    value={customLimit()}
                    onInput={(event) => setCustomLimit(event.currentTarget.value)}
                  />
                </label>
              </Show>
              <label class="grid gap-1.5 text-sm font-medium">
                Per-Card cap
                <span class="relative grid">
                  <select
                    class={[fieldClass, 'appearance-none pr-9']}
                    value={singleVote() ? '1' : 'unlimited'}
                    onChange={(event) => setSingleVote(event.currentTarget.value === '1')}
                  >
                    <option value="unlimited">Unlimited (stackable)</option>
                    <option value="1">1 per Card</option>
                  </select>
                  <LucideIcon
                    icon={ChevronDown}
                    class="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-text-muted"
                  />
                </span>
              </label>
              <label class="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium sm:min-h-9">
                <input
                  type="checkbox"
                  class="size-4 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  checked={blindVoting()}
                  onChange={(event) => setBlindVoting(event.currentTarget.checked)}
                />
                Blind Voting
              </label>
              <label class="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium sm:min-h-9">
                <input
                  type="checkbox"
                  class="size-4 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  checked={allowParticipantGroup()}
                  onChange={(event) =>
                    setAllowParticipantGroup(event.currentTarget.checked)
                  }
                />
                Allow Participants to group Cards
              </label>
              <button
                type="submit"
                class={[buttonClass, 'bg-accent text-accent-contrast hover:opacity-90']}
                disabled={!validLimit() || !canControlFacilitation(props.board)}
              >
                {pending() === 'save' ? 'Saving…' : 'Save Settings'}
              </button>
            </fieldset>
          </form>

          <div class="mt-4 space-y-2 border-t border-border pt-4">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h3 class="text-sm font-semibold text-text">Board Lock</h3>
                <p class="mt-0.5 text-xs text-text-muted">
                  {props.board.isLocked
                    ? 'Cards, Columns, Votes, and comments are Locked. Facilitators can still update existing Action Items.'
                    : 'Lock content edits while keeping viewing, searching, exporting, and Facilitator Action Item updates.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              class={mutedButtonClass}
              disabled={pending() !== null}
              onClick={() => void toggleLock()}
            >
              {pending() === 'lock'
                ? props.board.isLocked
                  ? 'Unlocking…'
                  : 'Locking…'
                : props.board.isLocked
                  ? 'Unlock Board'
                  : 'Lock Board'}
            </button>
          </div>

          <section
            aria-labelledby={destructiveActionsId}
            class="mt-5 space-y-3 rounded-xl border border-col-rose/45 bg-col-rose-tint/35 p-3.5"
          >
            <h3 id={destructiveActionsId} class="text-sm font-semibold text-text">
              Destructive actions
            </h3>
            <button
              type="button"
              class={mutedButtonClass}
              disabled={pending() !== null || !canControlFacilitation(props.board)}
              onClick={() => void resetVotes()}
            >
              {pending() === 'reset' ? 'Resetting…' : 'Reset All Votes'}
            </button>

            <div class="space-y-2 border-t border-col-rose/35 pt-3">
              <div>
                <h4 class="text-sm font-semibold text-text">Delete Board</h4>
                <p class="mt-0.5 text-xs text-text-muted">
                  Permanently erase this Board and all Cards, Columns, Votes, and comments immediately.
                </p>
              </div>
              <button
                type="button"
                class={destructiveButtonClass}
                disabled={pending() !== null}
                onClick={() => void deleteBoard()}
              >
                {pending() === 'delete' ? 'Deleting…' : 'Delete Board'}
              </button>
            </div>
          </section>

          <Show when={error()}>
            <p role="alert" class="mt-3 text-sm text-text">{error()}</p>
          </Show>
        </div>
      </DialogContent>
    </Dialog>
  );
}
