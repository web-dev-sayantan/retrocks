import { Button } from '@ui-sdk/solid/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@ui-sdk/solid/field';
import { Radio, RadioGroup } from '@ui-sdk/solid/radio';
import { Textarea } from '@ui-sdk/solid/textarea';
import { For, Show, createSignal, createUniqueId, onSettled } from 'solid-js';

import type { PokerDeckCommand, PokerDeckType, PokerResult } from '../../lib/poker-types';

const deckTypes = ['fibonacci', 't-shirt', 'custom'] as const;
const deckName: Record<PokerDeckType, string> = {
  fibonacci: 'Fibonacci',
  't-shirt': 'T-shirt',
  custom: 'Custom',
};

export default function PokerDeckSettings(props: {
  deck: readonly string[];
  deckType: PokerDeckType;
  locked: boolean;
  canManage: boolean;
  onChange: (command: PokerDeckCommand) => Promise<PokerResult>;
}) {
  const titleId = createUniqueId();
  const [draftType, setDraftType] = createSignal<PokerDeckType>();
  const [draftChoices, setDraftChoices] = createSignal<string>();
  const [busy, setBusy] = createSignal(false);
  const [ready, setReady] = createSignal(false);
  const [fieldError, setFieldError] = createSignal('');
  const [error, setError] = createSignal('');
  const selectedType = () => draftType() ?? props.deckType;
  const customChoices = () => draftChoices() ?? (props.deckType === 'custom' ? props.deck.join('\n') : '');
  let choicesInput: HTMLTextAreaElement | undefined;

  onSettled(() => { setReady(true); });

  async function save() {
    if (busy() || !ready() || props.locked) return;
    const type = selectedType();
    const deck = type === 'custom' ? { type, choices: customChoices().split('\n') } : { type };
    setBusy(true);
    setError('');
    setFieldError('');
    try {
      const result = await props.onChange({ type: 'set-deck', deck });
      if (result.ok) {
        setDraftType(undefined);
        setDraftChoices(undefined);
      } else if (type === 'custom' && result.code === 'INVALID_INPUT') {
        setFieldError(result.message);
        queueMicrotask(() => choicesInput?.focus());
      } else {
        setError(result.message);
      }
    } catch {
      setError('Could not save the Deck. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="poker-voting mt-5 border-t pt-4">
      <h3 class="text-sm font-semibold" id={titleId}>Deck</h3>
      <p class="mt-1 text-sm [overflow-wrap:anywhere]" role="status">
        <span class="font-semibold">{deckName[props.deckType]}</span>{' · '}
        <span>{props.deck.join(', ')}</span>
      </p>
      <Show when={props.canManage}>
        <Show when={!props.locked} fallback={<p class="mt-2 text-sm">The Deck is locked.</p>}>
          <form
            aria-label="Deck settings"
            aria-busy={busy() ? 'true' : 'false'}
            class="mt-3 grid gap-2"
            method="post"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <RadioGroup
              aria-labelledby={titleId}
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
                {(type) => <Radio class="poker-story-control board-focus-ring" value={type}>{deckName[type]}</Radio>}
              </For>
            </RadioGroup>
            <Show when={selectedType() === 'custom'}>
              <Field name="choices" invalid={fieldError() ? true : undefined} class="grid min-w-0 gap-1">
                <FieldLabel class="text-sm font-semibold">Custom choices</FieldLabel>
                <FieldDescription class="text-sm">Enter one choice per line, in the order they should appear.</FieldDescription>
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
                <FieldError match="valueMissing" class="text-sm text-[var(--poker-error)]">Enter your Deck choices.</FieldError>
                <Show when={fieldError()}>
                  <FieldError match class="text-sm font-medium text-[var(--poker-error)]">{fieldError()}</FieldError>
                </Show>
              </Field>
            </Show>
            <div class="flex flex-wrap items-center gap-2">
              <Button
                class="poker-story-control board-focus-ring"
                type="submit"
                disabled={busy() || !ready()}
                focusableWhenDisabled={ready()}
              >
                Save Deck
              </Button>
              <p class="text-sm">The Deck locks when voting starts.</p>
            </div>
            <p role="alert" class={error() ? 'text-sm font-medium text-[var(--poker-error)]' : 'sr-only'}>{error()}</p>
          </form>
        </Show>
      </Show>
    </div>
  );
}
