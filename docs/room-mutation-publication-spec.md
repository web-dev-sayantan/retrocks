# Room mutation publication

## Problem Statement

The Node SSE and Cloudflare Durable Object adapters both interpret successful Room writes, produce Participant-specific updates, and decide which terminal frame to send. A change to publication semantics can reach one runtime before the other.

## Solution

Deepen the Room publication module at the existing runtime adapter seam. Share when a committed outcome produces a live update and what that update means. Each adapter delivers it through its runtime primitives.

## User Stories

1. As a Participant, I want committed Room changes to appear live, so that the group sees the same Story and Deck.
2. As a Participant, I want live updates projected for my view, so that other Participants' choices stay private until reveal.
3. As a Facilitator, I want link replacement and claims reflected in the Room, so that the current controls match Facilitator access.
4. As a Participant, I want a closed Room to deliver its summary before the connection ends, so that I can see the final estimates.
5. As a Participant, I want deletion to signal that the Room is unavailable, so that I can leave the expired view.
6. As a Facilitator, I want a rejected write to leave the live Room alone, so that no update implies it succeeded.
7. As a maintainer, I want both adapters to use the same publication rules, so that future mutation changes can be verified across runtimes.

## Implementation Decisions

- Use committed Room outcomes to determine whether to publish, project a closed summary, or signal a missing Room. Reuse existing Participant-specific projection for the response and live delivery.
- Distinguish unchanged successful commands from changed writes. Preserve existing normal-mutation suppression and explicitly define the behavior of an already-satisfied Co-Facilitator Link claim. Prefer suppressing an identical snapshot when the claim changes no state.
- Send a projected closed summary before disconnecting on close. Send a missing frame before disconnecting on successful deletion. Preserve rejection behavior and close/reopen authorization.
- Keep WebSocket and SSE framing, connection tracking, presence, heartbeats, and expiry scheduling in the existing adapters. Follow ADR 0002's HTTP-write and push-read split and ADR 0004's Room reopening and privacy rules.

## Testing Decisions

- Run common contract cases through the existing adapter write and live delivery interfaces. Assert outcomes, frames received by distinct Participants, and terminal ordering.
- Cover a changed write, a no-op write, a rejected write, link replacement, an effective and a repeated claim, closing, and authorized and unauthorized deletion.
- Build on the existing Node Room and sharing tests and the Durable Object tests backed by in-memory SQLite. Keep alarm scheduling and expiry verification with the Durable Object adapter.

## Out of Scope

Transport consolidation, new runtime adapters, changes to the Room retention policy, and persistent schema changes.

## Further Notes

The repeated-claim publication decision is the only proposed change to what existing live connections receive.
