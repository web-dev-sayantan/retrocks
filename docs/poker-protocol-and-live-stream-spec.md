# Pointing Poker Protocol & Live-Stream Consolidation

## Problem Statement

Pointing Poker currently maintains eighteen command variants, Room views, and live message frames twice by hand—once as TypeScript type definitions and once as Valibot runtime schemas—creating ongoing drift risk whenever Room features evolve. In parallel, two tiny live-stream pass-through modules sit in front of the shared live-stream transport, and the Board live-stream wrapper exposes a reactive signal that forces the Board controller to run an extra `createEffect` with manual message deduplication instead of receiving messages via a direct callback.

## Solution

Derive Pointing Poker's command, view, and live-message TypeScript types directly from its Valibot schemas in a single protocol module (matching the pattern already used for Boards), absorb the shallow Pointing Poker live-stream pass-through into the Room controller, and replace the Board live-stream signal indirection and controller `createEffect` with a direct `onMessage` callback into the shared live-stream module.

## User Stories

1. As a Participant or Facilitator in a Pointing Poker Room, I want every command and live-stream message validated against the exact same contract that TypeScript checks at compile time, so that wire-format mismatches cannot slip into production.
2. As a Participant viewing a live Board, I want incoming SSE and WebSocket events dispatched synchronously in the live-stream callback without an intermediate reactive effect, so that live updates never suffer double-processing or effect-ordering glitches.
3. As a Participant experiencing a transient network drop on a Board or Room, I want automatic reconnection, exponential backoff, and presence updates to work identically through the shared live-stream transport, so that live collaboration remains resilient.
4. As a maintainer adding a new Pointing Poker command or Room view field, I want to edit one schema definition and have all client and server TypeScript types update automatically, so that schema and type definitions can never drift apart.
5. As a maintainer reviewing the Board controller, I want one fewer unnecessary `createEffect` in the codebase, aligning with the repository's Solid 2.0 coding conventions.

## Implementation Decisions

- Consolidate Pointing Poker's Valibot schemas and TypeScript types into one single-source protocol module using Valibot's `InferInput` and `InferOutput` type utilities for all Room commands, Participant/Story/Voting Round views, live/closed Room snapshots, and live-stream frames.
- Remove hand-duplicated type declarations once inferred types match all client and server consumers (re-exporting inferred types from the existing types entry if helpful to keep imports clean, or updating imports directly if minimal).
- Absorb the one-function Pointing Poker live-stream pass-through into the Pointing Poker Room controller, configuring the shared live-stream module directly with the Room endpoint, parser, and `onMessage` callback.
- Replace the Board live-stream wrapper's `lastEvent` signal and the Board controller's message-watching `createEffect` (along with its manual previous-message deduplication) with a direct `onMessage` callback passed to the shared live-stream module.
- Preserve the shared live-stream transport's existing reconnection, heartbeat, visibility-change, and connection-status semantics across both WebSocket (Cloudflare) and SSE (Node) runtimes.

## Testing Decisions

- Rely on TypeScript compilation (`typecheck`) to structurally enforce parity between Pointing Poker runtime schemas and compile-time types; keep schema validation tests at the protocol seam for invalid/edge-case payloads.
- Exercise Board and Pointing Poker live-message handling through existing controller tests using the injected live-stream transport seam, asserting that incoming frames update state synchronously, ignore stale versions, and never duplicate identical deliveries.
- Verify no behavioral regression in reconnect, disconnect, and terminal-frame handling across existing live-stream and controller test suites.
- Follow existing Board schema inference and Pointing Poker live-stream callback patterns as prior art.

## Out of Scope

- Changing the wire format of Board or Pointing Poker SSE/WebSocket messages.
- Merging Board and Pointing Poker server-side realtime fan-out implementations.
- Altering ADR-0002's HTTP-write / push-read architecture.

## Further Notes

- This is a low-risk, high-hygiene cleanup that pairs cleanly with the Pointing Poker Room Session spec and supports the repository's rule against unnecessary `createEffect` usage.
