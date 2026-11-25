import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@ui-sdk/solid/alert-dialog';
import { Show } from 'solid-js';

import { confirmBoardAction, type BoardConfirmation } from '../lib/board-confirm';

const cancelButtonClass = 'spring-press inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-border bg-surface px-3.5 py-2 text-xs font-medium text-text-muted hover:bg-surface-subtle hover:text-text board-focus-ring sm:min-h-9';
const confirmButtonClass = 'spring-press inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md bg-rose-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-rose-800 board-focus-ring sm:min-h-9';

export default function BoardConfirmDialog() {
  return (
    <AlertDialog controller={confirmBoardAction.controller}>
      <AlertDialogBackdrop data-print-hide="true" class="board-dialog-backdrop z-40" />
      <AlertDialogContent<BoardConfirmation>
        data-board-overlay="true"
        data-print-hide="true"
        class="board-dialog-surface z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-surface p-5 text-text shadow-2xl"
      >
        {(state) => (
          <>
            <AlertDialogTitle class="text-base font-semibold tracking-[-0.015em] text-text">
              {state.payload?.title}
            </AlertDialogTitle>
            <Show when={state.payload?.description}>
              <AlertDialogDescription class="mt-1.5 text-sm leading-snug text-text-muted">
                {state.payload?.description}
              </AlertDialogDescription>
            </Show>
            <div class="mt-4 flex flex-wrap items-center justify-end gap-2">
              <AlertDialogClose class={cancelButtonClass}>
                {state.payload?.cancelLabel ?? 'Cancel'}
              </AlertDialogClose>
              <AlertDialogClose value="confirm" class={confirmButtonClass} data-agent-confirm={state.payload?.agentConfirm}>
                {state.payload?.confirmLabel ?? 'Confirm'}
              </AlertDialogClose>
            </div>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
