export interface FacilitatorLinkClaimOptions<T> {
  path: string;
  claim: (token: string) => Promise<T>;
  /** When false, the `#f=` fragment is still scrubbed immediately (ADR-0001) without issuing a claim. */
  shouldClaim?: () => boolean;
  /** Optional injectable token reader/scrubber; defaults to `takeFacilitatorLinkToken`. */
  takeToken?: (expectedPath: string) => string | null;
  /** Optional injectable `hashchange` subscriber; defaults to `window.addEventListener('hashchange', ...)`. */
  onHashChange?: (listener: () => void) => () => void;
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

export function subscribeFacilitatorLinkClaim<T>(
  options: FacilitatorLinkClaimOptions<T>,
): () => void {
  let disposed = false;
  let activeAttempt = 0;
  const readToken = options.takeToken ?? takeFacilitatorLinkToken;

  async function claimFromFragment() {
    const token = readToken(options.path);
    if (token === null) return;
    if (options.shouldClaim && !options.shouldClaim()) return;

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

  const unsubscribe = options.onHashChange
    ? options.onHashChange(() => { void claimFromFragment(); })
    : (() => {
        window.addEventListener('hashchange', claimFromFragment);
        return () => window.removeEventListener('hashchange', claimFromFragment);
      })();
  void claimFromFragment();
  return () => {
    disposed = true;
    unsubscribe();
  };
}
