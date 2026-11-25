# Shared Co-Facilitator Link Capability Seam

## Problem Statement

The Co-Facilitator Link lifecycle established by ADR-0001—minting, hashing, encrypting, decrypting, and re-encrypting 256-bit capability tokens on the server, plus claiming and scrubbing `#f=` URL fragments and rendering QR codes and copy-link fallbacks on the client—is currently implemented twice in parallel for Boards and Pointing Poker Rooms. The two implementations have already drifted: Board sharing re-encrypts Facilitator tokens when `SESSION_SECRET` rotates, whereas Pointing Poker Room sharing silently skips re-encryption, and the client QR, copy-link, and fragment-claim modules duplicate logic with divergent error feedback.

## Solution

Unify the Co-Facilitator Link capability lifecycle behind one deep server capability module and one shared client fragment-claim and link-sharing module, parameterized by two real adapters (Board and Pointing Poker Room). Both workspaces share one audited ADR-0001 implementation, closing the secret-rotation gap in Pointing Poker and removing duplicated QR, clipboard, and fragment-claim code.

## User Stories

1. As a Facilitator of a Board or Pointing Poker Room, I want to retrieve, copy, or display a QR code for the Co-Facilitator Link with identical reliability and manual-select clipboard fallback, so that sharing access works smoothly on desktop and mobile.
2. As a Facilitator rotating the Co-Facilitator Link on a Board or Room, I want the old link invalidated immediately and a fresh 256-bit capability token minted and stored encrypted at rest, so that revoked links can never be reused.
3. As a Participant opening a Co-Facilitator Link (`#f=<token>`) for either a Board or a Room, I want the fragment exchanged into my signed `HttpOnly` cookie and scrubbed immediately from browser history, so that capability secrets never leak into logs or referrers.
4. As a Participant opening a stale or malformed Co-Facilitator Link, I want the invalid fragment scrubbed safely and a clear failure state surfaced without breaking the Board or Room view, so that I can continue participating normally.
5. As an operator rotating `SESSION_SECRET` across deployments, I want encrypted Facilitator tokens in both Boards and Pointing Poker Rooms automatically re-encrypted under the primary secret when accessed, so that Pointing Poker Rooms do not lose Co-Facilitator Links after older secrets are retired.
6. As a security reviewer, I want `Cache-Control: no-store`, token format validation, salted SHA-256 hashing, and AES-256-GCM encryption/decryption audited in one server module, so that ADR-0001 invariants cannot drift between Board and Room.
7. As a maintainer, I want shared recent-workspace storage and relative-time formatting separated cleanly from Board-specific modules, so that Pointing Poker and Board do not duplicate bounded local-storage LRU logic or import unrelated utilities across domain seams.

## Implementation Decisions

- Create a shared server Facilitator capability module owning: 43-character base64url token validation, capability minting (raw token, salted SHA-256 hash, AES-256-GCM ciphertext), decryption with mandatory re-encryption callback when an older `SESSION_SECRET` decrypted the payload, and `Cache-Control: no-store` response header enforcement.
- Wire two real storage adapters—Board sharing and Pointing Poker Room sharing—into the shared server capability module, passing scope-specific salt/AAD context and persistence callbacks for reading and updating encrypted tokens.
- Fix the Pointing Poker Room secret-rotation gap by persisting re-encrypted ciphertext whenever `needsReencrypt` is reported during Co-Facilitator Link retrieval.
- Consolidate client `#f=` fragment extraction, `hashchange` subscription, single-attempt race guarding, and `history.replaceState` scrubbing into one shared Facilitator-link claim module consumed by both Board and Room flows.
- Consolidate the duplicated QR code rendering and clipboard-with-manual-select copy-link controls into shared client sharing primitives parameterized by label, URL, and feedback style, so Board and Room sharing panels stay thin and consistent.
- Optionally extract the duplicated 20-item bounded `localStorage` LRU helper (used by recent Boards and recent Rooms) and relocate the general relative-time formatter out of the recent-Boards module into a neutral time-formatting utility.
- Respect ADR-0001 strictly: never store raw capability tokens in `localStorage`, never pass tokens in query strings, and always scrub `#f=` fragments immediately.

## Testing Decisions

- Test the shared server Facilitator capability module directly through its interface with in-memory storage adapters, covering: valid token mint/verify, malformed token rejection, `Cache-Control: no-store` enforcement, and `SESSION_SECRET` rotation with verified re-encryption persistence.
- Add a Pointing Poker Room sharing integration test confirming that retrieving a Co-Facilitator Link after a `SESSION_SECRET` rotation re-encrypts the stored token in Room storage.
- Test the shared client fragment-claim module against rapid `hashchange` events, in-flight claim races, invalid tokens, and history scrubbing, and test the shared copy-link/QR primitives for clipboard success and manual-select fallback.
- Replace duplicated Board/Room sharing plumbing tests with shared-seam coverage while keeping thin end-to-end sharing checks on both Board and Room.
- Follow existing Board sharing and Pointing Poker sharing server tests as prior art.

## Out of Scope

- Changing the cryptographic primitives, cookie TTL, or `#f=` URL fragment format defined in ADR-0001.
- Changing ADR-0004's rule that closing a Pointing Poker Room clears its Co-Facilitator Link and reopening issues a new one on demand.
- Adding user accounts, email invites, or multi-tenant permissions.

## Further Notes

- Two real adapters (Board and Pointing Poker Room) justify this seam; do not introduce speculative extra adapter layers beyond what Board and Room require.
