import type { JSX } from '@solidjs/web';
import { X } from 'lucide';
import LucideIcon from './LucideIcon';

export default function BoardOverlayHeader(props: {
  children: JSX.Element;
  closeLabel: string;
  onClose: () => void;
  closeRef?: (button: HTMLButtonElement) => void;
}) {
  return (
    <div class="board-overlay-header">
      {props.children}
      <button
        ref={props.closeRef}
        type="button"
        aria-label={props.closeLabel}
        class="spring-press inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent text-text-muted transition-colors hover:bg-surface-subtle hover:text-text board-focus-ring sm:size-9 sm:min-h-0 sm:min-w-0"
        onClick={() => props.onClose()}
      >
        <LucideIcon icon={X} />
      </button>
    </div>
  );
}
