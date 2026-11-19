import { For, Show, createMemo } from 'solid-js';

import {
  buildExportFilename,
  buildExportUrl,
  formatBoardMarkdown,
} from '../lib/board-export';
import type { BoardViewDTO } from '../lib/board-types';

export interface ExportFeedback {
  message: string;
  error?: boolean;
}

export interface ExportBoardMenuProps {
  board: BoardViewDTO;
  onClose: () => void;
  onFeedback: (feedback: ExportFeedback | null) => void;
}

const downloads = [
  { label: 'Markdown', format: 'md' },
  { label: 'CSV', format: 'csv' },
  { label: 'JSON', format: 'json' },
] as const;

export default function ExportBoardMenu(props: ExportBoardMenuProps) {
  let latestAttempt = 0;

  const visibilityNote = createMemo(() => {
    const blurred = props.board.isBlurred;
    const blind = props.board.blindVoting;
    if (blurred && blind) {
      return 'Private Mode and Blind Voting are active. Other Participants’ Cards and total Votes stay hidden in exports.';
    }
    if (blurred) {
      return 'Private Mode is active. Other Participants’ Cards stay hidden in exports.';
    }
    if (blind) {
      return 'Blind Voting is active. Total Votes stay hidden in exports.';
    }
    return '';
  });

  function beginExport(feedback: ExportFeedback | null) {
    const attempt = ++latestAttempt;
    const boardId = props.board.id;
    props.onClose();
    props.onFeedback(feedback);
    return (result: ExportFeedback) => {
      if (attempt === latestAttempt && props.board.id === boardId) {
        props.onFeedback(result);
      }
    };
  }

  async function handleCopyMarkdown(): Promise<void> {
    const report = beginExport({ message: 'Copying Markdown…' });
    try {
      await navigator.clipboard.writeText(formatBoardMarkdown(props.board));
      report({ message: 'Markdown copied.' });
    } catch {
      report({ message: 'Could not copy Markdown. Try again.', error: true });
    }
  }

  async function handleDownload(event: MouseEvent & { currentTarget: HTMLAnchorElement }, label: string): Promise<void> {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const { href, download } = event.currentTarget;
    const report = beginExport({ message: `Preparing ${label} download…` });

    try {
      const response = await fetch(href);
      if (!response.ok) throw new Error(`Export returned ${response.status}`);
      const filename = response.headers.get('content-disposition')?.match(/filename="([a-z0-9.-]+)"/)?.[1];
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = filename ?? download;
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      report({ message: `${label} download started.` });
    } catch {
      report({ message: `Could not download ${label}. Try again.`, error: true });
    }
  }

  function handlePrint(): void {
    const report = beginExport(null);
    try {
      window.print();
    } catch {
      report({ message: 'Could not open print. Try again.', error: true });
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
        <span aria-hidden="true" class="text-[11px] font-normal text-text-muted">
          Clipboard
        </span>
      </button>

      <For each={downloads}>
        {(download) => (
          <a
            role="menuitem"
            href={buildExportUrl(props.board.id, download.format)}
            download={buildExportFilename(props.board.title, download.format)}
            onClick={(event) => void handleDownload(event, download.label)}
            class="board-menu-item"
          >
            <span>Download {download.label}</span>
            <span aria-hidden="true" class="font-mono text-[11px] font-normal text-text-muted">
              .{download.format}
            </span>
          </a>
        )}
      </For>

      <div class="my-1 border-t border-border" role="separator" />

      <button type="button" role="menuitem" onClick={handlePrint} class="board-menu-item">
        Print / Save as PDF
      </button>

      <Show when={visibilityNote()}>
        <p class="mt-1 border-t border-border px-2.5 pt-2 pb-1 text-xs leading-snug text-text-muted">
          {visibilityNote()}
        </p>
      </Show>
    </>
  );
}
