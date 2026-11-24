import { Button } from '@ui-sdk/solid/button';
import { Radio, RadioGroup, createRadioGroupController } from '@ui-sdk/solid/radio';
import { For, Show, createMemo, createSignal, createUniqueId, onSettled, untrack } from 'solid-js';

export default function PokerEstimateForm(props: {
  deck: readonly string[];
  busy: boolean;
  initialChoice?: string;
  votedChoices?: ReadonlySet<string>;
  compact?: boolean;
  onSave: (choice: string) => void;
  onCancel?: () => void;
}) {
  const headingId = createUniqueId();
  const initialChoice = untrack(() => (
    props.initialChoice !== undefined && props.deck.includes(props.initialChoice) ? props.initialChoice : null
  ));
  const [choice, setChoice] = createSignal(initialChoice);
  let initialRadio: HTMLButtonElement | undefined;
  const [ready, setReady] = createSignal(false);
  const controller = createRadioGroupController();
  const editing = () => props.onCancel !== undefined;
  const deckKey = createMemo(() => props.deck.join('\0'));

  onSettled(() => {
    setReady(true);
    if (editing()) initialRadio?.focus();
  });

  return (
    <form
      class={['poker-form w-full', editing() ? 'mt-3 text-left' : 'flex flex-col items-center']}
      method="post"
      aria-labelledby={headingId}
      aria-busy={props.busy ? 'true' : 'false'}
      onSubmit={(event) => {
        event.preventDefault();
        if (props.busy || !ready()) return;
        const value = choice();
        if (value === null) controller.focus();
        else props.onSave(value);
      }}
    >
      <p id={headingId} class="text-xs font-semibold text-text-muted">
        {editing() ? 'Correct Accepted Estimate' : 'Accepted Estimate'}
      </p>
      <Show when={deckKey()} keyed>
        {(_deckKey) => (
          <RadioGroup
            class={['poker-deck mt-2.5', editing() ? '!justify-start' : '']}
            aria-labelledby={headingId}
            controller={controller}
            name="estimate"
            value={choice()}
            required
            readOnly={props.busy || !ready()}
            onValueChange={(value) => setChoice(value)}
          >
            <For each={props.deck}>
              {(value) => (
                <Radio
                  ref={(element) => { if (value === initialChoice) initialRadio = element; }}
                  data-voted-hint={props.votedChoices?.has(value) ? 'true' : undefined}
                  class="poker-vote-tile poker-vote-tile-compact board-focus-ring"
                  value={value}
                >
                  {value}
                </Radio>
              )}
            </For>
          </RadioGroup>
        )}
      </Show>
      <div class={['mt-3 flex flex-wrap items-center gap-2', editing() ? '' : 'justify-center']}>
        <Button
          type="submit"
          class={['poker-primary spring-press board-focus-ring', editing() ? '' : '!rounded-full !px-4']}
          disabled={props.busy || !ready()}
          focusableWhenDisabled={ready()}
        >
          {editing() ? 'Save estimate' : 'Confirm estimate'}
        </Button>
        <Show when={props.onCancel}>
          <Button
            type="button"
            class="poker-ghost spring-press board-focus-ring"
            disabled={props.busy}
            onClick={() => props.onCancel?.()}
          >
            Cancel
          </Button>
        </Show>
      </div>
    </form>
  );
}
