import { Button } from '@ui-sdk/solid/button';
import { Radio, RadioGroup, createRadioGroupController } from '@ui-sdk/solid/radio';
import { For, Show, createSignal, createUniqueId, onSettled, untrack } from 'solid-js';

export default function PokerEstimateForm(props: {
  deck: readonly string[];
  busy: boolean;
  initialChoice?: string;
  onSave: (choice: string) => void;
  onCancel?: () => void;
}) {
  const headingId = createUniqueId();
  const initialChoice = untrack(() => props.initialChoice ?? null);
  const [choice, setChoice] = createSignal(initialChoice);
  let initialRadio: HTMLButtonElement | undefined;
  const [ready, setReady] = createSignal(false);
  const controller = createRadioGroupController();
  const editing = () => props.onCancel !== undefined;

  onSettled(() => {
    setReady(true);
    if (editing()) initialRadio?.focus();
  });

  return (
    <form
      class="poker-form mt-3"
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
      <p id={headingId} class="text-sm font-semibold">
        {editing() ? 'Correct Accepted Estimate' : 'Accepted Estimate'}
      </p>
      <RadioGroup
        class="poker-deck mt-2"
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
              class="poker-vote-tile board-focus-ring"
              value={value}
            >
              {value}
            </Radio>
          )}
        </For>
      </RadioGroup>
      <div class="mt-3 flex flex-wrap gap-2">
        <Button
          type="submit"
          class="poker-primary board-focus-ring"
          disabled={props.busy || !ready()}
          focusableWhenDisabled={ready()}
        >
          {editing() ? 'Save estimate' : 'Confirm estimate'}
        </Button>
        <Show when={props.onCancel}>
          <Button type="button" class="poker-secondary board-focus-ring" disabled={props.busy} onClick={() => props.onCancel?.()}>
            Cancel
          </Button>
        </Show>
      </div>
    </form>
  );
}
