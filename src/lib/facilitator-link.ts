import type {
  FacilitatorClaimInput,
  FacilitatorClaimResponse,
} from './sharing-actions';

export async function claimFacilitatorLink(
  boardId: string,
  claim: (input: FacilitatorClaimInput) => Promise<FacilitatorClaimResponse>,
): Promise<FacilitatorClaimResponse | null> {
  const token = takeFacilitatorLinkToken(`/b/${boardId}`);
  return token === null ? null : claim({ boardId, token });
}

export function takeFacilitatorLinkToken(roomPath: string): string | null {
  const { pathname, search, hash } = window.location;
  if (pathname.replace(/\/$/, '') !== roomPath) return null;

  const token = new URLSearchParams(hash.slice(1)).get('f');
  if (token === null) return null;

  // Remove the capability from browser history before starting the exchange.
  window.history.replaceState(window.history.state, '', pathname + search);
  return token;
}
