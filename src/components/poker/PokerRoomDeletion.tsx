import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@ui-sdk/solid/alert-dialog';
import { Trash2 } from 'lucide';
import { createSignal } from 'solid-js';

import { deletePokerRoom } from '../../lib/poker-actions';
import LucideIcon from '../LucideIcon';

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
      <AlertDialogTrigger
        aria-label="Delete Room"
        title="Delete Room"
        class="poker-icon-btn poker-icon-btn-danger spring-press board-focus-ring"
      >
        <LucideIcon icon={Trash2} class="size-4 shrink-0" strokeWidth={1.85} />
      </AlertDialogTrigger>
      <AlertDialogBackdrop class="board-dialog-backdrop z-40" />
      <AlertDialogContent class="board-dialog-surface z-50 w-[min(22rem,calc(100vw-2rem))] overscroll-contain rounded-lg border border-border bg-surface p-5 text-text shadow-2xl">
        <AlertDialogTitle class="font-semibold">Delete Room?</AlertDialogTitle>
        <AlertDialogDescription class="mt-2 text-sm text-text-muted">
          This permanently deletes the Room, its Stories, and any estimates. The participant link will stop working for everyone.
        </AlertDialogDescription>
        <div class="mt-4 flex flex-wrap justify-end gap-2">
          <AlertDialogClose class="poker-secondary spring-press board-focus-ring">Cancel</AlertDialogClose>
          <AlertDialogClose
            class="board-focus-ring spring-press inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md bg-rose-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-rose-800 aria-disabled:cursor-wait sm:min-h-9"
            data-agent-confirm="Permanently deletes the Room, its Stories, and its estimates for everyone."
            value="confirm"
            action={removeRoom}
          >
            {(state) => (state.pending ? 'Deleting Room…' : 'Delete permanently')}
          </AlertDialogClose>
        </div>
        <p role="alert" class={error() ? 'poker-error-text mt-3 text-sm font-medium' : 'sr-only'}>{error()}</p>
      </AlertDialogContent>
    </AlertDialog>
  );
}
