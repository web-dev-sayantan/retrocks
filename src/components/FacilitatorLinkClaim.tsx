import { Show, createEffect, createSignal, untrack } from 'solid-js';

import type { BoardViewDTO } from '../lib/board-types';
import { subscribeFacilitatorLinkClaim } from '../lib/facilitator-link';
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
      setError('');
      return subscribeFacilitatorLinkClaim({
        path: `/b/${boardId}`,
        claim: (token) => {
          const runClaim = untrack(() => props.claim) ?? claimFacilitatorRole;
          return runClaim({ boardId, token });
        },
        onStart: () => setError(''),
        onSuccess: (result) => {
          if (result.ok) {
            setError('');
            untrack(() => props.onClaimed)?.(result.board);
          } else {
            setError(result.message);
          }
        },
        onError: () => {
          setError('Could not claim Facilitator access. Reopen the link to try again.');
        },
      });
    },
  );

  return (
    <Show when={error()}>
      <p
        role="alert"
        class="mx-4 mt-4 rounded-md border border-col-rose bg-col-rose-tint px-4 py-3 text-sm text-text sm:mx-6"
      >
        {error()}
      </p>
    </Show>
  );
}
