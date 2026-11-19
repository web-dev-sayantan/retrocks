import { Show, createEffect, createSignal } from 'solid-js';

import { claimFacilitatorLink } from '../lib/facilitator-link';
import { claimFacilitatorRole } from '../lib/sharing-actions';

export default function FacilitatorLinkClaim(props: { boardId: string }) {
  const [error, setError] = createSignal('');

  createEffect(
    () => props.boardId,
    (boardId) => {
      let disposed = false;
      setError('');

      async function claim() {
        const { pathname } = window.location;
        try {
          const result = await claimFacilitatorLink(boardId, claimFacilitatorRole);
          if (!result || disposed || window.location.pathname !== pathname) return;

          if (result.ok) {
            // Refresh the viewer projection and reconnect live updates with the new cookie.
            window.location.reload();
          } else {
            setError(result.message);
          }
        } catch {
          if (!disposed && window.location.pathname === pathname) {
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
        class="border-b border-col-rose/40 bg-col-rose-tint px-4 py-2 text-sm text-text"
      >
        {error()}
      </p>
    </Show>
  );
}
