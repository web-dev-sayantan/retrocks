---
status: accepted
---

# Dual-Runtime Adapter Seam and HTTP-Write / Push-Read Split

Retrocks runs primarily on Cloudflare Workers with SQLite-backed Durable Objects (one `BoardRoom` DO per board, powering default `pnpm dev` via `@cloudflare/vite-plugin` and production deployment), while keeping a Node + local SQLite + SSE implementation behind two narrow server interfaces (`BoardStore` and `BoardRealtime`). Atomic domain mutations and transactional invariant guards live in the shared runtime-agnostic `SqlBoardOperations` core executed inside each adapter's transaction (`BoardRoom` DO single-transaction and `NodeBoardStore` SQLite transaction), while request services above the seam own authentication, Valibot input validation, viewer projection/redaction, and live broadcast coordination. All state mutations travel over Solid `'use server'` HTTP functions rather than WebSocket RPC — leaving WebSockets (Cloudflare) and SSE (Node) strictly for server-to-client live fan-out and presence.

## Considered Options

- **Coupling directly to Cloudflare Durable Objects + WebSocket RPC writes**: Rejected because it locks the app to Cloudflare, forces every mutation to re-implement cookie auth and CSRF checks inside WebSocket message handlers, and prevents running fast, deterministic Vitest `server` suites in Node.
- **External hosted database (e.g., Turso/Postgres) + separate realtime pub/sub**: Rejected because per-board SQLite Durable Objects provide zero-cost, single-threaded serialization for concurrent votes and Card Group merges on the Cloudflare Free Plan with no extra managed services.

## Consequences

- The SQLite schema includes `board_id` on child tables (even though each Cloudflare DO only holds one board) so the exact same SQL queries run verbatim on both Cloudflare DO SQLite and multi-board Node SQLite.
- Switching deployments between Cloudflare Workers and a standalone Node server is an adapter-wiring and Vite config switch with zero changes to routes, Solid 2.0 components, server functions, or domain logic.
- Vitest `server` tests execute against the in-memory Node SQLite adapter without Wrangler or network mocks.
