import { MenuItem, MenuSeparator } from '@ui-sdk/solid/menu';
import { toast } from '@ui-sdk/solid/toast';
import { For, Show, createMemo } from 'solid-js';

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

  function beginExport(toastId: string, working: string): (result: { message: string; error?: boolean }) => void {
    const attempt = ++latestAttempt;
    const boardId = props.board.id;
    props.onClose();
    toast.loading(working, { id: toastId });
    return (result) => {
      // Only the newest attempt reports; a stale response stays silent.
      if (attempt !== latestAttempt || props.board.id !== boardId) return;
      if (result.error) {
        toast.update(toastId, { type: 'error', title: result.message });
      } else {
        toast.update(toastId, { type: 'success', title: result.message });
      }
    };
  }

  async function handleCopyMarkdown(): Promise<void> {
    const report = beginExport(`export-md-${props.board.id}`, 'Copying Markdown…');
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
    const report = beginExport(`export-${label.toLowerCase()}-${props.board.id}`, `Preparing ${label} download…`);

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
    props.onClose();
    try {
      window.print();
    } catch {
      toast.error('Could not open print. Try again.');
    }
  }

  return (
    <>
      <MenuItem
        value="copy-markdown"
        onSelect={() => void handleCopyMarkdown()}
        class="board-menu-item"
      >
        <span>Copy Markdown</span>
        <span aria-hidden="true" class="text-[11px] font-normal text-text-muted">
          Clipboard
        </span>
      </MenuItem>

      <For each={downloads}>
        {(download) => (
          <MenuItem
            value={`download-${download.format}`}
            class="board-menu-item"
            render={(itemProps) => (
              <a
                {...itemProps}
                href={buildExportUrl(props.board.id, download.format)}
                download={buildExportFilename(props.board.title, download.format)}
                onClick={(event) => {
                  void handleDownload(event, download.label);
                }}
              >
                <span>Download {download.label}</span>
                <span aria-hidden="true" class="font-mono text-[11px] font-normal text-text-muted">
                  .{download.format}
                </span>
              </a>
            )}
          />
        )}
      </For>

      <MenuSeparator class="my-1 border-t border-border/75" />

      <MenuItem value="print-board" onSelect={handlePrint} class="board-menu-item">
        Print / Save as PDF
      </MenuItem>

      <Show when={visibilityNote()}>
        <p class="mt-1 border-t border-border/75 px-2.5 pt-2 pb-1 text-xs leading-snug text-text-muted">
          {visibilityNote()}
        </p>
      </Show>
    </>
  );
}
