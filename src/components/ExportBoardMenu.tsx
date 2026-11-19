import { Show, createEffect, createMemo, createSignal, createUniqueId, onSettled } from 'solid-js';

import {
  buildExportFilename,
  buildExportUrl,
  formatBoardMarkdown,
} from '../lib/board-export';
import type { BoardViewDTO } from '../lib/board-types';
import { DownloadIcon } from './Icons';

export interface ExportBoardMenuProps {
  board: BoardViewDTO;
}

const menuItemClass = [
  'flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-text sm:min-h-9',
  'transition-colors hover:bg-surface-subtle',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
];

export default function ExportBoardMenu(props: ExportBoardMenuProps) {
  const menuId = createUniqueId();
  let root!: HTMLDivElement;
  let trigger!: HTMLButtonElement;
  let menu: HTMLDivElement | undefined;

  const [open, setOpen] = createSignal(false);
  const [copyStatus, setCopyStatus] = createSignal('');

  const visibilityNote = createMemo(() => {
    const blurred = props.board.isBlurred;
    const blind = props.board.blindVoting;
    if (blurred && blind) {
      return 'Private Mode & Blind Voting are active — hidden Cards and aggregate Vote totals stay omitted.';
    }
    if (blurred) {
      return 'Private Mode is active — other Participants’ Cards stay hidden in exports.';
    }
    if (blind) {
      return 'Blind Voting is active — aggregate Vote totals stay omitted in exports.';
    }
    return '';
  });

  function closeMenu(restoreFocus: boolean): void {
    setOpen(false);
    setCopyStatus('');
    if (restoreFocus) {
      trigger.focus();
    }
  }

  createEffect(open, (isOpen) => {
    if (isOpen) {
      menu?.focus();
    }
  });

  onSettled(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.isComposing) return;
      if (open() && event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
      }
    }

    function handlePointerDown(event: PointerEvent): void {
      if (
        open() &&
        event.target instanceof Node &&
        !root.contains(event.target)
      ) {
        closeMenu(false);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  });

  async function handleCopyMarkdown(): Promise<void> {
    const markdown = formatBoardMarkdown(props.board);
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyStatus('Copied Markdown!');
    } catch {
      setCopyStatus('Could not copy to the clipboard.');
    }
  }

  function handlePrint(): void {
    setOpen(false);
    setCopyStatus('');
    window.print();
  }

  return (
    <div
      ref={root}
      class="shrink-0 sm:relative"
      onFocusOut={(event) => {
        if (
          open() &&
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          closeMenu(false);
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open() ? 'true' : 'false'}
        aria-controls={open() ? menuId : undefined}
        onClick={() => {
          if (open()) {
            closeMenu(true);
          } else {
            setCopyStatus('');
            setOpen(true);
          }
        }}
        class={[
          'inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-text sm:min-h-9 sm:px-3',
          'transition-colors hover:bg-surface-subtle',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        ]}
      >
        <DownloadIcon class="h-3.5 w-3.5" />
        <span>Export</span>
      </button>

      <Show when={open()}>
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label="Export Board"
          data-board-overlay="true"
          tabindex={-1}
          class="fixed inset-x-4 top-14 z-30 rounded-xl border border-border bg-surface p-1.5 text-text shadow-lg focus:outline-none sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-64"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => void handleCopyMarkdown()}
            class={menuItemClass}
          >
            <span>Copy Markdown</span>
            <span
              aria-hidden="true"
              class="text-[11px] font-normal text-text-muted"
            >
              Clipboard
            </span>
          </button>

          <a
            role="menuitem"
            href={buildExportUrl(props.board.id, 'md')}
            download={buildExportFilename(props.board.title, 'md')}
            onClick={() => closeMenu(false)}
            class={menuItemClass}
          >
            <span>Download Markdown</span>
            <span
              aria-hidden="true"
              class="font-mono text-[11px] font-normal text-text-muted"
            >
              .md
            </span>
          </a>

          <a
            role="menuitem"
            href={buildExportUrl(props.board.id, 'csv')}
            download={buildExportFilename(props.board.title, 'csv')}
            onClick={() => closeMenu(false)}
            class={menuItemClass}
          >
            <span>Download CSV</span>
            <span
              aria-hidden="true"
              class="font-mono text-[11px] font-normal text-text-muted"
            >
              .csv
            </span>
          </a>

          <a
            role="menuitem"
            href={buildExportUrl(props.board.id, 'json')}
            download={buildExportFilename(props.board.title, 'json')}
            onClick={() => closeMenu(false)}
            class={menuItemClass}
          >
            <span>Download JSON</span>
            <span
              aria-hidden="true"
              class="font-mono text-[11px] font-normal text-text-muted"
            >
              .json
            </span>
          </a>

          <div class="my-1 border-t border-border" role="separator" />

          <button
            type="button"
            role="menuitem"
            onClick={handlePrint}
            class={menuItemClass}
          >
            <span>Print / Save as PDF</span>
          </button>

          <Show when={copyStatus()}>
            <p
              role="status"
              class="mt-1 border-t border-border px-2.5 pt-2 pb-1 text-[11px] font-medium text-text-muted"
            >
              {copyStatus()}
            </p>
          </Show>

          <Show when={visibilityNote()}>
            <p class="mt-1 border-t border-border px-2.5 pt-2 pb-1 text-[11px] leading-snug text-text-muted">
              {visibilityNote()}
            </p>
          </Show>
        </div>
      </Show>
    </div>
  );
}
