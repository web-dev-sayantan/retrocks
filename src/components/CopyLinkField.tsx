import { Button } from '@ui-sdk/solid/button';
import { toast } from '@ui-sdk/solid/toast';
import { Show, createSignal, createUniqueId, onSettled } from 'solid-js';

export interface CopyLinkFieldProps {
  label: string;
  href: string;
  labelId?: string;
  primary?: boolean;
  buttonLabel?: string;
  buttonAriaLabel?: string;
  feedback?: 'inline' | 'toast';
  variant?: 'board' | 'poker';
}

const boardButtonBase = [
  'inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm font-medium',
  'transition-colors board-focus-ring aria-disabled:cursor-wait aria-disabled:opacity-60',
];
const boardPrimaryButton = [
  boardButtonBase,
  'border-transparent bg-accent text-accent-contrast hover:opacity-90 active:opacity-80',
];
export const boardSecondaryButton = [
  boardButtonBase,
  'border-control bg-surface text-text hover:bg-surface-subtle active:bg-surface-subtle',
];

function resolveShareUrl(href: string, origin: string): string {
  if (/^https?:\/\//.test(href)) return href;
  return `${origin}${href}`;
}

export default function CopyLinkField(props: CopyLinkFieldProps) {
  const inputId = createUniqueId();
  const [origin, setOrigin] = createSignal('');
  const [message, setMessage] = createSignal('');
  let input!: HTMLInputElement;
  let feedbackTimer: ReturnType<typeof setTimeout>;
  let lastAnnounced = '';

  onSettled(() => {
    setOrigin(window.location.origin);
    function handleCommand(event: Event) {
      if (event instanceof CommandEvent && event.command === '--copy') {
        void copy(event.source);
      }
    }
    input.addEventListener('command', handleCommand);
    return () => {
      input.removeEventListener('command', handleCommand);
      clearTimeout(feedbackTimer);
    };
  });

  const link = () => resolveShareUrl(props.href, origin());
  const isPoker = () => props.variant === 'poker';
  const feedbackMode = () => props.feedback ?? 'inline';
  const visibleButtonLabel = () => props.buttonLabel ?? `Copy ${props.label.toLowerCase()}`;

  async function copy(button: Element | null) {
    if (button instanceof HTMLButtonElement) {
      button.focus();
    }
    const text = input.value;
    let feedback: string;
    let succeeded = false;
    try {
      await navigator.clipboard.writeText(text);
      feedback = `${props.label} copied.`;
      succeeded = true;
    } catch {
      if (button === document.activeElement && input.isConnected) {
        input.focus();
        input.select();
        feedback = 'Copy the selected link manually.';
      } else {
        feedback = 'Select the link to copy it manually.';
      }
    }

    if (!input.isConnected) return;
    if (feedbackMode() === 'toast') {
      if (succeeded) toast.success(feedback);
      else toast.info(feedback);
      return;
    }

    const announced = feedback === lastAnnounced ? `${feedback}\u00A0` : feedback;
    lastAnnounced = announced;
    setMessage(announced);
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => setMessage(''), 4_000);
  }

  return (
    <div class={props.labelId ? undefined : 'grid min-w-0 gap-1.5'}>
      <Show when={!props.labelId}>
        <label for={inputId} class="text-xs font-semibold text-text-muted">
          {props.label}
        </label>
      </Show>
      <div class={isPoker() ? 'flex flex-wrap gap-2' : 'flex gap-2'}>
        <input
          id={inputId}
          ref={input}
          aria-labelledby={props.labelId}
          class={
            isPoker()
              ? 'board-modal-field board-focus-ring min-h-11 min-w-0 flex-[1_1_12rem] px-3 text-base sm:min-h-9 sm:text-sm [overflow-wrap:anywhere]'
              : 'board-modal-field min-h-11 min-w-0 flex-1 px-3 text-base'
          }
          type="text"
          value={link()}
          readonly
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          type="button"
          command="--copy"
          commandfor={inputId}
          aria-label={props.buttonAriaLabel}
          class={[
            'shrink-0',
            isPoker()
              ? [props.primary ? 'poker-primary' : 'poker-secondary', 'spring-press board-focus-ring']
              : props.primary
                ? boardPrimaryButton
                : boardSecondaryButton,
          ]}
          onClick={(event) => {
            if (!('CommandEvent' in window)) void copy(event.currentTarget);
          }}
        >
          {visibleButtonLabel()}
        </Button>
      </div>
      <Show when={feedbackMode() === 'inline'}>
        <p class={message() ? 'text-xs text-text-muted' : 'sr-only'} role="status">
          {message()}
        </p>
      </Show>
    </div>
  );
}
