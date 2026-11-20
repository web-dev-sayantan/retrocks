import { Button } from '@ui-sdk/solid/button';
import { createSignal, createUniqueId, onSettled } from 'solid-js';

export default function CopyRoomLink(props: { label: string; href: string }) {
  const linkId = createUniqueId();
  const [origin, setOrigin] = createSignal('');
  const [message, setMessage] = createSignal('');
  let input!: HTMLInputElement;
  let feedbackTimer: ReturnType<typeof setTimeout>;

  onSettled(() => {
    setOrigin(window.location.origin);
    function handleCommand(event: Event) {
      if (event instanceof CommandEvent && event.command === '--copy') void copy(event.source);
    }
    input.addEventListener('command', handleCommand);
    return () => {
      input.removeEventListener('command', handleCommand);
      clearTimeout(feedbackTimer);
    };
  });

  const link = () => `${origin()}${props.href}`;
  async function copy(button: Element | null) {
    let feedback: string;
    try {
      await navigator.clipboard.writeText(input.value);
      feedback = `${props.label} copied.`;
    } catch {
      if (button === document.activeElement && input.isConnected) {
        input.focus();
        feedback = 'Copy the selected link manually.';
      } else {
        feedback = 'Select the link to copy it manually.';
      }
    }
    if (!input.isConnected) return;
    setMessage(feedback);
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => setMessage(''), 4_000);
  }

  return (
    <div class="grid min-w-0 gap-2">
      <label for={linkId} class="text-sm font-semibold">{props.label}</label>
      <div class="flex flex-wrap gap-2">
        <input
          id={linkId}
          ref={input}
          class="poker-input board-focus-ring flex-[1_1_14rem]"
          type="text"
          value={link()}
          readonly
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          type="button"
          command="--copy"
          commandfor={linkId}
          class="poker-secondary board-focus-ring"
          onClick={(event) => { if (!('CommandEvent' in window)) void copy(event.currentTarget); }}
        >
          Copy {props.label.toLowerCase()}
        </Button>
      </div>
      <p class="text-sm text-text-muted" role="status">{message()}</p>
    </div>
  );
}
