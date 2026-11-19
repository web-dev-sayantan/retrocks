import { For, Show, createMemo, createSignal, createUniqueId } from 'solid-js';

import { VOTE_LIMIT_OPTIONS, type BoardViewDTO } from '../lib/board-types';
import type { UpdateVotingSettingsInput } from '../lib/voting-schemas';
import { CloseIcon } from './Icons';

export type VotingSettingsPatch = Omit<UpdateVotingSettingsInput, 'boardId'>;

const buttonClass = [
  'inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg px-3 py-1.5 text-xs font-medium sm:min-h-9',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50',
];

const fieldClass = 'min-h-11 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-text focus:border-focus focus:outline-none sm:min-h-9';

export default function BoardVotingSettings(props: {
  board: Pick<
    BoardViewDTO,
    'voteLimit' | 'maxVotesPerCard' | 'blindVoting' | 'allowParticipantGroup'
  >;
  onUpdate: (patch: VotingSettingsPatch) => Promise<string | null>;
  onReset: () => Promise<string | null>;
}) {
  let dialog!: HTMLDialogElement;
  const titleId = createUniqueId();
  const [voteLimitChoice, setVoteLimitChoice] = createSignal('5');
  const [customLimit, setCustomLimit] = createSignal('');
  const [singleVote, setSingleVote] = createSignal(false);
  const [blindVoting, setBlindVoting] = createSignal(false);
  const [allowParticipantGroup, setAllowParticipantGroup] = createSignal(false);
  const [confirmingReset, setConfirmingReset] = createSignal(false);
  const [pending, setPending] = createSignal<'save' | 'reset' | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  let initialSettings: typeof props.board;

  const voteLimit = createMemo(() => {
    const choice = voteLimitChoice();
    return choice === 'unlimited' ? null : Number(choice === 'custom' ? customLimit() : choice);
  });
  const validLimit = createMemo(() => {
    const limit = voteLimit();
    return limit === null || (Number.isSafeInteger(limit) && limit >= 1);
  });

  function openDialog() {
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
    setConfirmingReset(false);
    setError(null);
    dialog.showModal();
  }

  async function saveSettings(event: SubmitEvent) {
    event.preventDefault();
    if (pending() || !validLimit()) return;

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
      dialog.close();
      return;
    }

    setPending('save');
    setError(null);
    try {
      const message = await props.onUpdate(patch);
      setError(message);
      if (message === null && dialog.open) dialog.close();
    } finally {
      setPending(null);
    }
  }

  async function resetVotes() {
    if (pending()) return;
    setPending('reset');
    setError(null);
    try {
      const message = await props.onReset();
      setError(message);
      if (message === null) setConfirmingReset(false);
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        class={[buttonClass, 'ml-auto shrink-0 border border-border bg-surface text-text hover:bg-surface-subtle']}
        disabled={pending() !== null}
        onClick={openDialog}
      >
        Board Settings
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        class="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-border bg-surface p-4 text-text shadow-xl backdrop:bg-black/50 sm:p-5"
      >
        <div class="mb-4 flex items-center justify-between gap-3">
          <h2 id={titleId} class="text-base font-semibold">Board Settings</h2>
          <button
            type="button"
            aria-label="Close Board Settings"
            class={[buttonClass, 'border border-border text-text-muted hover:bg-surface-subtle hover:text-text']}
            onClick={() => dialog.close()}
          >
            <CloseIcon />
          </button>
        </div>

        <form onSubmit={(event) => void saveSettings(event)}>
          <fieldset disabled={pending() !== null} class="space-y-4">
            <label class="grid gap-1.5 text-sm font-medium">
              Vote limit
              <select
                class={fieldClass}
                value={voteLimitChoice()}
                onChange={(event) => setVoteLimitChoice(event.currentTarget.value)}
              >
                <For each={VOTE_LIMIT_OPTIONS}>
                  {(option) => <option value={option ?? 'unlimited'}>{option ?? 'Unlimited'}</option>}
                </For>
                <option value="custom">Custom</option>
              </select>
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
              <select
                class={fieldClass}
                value={singleVote() ? '1' : 'unlimited'}
                onChange={(event) => setSingleVote(event.currentTarget.value === '1')}
              >
                <option value="unlimited">Unlimited (stackable)</option>
                <option value="1">1 per Card</option>
              </select>
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
              disabled={!validLimit()}
            >
              {pending() === 'save' ? 'Saving…' : 'Save Settings'}
            </button>
          </fieldset>
        </form>

        <div class="mt-4 border-t border-border pt-4">
          <Show
            when={confirmingReset()}
            fallback={
              <button
                type="button"
                class={[buttonClass, 'border border-col-rose bg-surface text-text hover:bg-surface-subtle']}
                disabled={pending() !== null}
                onClick={() => { setError(null); setConfirmingReset(true); }}
              >
                Reset All Votes
              </button>
            }
          >
            <p class="mb-2 text-sm text-text">Remove every Vote from this Board?</p>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class={[buttonClass, 'border border-col-rose bg-col-rose text-white hover:opacity-90']}
                disabled={pending() !== null}
                onClick={() => void resetVotes()}
              >
                {pending() === 'reset' ? 'Resetting…' : 'Confirm Reset'}
              </button>
              <button
                type="button"
                class={[buttonClass, 'border border-border bg-surface text-text hover:bg-surface-subtle']}
                disabled={pending() !== null}
                onClick={() => setConfirmingReset(false)}
              >
                Cancel Reset
              </button>
            </div>
          </Show>
        </div>
        <Show when={error()}>
          <p role="alert" class="mt-3 text-sm text-text">{error()}</p>
        </Show>
      </dialog>
    </>
  );
}
