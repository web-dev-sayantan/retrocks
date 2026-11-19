import { Show, createMemo, createSignal } from 'solid-js';

import {
  buildExportFilename,
  buildExportUrl,
  formatBoardMarkdown,
} from '../lib/board-export';
import type { BoardViewDTO } from '../lib/board-types';

export interface ExportBoardMenuProps {
  board: BoardViewDTO;
  onClose: () => void;
}

export default function ExportBoardMenu(props: ExportBoardMenuProps) {
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

  async function handleCopyMarkdown(): Promise<void> {
    const markdown = formatBoardMarkdown(props.board);
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyStatus('Copied Markdown!');
    } catch {
      setCopyStatus('Could not copy to the clipboard.');
    }
  }

  return (
    <>
      <button
        type="button"
        role="menuitem"
        onClick={() => void handleCopyMarkdown()}
        class="board-menu-item"
      >
        <span>Copy Markdown</span>
        <span
          aria-hidden="true"
          class="text-[11px] font-normal text-text/80"
        >
          Clipboard
        </span>
      </button>

      <a
        role="menuitem"
        href={buildExportUrl(props.board.id, 'md')}
        download={buildExportFilename(props.board.title, 'md')}
        onClick={() => props.onClose()}
        class="board-menu-item"
      >
        <span>Download Markdown</span>
        <span
          aria-hidden="true"
          class="font-mono text-[11px] font-normal text-text/80"
        >
          .md
        </span>
      </a>

      <a
        role="menuitem"
        href={buildExportUrl(props.board.id, 'csv')}
        download={buildExportFilename(props.board.title, 'csv')}
        onClick={() => props.onClose()}
        class="board-menu-item"
      >
        <span>Download CSV</span>
        <span
          aria-hidden="true"
          class="font-mono text-[11px] font-normal text-text/80"
        >
          .csv
        </span>
      </a>

      <a
        role="menuitem"
        href={buildExportUrl(props.board.id, 'json')}
        download={buildExportFilename(props.board.title, 'json')}
        onClick={() => props.onClose()}
        class="board-menu-item"
      >
        <span>Download JSON</span>
        <span
          aria-hidden="true"
          class="font-mono text-[11px] font-normal text-text/80"
        >
          .json
        </span>
      </a>

      <div class="my-1 border-t border-border" role="separator" />

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          props.onClose();
          window.print();
        }}
        class="board-menu-item"
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
    </>
  );
}
