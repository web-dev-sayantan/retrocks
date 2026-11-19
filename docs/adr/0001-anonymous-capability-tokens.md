---
status: accepted
---

# Anonymous Capability Tokens and Encrypted Facilitator Secrets

Retrocks requires zero login and zero personal data, so Participant identity and Facilitator access are represented by opaque cryptographic tokens rather than user accounts. On first visit to `/b/:id` (or board creation), the server mints a signed `HttpOnly` cookie (`90-day` sliding TTL) carrying an anonymous `participantId`, stored per board only as a salted SHA-256 hash; minting on initial `GET` ensures the subsequent WebSocket/SSE handshake immediately carries `participantHash` for server-side Private Mode redaction. Each board's 256-bit `facilitatorToken` is stored both hashed (for verification) and AES-256-GCM encrypted at rest using a key derived from `SESSION_SECRET` (supporting secret rotation), and shared via a `/b/<id>#f=<token>` URL fragment that the client exchanges into the signed `HttpOnly` cookie and immediately scrubs via `history.replaceState`.

## Considered Options

- **Hash-only facilitator token + `localStorage` backup**: Rejected because any Facilitator who clears `localStorage` or joins on a second device can no longer copy the Co-Facilitator Link, and storing raw capability tokens in `localStorage` exposes them to XSS.
- **Query-parameter facilitator links (`?f=<token>`)**: Rejected because query strings leak into HTTP server logs, browser history sync, and `Referer` headers; URL fragments (`#f=`) never leave the client over HTTP.
- **Minting `participantId` only on first write mutation**: Rejected because a Participant joining a board in Private Mode would open their live socket without a `participantHash`, causing their own newly created cards to arrive redacted until a forced reconnect.

## Consequences

- Any verified Facilitator can retrieve or rotate the Co-Facilitator Link from the server without ever storing raw tokens in `localStorage`.
- `SESSION_SECRET` rotation must keep previous secrets in the comma-separated list long enough to decrypt and re-verify active cookies and encrypted facilitator tokens (or re-encrypt on access).
