export interface FacilitatorLinkClaimOptions<T> {
  path: string;
  claim: (token: string) => Promise<T>;
  onStart?: () => void;
  onPendingChange?: (pending: boolean) => void;
  onSuccess: (result: T) => void;
  onError: (error: unknown) => void;
}

export function takeFacilitatorLinkToken(expectedPath: string): string | null {
  const { pathname, search, hash } = window.location;
  if (pathname.replace(/\/$/, '') !== expectedPath) return null;

  const token = new URLSearchParams(hash.slice(1)).get('f');
  if (token === null) return null;

  // Remove the capability from browser history before starting the exchange (ADR-0001).
  window.history.replaceState(window.history.state, '', pathname + search);
  return token;
}

export function subscribeFacilitatorLinkScrub(
  expectedPath: string | (() => string | undefined),
): () => void {
  function scrub() {
    const target = typeof expectedPath === 'function' ? expectedPath() : expectedPath;
    if (target) takeFacilitatorLinkToken(target);
  }

  window.addEventListener('hashchange', scrub);
  scrub();
  return () => {
    window.removeEventListener('hashchange', scrub);
  };
}

export function subscribeFacilitatorLinkClaim<T>(
  options: FacilitatorLinkClaimOptions<T>,
): () => void {
  let disposed = false;
  let activeAttempt = 0;

  async function claimFromFragment() {
    const token = takeFacilitatorLinkToken(options.path);
    if (token === null) return;

    const { pathname } = window.location;
    const currentAttempt = ++activeAttempt;
    const isStale = () =>
      disposed ||
      currentAttempt !== activeAttempt ||
      window.location.pathname !== pathname;

    options.onStart?.();
    options.onPendingChange?.(true);
    try {
      const result = await options.claim(token);
      if (!isStale()) {
        options.onSuccess(result);
      }
    } catch (error) {
      if (!isStale()) {
        options.onError(error);
      }
    } finally {
      if (!isStale()) {
        options.onPendingChange?.(false);
      }
    }
  }

  window.addEventListener('hashchange', claimFromFragment);
  void claimFromFragment();
  return () => {
    disposed = true;
    window.removeEventListener('hashchange', claimFromFragment);
  };
}
