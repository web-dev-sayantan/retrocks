import { Show, createEffect, createSignal, untrack } from 'solid-js';

import type { BoardViewDTO } from '../lib/board-types';
import { claimFacilitatorLink } from '../lib/facilitator-link';
import {
  claimFacilitatorRole,
  type FacilitatorClaimInput,
  type FacilitatorClaimResponse,
} from '../lib/sharing-actions';

export interface FacilitatorLinkClaimProps {
  boardId: string;
  claim?: (input: FacilitatorClaimInput) => Promise<FacilitatorClaimResponse>;
  onClaimed?: (board: BoardViewDTO) => void;
}

export default function FacilitatorLinkClaim(props: FacilitatorLinkClaimProps) {
  const [error, setError] = createSignal('');

  createEffect(
    () => props.boardId,
    (boardId) => {
      let disposed = false;
      let activeAttempt = 0;
      setError('');

      async function claim() {
        const { pathname } = window.location;
        let currentAttempt = 0;
        try {
          const runClaim = untrack(() => props.claim) ?? claimFacilitatorRole;
          const result = await claimFacilitatorLink(boardId, (input) => {
            currentAttempt = ++activeAttempt;
            setError('');
            return runClaim(input);
          });
          if (
            !result ||
            disposed ||
            currentAttempt !== activeAttempt ||
            window.location.pathname !== pathname
          ) {
            return;
          }

          if (result.ok) {
            setError('');
            untrack(() => props.onClaimed)?.(result.board);
          } else {
            setError(result.message);
          }
        } catch {
          if (
            !disposed &&
            currentAttempt === activeAttempt &&
            window.location.pathname === pathname
          ) {
            setError('Could not claim Facilitator access. Reopen the link to try again.');
          }
        }
      }

      void claim();
      window.addEventListener('hashchange', claim);
      return () => {
        disposed = true;
        window.removeEventListener('hashchange', claim);
      };
    },
  );

  return (
    <Show when={error()}>
      <p
        role="alert"
        class="mx-4 mt-4 rounded-lg border border-col-rose bg-col-rose-tint px-4 py-3 text-sm text-text sm:mx-6"
      >
        {error()}
      </p>
    </Show>
  );
}
