# Voting Round discard policy

## Problem Statement

A Facilitator can act on a Voting Round from several Room controls. Those controls, the optimistic Room controller, and Room storage each interpret round identity, phase, and vote presence. A new discard rule can produce a confirmation for one round, a preview for another, and a server rejection after the Room changes.

## Solution

Deepen the Voting Round policy module so confirmation, optimistic eligibility, and authoritative validation use the same command-specific rules. The server evaluates the policy against the current Room during the write.

## User Stories

1. As a Facilitator, I want to confirm before switching Stories during an unresolved Voting Round, so that even an empty round ends deliberately.
2. As a Facilitator, I want to confirm before closing a Room with an unresolved round, so that the close applies to the round I reviewed.
3. As a Facilitator, I want to change the Deck during voting, so that I can restart with the right choices while keeping prior Accepted Estimates.
4. As a Facilitator, I want to know when publishing, retitling, locking, or deleting a Story discards votes, so that I can decide whether to proceed.
5. As a Facilitator, I want inline Delete to reflect votes that arrive while it is open, so that its warning describes the round I am about to discard.
6. As a Facilitator, I want an outdated confirmation rejected, so that it cannot discard a replacement round.
7. As a Participant, I want my ballot private before reveal, so that shared validation preserves independent estimation.
8. As a Participant, I want votes and reveals tied to the authoritative round, so that a restart cannot apply an old command to new voting.
9. As a maintainer, I want one place to change discard rules, so that all three callers agree.

## Implementation Decisions

- Express the shared decision using command intent, active-target status, round identity, phase, and vote presence. Derive those facts from the projected Room on the client and stored Room on the server.
- Preserve distinct rules. Switching Stories and closing a Room account for an unresolved round even when empty. Publishing a new active Story, retitling or locking or deleting the active Story, and changing the Deck require discard confirmation when an unresolved round has votes.
- Preserve command-specific effects. Publishing locks the previous Story. Editing the active Story restarts unresolved voting. A qualifying Deck change restarts with empty ballots and preserves Accepted Estimates. Locking or deleting the active Story clears the active stage.
- Capture round identity for asynchronous modal confirmations. Preserve inline Delete's live warning and submission-time round identity.
- Keep authorization, ballot contents, authoritative round ID creation, and persistence on the server. For an optimistic restart, ensure voting controls cannot submit against an intermediate display of the superseded round. Preserve rollback on rejection.

## Testing Decisions

- Exercise confirmation and cancellation through rendered controls, optimistic updates and rollback through the Room controller, and durable outcomes through existing Room commands.
- Reuse existing Story Queue confirmation, optimistic Room controller, and server Story Queue suites. Cover an empty unresolved round, a vote landing during a Deck save, a stale confirmation after round replacement, an accepted round, and changes to an inactive Story.
- Assert visible prompts, command outcomes, ballot privacy, and the ability to vote after an authoritative restart. Keep a policy test only where it makes the command matrix clearer.

## Out of Scope

Editor session lifecycle, runtime publication, Deck presets, and changes to persistent Room data or the HTTP-write and push-read split.

## Further Notes

This spec supersedes no product decision. The existing first-vote race test provides a baseline for the authoritative write.
