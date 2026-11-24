# Pointing Poker product spec

**Status** — Agreed first-release product scope.

## Purpose

Pointing Poker gives agile teams a live, account-free way to discuss Stories, estimate independently, and record an agreed estimate for each Story. It has its own entry point in Retrocks. Each Room is independent of retrospective Boards.

## Room setup and access

- The creator becomes a Facilitator. Anyone holding the participant link can join a live Room or view its closed summary. A separate Co-Facilitator Link grants control and supports recovery or handoff.
- A Facilitator can replace the Co-Facilitator Link. The previous link stops granting access. Existing Facilitators keep their access. If all Facilitators lose access and nobody has the current link, the participant link continues to grant participant access while the Room exists.
- Each Participant selects a Room-specific Display Name. They may enter a real name or an alias. The join screen explains that others in the Room can see it.
- Participants who choose the same name get distinct roster entries and independent votes. Refreshing or reconnecting in the same browser preserves the Participant's name and current vote.
- The default Deck is Fibonacci (`0, 1, 2, 3, 5, 8, 13, 21`). The T-shirt preset is `XS, S, M, L, XL`. A custom Deck contains at least two distinct, nonblank numeric or text choices in the Facilitator's chosen order. Every Deck choice can become an Accepted Estimate.
- The Facilitator can change the Deck at any time. If an unresolved Voting Round has votes, confirm before discarding its ballots and restarting voting with the new Deck. Existing Accepted Estimates stay as they are.

## Stories and voting

- Participants can join an empty Room while the Facilitator adds Stories. The Facilitator supplies Story titles and can reorder the queue. Everyone sees the active Story and can tell which Stories are pending, estimated, or skipped. A skipped Story can return to the queue.
- Selecting a Story starts its Voting Round for everyone. Only one round is active at a time. If the Facilitator switches Stories during an unresolved round, confirm before discarding its ballots. The previous Story stays pending unless explicitly skipped or already estimated. An existing Accepted Estimate is preserved.
- Participants, including the Facilitator, may choose one Deck value and change or clear their vote before reveal. Everyone sees who has voted. Each Participant sees their own choice. Vote values stay private from everyone else, including Facilitators, until reveal.
- The Facilitator may reveal once the round has at least one vote. Disconnecting preserves a submitted vote. A Participant who joins during an open Voting Round may vote. Someone who joins after reveal can see the results and vote in the next Voting Round.
- Reveal closes voting and shows each submitted choice by Display Name. If the active Story's title changes during a Voting Round, restart voting with empty ballots. Other pending Story titles and the queue can be edited while voting continues.
- After reveal, a Facilitator can start a fresh Voting Round, skip the Story, or explicitly confirm any Deck value as its Accepted Estimate. Confirmation is required even for unanimous votes. Starting a fresh round, switching Stories, or closing the Room discards the previous round's individual ballots.
- While the Room is open, a Facilitator can correct a recording mistake directly or run a fresh Voting Round to reconsider a Story. Reconsideration keeps the existing Accepted Estimate until a replacement is confirmed. A Facilitator can correct an estimated Story's title and keep its Accepted Estimate. If the scope changes, the Facilitator can re-estimate the Story or add a separate Story.

## Closing and retention

- Closing a Room during unresolved voting requires confirmation and discards the round's ballots. The Room becomes permanently read-only. Its participant link opens a summary of Story titles, Accepted Estimates, and skipped or pending statuses. Display Names and individual votes are excluded. Any Accepted Estimate still stands if a replacement was under discussion when the Room closed.
- A closed Room expires 90 days after it ends. An open Room expires 90 days after creation or its most recent vote or content change, whichever is later. Opening the link to view the Room leaves the expiry date as it was. Facilitators can delete a Room sooner.

## First-release boundary

The first release supports live estimation and title-based Story creation. Discussion takes place in the team's meeting channel. Observer mode, timers, automatic reveal, special cards, asynchronous voting, tracker integrations, bulk import, and export are follow-up candidates.

## Acceptance scenarios

- **Create and share.** A Facilitator sets up a Room and shares its participant link before entering any Stories. People on desktop and mobile join with names of their choice. A teammate who opens the Co-Facilitator Link gains control. After a Facilitator replaces that link, the old link fails to grant access to new claimants and existing Facilitators can still manage the Room.
- **Use all three Deck types.** A Facilitator can start with either preset or an ordered custom Deck, and switch Decks at any time. A custom Deck with fewer than two distinct, nonblank choices cannot be used. Changing the Deck during an unresolved Voting Round with votes requires confirmation and restarts voting with empty ballots, while previously recorded Accepted Estimates remain unchanged.
- **Vote independently and reveal together.** Two Participants called Sam vote independently. Each can see their own choice, and the Facilitator sees submission status before reveal. One Sam can refresh, change their preserved vote, and disconnect. Reveal displays both latest choices by name. Someone arriving after reveal can view the results and join the next round.
- **Change course during voting.** A Facilitator edits the active Story, and Participants vote again with empty ballots. If the Facilitator switches away from an unresolved Story and confirms, its ballots are discarded. The Facilitator can also explicitly skip a Story and bring it back later.
- **Record and correct estimates.** The Facilitator explicitly confirms a unanimous result, corrects a recording mistake, and later starts a new round for that Story. Its previous Accepted Estimate survives until the replacement is confirmed. Once the Facilitator moves to another Story, the previous round's named ballots are gone.
- **Close and revisit.** A Facilitator confirms closing during an unresolved round. The shared summary retains old estimates, shows any pending and skipped Stories, and omits names and ballots. Closed Rooms remain readable through the participant link until expiry or deletion. Viewing a Room leaves its expiration date unchanged.
