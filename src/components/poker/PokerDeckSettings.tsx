import { Button } from '@ui-sdk/solid/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@ui-sdk/solid/field';
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@ui-sdk/solid/popover';
import { Radio, RadioGroup } from '@ui-sdk/solid/radio';
import { Textarea } from '@ui-sdk/solid/textarea';
import { ChevronDown, Layers } from 'lucide';
import { For, Show, createSignal, onSettled } from 'solid-js';

import { isSamePokerDeck } from '../../lib/poker-deck-policy';
import { confirmBoardAction } from '../../lib/board-confirm';

import {
  POKER_DECK_PRESETS,
  type PokerDeckCommand,
  type PokerDeckType,
  type PokerResult,
} from '../../lib/poker-types';
import LucideIcon from '../LucideIcon';

const deckTypes = ['fibonacci', 't-shirt', 'custom'] as const;
const deckName: Record<PokerDeckType, string> = {
  fibonacci: 'Fibonacci',
  't-shirt': 'T-shirt',
  custom: 'Custom',
};

function parseCustomChoices(value: string): string[] {
  return value
    .split('\n')
    .map((choice) => choice.trim())
    .filter(Boolean);
}

export default function PokerDeckSettings(props: {
  deck: readonly string[];
  deckType: PokerDeckType;
  canManage: boolean;
  discardRoundId?: string;
  onChange: (command: PokerDeckCommand) => Promise<PokerResult>;
}) {
  const [open, setOpen] = createSignal(false);
  const [draftType, setDraftType] = createSignal<PokerDeckType>();
  const [draftChoices, setDraftChoices] = createSignal<string>();
  const [busy, setBusy] = createSignal(false);
  const [confirming, setConfirming] = createSignal(false);
  const [ready, setReady] = createSignal(false);
  const [fieldError, setFieldError] = createSignal('');
  const [error, setError] = createSignal('');
  const selectedType = () => draftType() ?? props.deckType;
  const customChoices = () => draftChoices() ?? (props.deckType === 'custom' ? props.deck.join('\n') : '');
  const previewDetail = () => {
    const type = selectedType();
    if (type !== 'custom') return POKER_DECK_PRESETS[type].join(', ');
    const parsed = parseCustomChoices(customChoices());
    return parsed.length >= 2 ? parsed.join(', ') : 'Enter at least two choices.';
  };
  let choicesInput: HTMLTextAreaElement | undefined;

  onSettled(() => { setReady(true); });

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen && !confirming()) {
      setDraftType(undefined);
      setDraftChoices(undefined);
      setFieldError('');
      setError('');
    }
  }

  async function save() {
    if (busy() || confirming() || !ready()) return;
    const type = selectedType();
    const choices = type === 'custom' ? parseCustomChoices(customChoices()) : POKER_DECK_PRESETS[type];
    if (isSamePokerDeck(props, type, choices)) {
      setDraftType(undefined);
      setDraftChoices(undefined);
      setOpen(false);
      return;
    }

    const deck: PokerDeckCommand['deck'] = type === 'custom' ? { type, choices: [...choices] } : { type };
    const discardRoundId = props.discardRoundId;
    if (discardRoundId !== undefined && (type !== 'custom' || (choices.length >= 2 && new Set(choices).size === choices.length))) {
      setConfirming(true);
      setOpen(false);
      try {
        const confirmed = await confirmBoardAction({
          title: 'Change Deck and restart voting?',
          description: 'Changing the Deck discards the current Voting Round and its votes. Existing Accepted Estimates stay as they are.',
          cancelLabel: 'Keep current Deck',
          confirmLabel: 'Change Deck & restart',
          agentConfirm: 'Changes the Deck, discards the current Voting Round and its votes, and keeps existing Accepted Estimates.',
        });
        if (!confirmed) {
          setOpen(true);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        setConfirming(false);
      }
    }

    setBusy(true);
    setError('');
    setFieldError('');
    try {
      const result = await props.onChange({
        type: 'set-deck',
        deck,
        ...(discardRoundId === undefined ? {} : { discardRoundId }),
      });
      if (result.ok) {
        setDraftType(undefined);
        setDraftChoices(undefined);
        setOpen(false);
      } else if (type === 'custom' && result.code === 'INVALID_INPUT') {
        setFieldError(result.message);
        setOpen(true);
        queueMicrotask(() => choicesInput?.focus());
      } else {
        setError(result.message);
        setOpen(true);
      }
    } catch {
      setError('Could not save the Deck. Try again.');
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show
      when={props.canManage}
      fallback={
        <div
          class="poker-bar-chip"
          title={`${deckName[props.deckType]}: ${props.deck.join(', ')}`}
          role="status"
        >
          <LucideIcon icon={Layers} class="size-3.5 shrink-0 text-text-muted" strokeWidth={1.9} />
          <span>{deckName[props.deckType]}</span>
          <span class="sr-only"> ({props.deck.join(', ')})</span>
        </div>
      }
    >
      <Popover open={open()} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          class="poker-bar-chip poker-bar-chip-interactive spring-press board-focus-ring"
          aria-label="Deck settings"
          title={`Deck: ${deckName[props.deckType]} (${props.deck.join(', ')})`}
        >
          <LucideIcon icon={Layers} class="size-3.5 shrink-0 text-text-muted" strokeWidth={1.9} />
          <span>{deckName[props.deckType]}</span>
          <LucideIcon icon={ChevronDown} class="size-3 shrink-0 text-text-muted" strokeWidth={2} />
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          class="board-popover z-40 w-[min(22rem,calc(100vw-1.5rem))] rounded-lg p-4 text-text"
        >
          <PopoverTitle class="text-sm font-semibold">Deck settings</PopoverTitle>
          <PopoverDescription class="mt-0.5 text-xs text-text-muted">
            Changing the Deck during a round with votes restarts voting. Existing estimates stay as they are.
          </PopoverDescription>
          <p
            class="mt-2.5 rounded-md bg-surface-subtle/70 px-2.5 py-1.5 text-xs text-text-muted [overflow-wrap:anywhere]"
            role="status"
          >
            <span class="font-semibold text-text">{deckName[selectedType()]}</span>{' · '}
            <span>{previewDetail()}</span>
          </p>
          <form
            aria-label="Deck settings"
            aria-busy={busy() ? 'true' : 'false'}
            class="poker-form mt-3 grid gap-3"
            method="post"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <RadioGroup
              aria-label="Deck preset"
              class="poker-deck-types"
              value={selectedType()}
              disabled={!ready()}
              readOnly={busy()}
              onValueChange={(value) => {
                setDraftType(deckTypes.find((type) => value === type));
                setFieldError('');
                setError('');
              }}
            >
              <For each={deckTypes}>
                {(type) => (
                  <Radio class="poker-deck-option board-focus-ring" value={type}>
                    {deckName[type]}
                  </Radio>
                )}
              </For>
            </RadioGroup>
            <Show when={selectedType() === 'custom'}>
              <Field name="choices" invalid={fieldError() ? true : undefined} class="grid min-w-0 gap-1.5">
                <FieldLabel class="text-xs font-semibold text-text-muted">Custom choices</FieldLabel>
                <FieldDescription class="text-xs text-text-muted">
                  Enter one choice per line, in the order they should appear.
                </FieldDescription>
                <Textarea
                  ref={choicesInput}
                  class="poker-input poker-deck-input board-focus-ring"
                  rows={3}
                  value={customChoices()}
                  onValueChange={(value) => {
                    setDraftChoices(value);
                    setFieldError('');
                  }}
                  readonly={busy() || !ready()}
                  required
                />
                <FieldError match="valueMissing" class="poker-error-text text-xs font-medium">
                  Enter your Deck choices.
                </FieldError>
                <Show when={fieldError()}>
                  <FieldError match class="poker-error-text text-xs font-medium">{fieldError()}</FieldError>
                </Show>
              </Field>
            </Show>
            <div class="flex flex-wrap items-center gap-2">
              <Button
                class="poker-primary spring-press board-focus-ring"
                type="submit"
                disabled={busy() || !ready()}
                focusableWhenDisabled={ready()}
              >
                Save Deck
              </Button>
              <PopoverClose class="poker-ghost spring-press board-focus-ring">
                Cancel
              </PopoverClose>
            </div>
            <p role="alert" class={error() ? 'poker-error-text text-xs font-medium' : 'sr-only'}>{error()}</p>
          </form>
        </PopoverContent>
      </Popover>
    </Show>
  );
}
