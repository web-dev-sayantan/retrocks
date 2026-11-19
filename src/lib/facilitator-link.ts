import type {
  FacilitatorClaimInput,
  FacilitatorClaimResponse,
} from './sharing-actions';

export async function claimFacilitatorLink(
  boardId: string,
  claim: (input: FacilitatorClaimInput) => Promise<FacilitatorClaimResponse>,
): Promise<FacilitatorClaimResponse | null> {
  const { pathname, search, hash } = window.location;
  if (pathname.replace(/\/$/, '') !== `/b/${boardId}`) return null;

  const token = new URLSearchParams(hash.slice(1)).get('f');
  if (token === null) return null;

  // Remove the capability from browser history before starting the exchange.
  window.history.replaceState(window.history.state, '', pathname + search);
  return claim({ boardId, token });
}
