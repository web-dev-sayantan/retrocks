import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@ui-sdk/solid/alert-dialog';
import { createSignal } from 'solid-js';

import { deletePokerRoom } from '../../lib/poker-actions';

export default function PokerRoomDeletion(props: { roomId: string; onUnavailable: () => void }) {
  const [error, setError] = createSignal('');

  async function removeRoom() {
    setError('');
    try {
      const result = await deletePokerRoom(props.roomId);
      if (!result.ok && result.code !== 'ROOM_NOT_FOUND') {
        setError(result.message);
        throw new Error(result.message);
      }
    } catch (error) {
      setError((message) => message || 'Could not delete the Room. Try again.');
      throw error;
    }
    props.onUnavailable();
  }

  return (
    <AlertDialog onOpenChange={() => setError('')} pendingAnnouncement="Deleting the Room…">
      <AlertDialogTrigger class="poker-story-control board-focus-ring text-[var(--poker-error)]">
        Delete Room
      </AlertDialogTrigger>
      <AlertDialogBackdrop class="board-dialog-backdrop z-40" />
      <AlertDialogContent class="board-dialog-surface z-50 w-[min(22rem,calc(100vw-2rem))] overscroll-contain rounded-2xl border border-border bg-surface p-5 text-text shadow-2xl">
        <AlertDialogTitle class="font-semibold">Delete Room?</AlertDialogTitle>
        <AlertDialogDescription class="mt-2 text-sm text-text-muted">
          This permanently deletes the Room, its Stories, and any estimates. The participant link will stop working for everyone.
        </AlertDialogDescription>
        <div class="mt-4 flex flex-wrap justify-end gap-2">
          <AlertDialogClose class="poker-story-control board-focus-ring">Cancel</AlertDialogClose>
          <AlertDialogClose
            class="board-focus-ring min-h-11 cursor-pointer rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800 aria-disabled:cursor-wait sm:min-h-9"
            data-agent-confirm="Permanently deletes the Room, its Stories, and its estimates for everyone."
            value="confirm"
            action={removeRoom}
          >
            {(state) => state.pending ? 'Deleting Room…' : 'Delete permanently'}
          </AlertDialogClose>
        </div>
        <p role="alert" class={error() ? 'mt-3 text-sm font-medium text-text' : 'sr-only'}>{error()}</p>
      </AlertDialogContent>
    </AlertDialog>
  );
}
