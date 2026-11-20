# Retrocks

A zero-login collaboration app for retrospectives, brainstorming, and live story estimation.

## Language

### Roles & Access

**Participant**:
A person viewing or contributing to a Board or Room without an account or personal profile.
_Avoid_: User, member, account

**Facilitator**:
A Participant who has permission to manage a Board or run a Pointing Poker Room.
_Avoid_: Admin, host, owner, moderator

**Co-Facilitator Link**:
A shareable link to a specific Board or Room that grants the Facilitator role when opened.
_Avoid_: Admin link, invite link, moderator URL

### Board & Content

**Board**:
A shareable, temporary collaborative workspace containing columns, cards, and facilitation state for a single retrospective or brainstorming session.
_Avoid_: Room, session, workspace

**Column**:
A named category on a board that holds standalone cards and card groups.
_Avoid_: List, lane, section

**Card**:
An anonymous plain-text note contributed to a column on a board.
_Avoid_: Note, sticky, post-it, item

**Card Group**:
Two or more cards within the same column merged under an optional shared title with combined voting.
_Avoid_: Stack, cluster, bundle

**Vote**:
A single ballot cast by a participant on a standalone card or a card group within the board's voting rules.
_Avoid_: Dot, upvote, like

### Facilitation & Lifecycle

**Private Mode**:
A board state in which each participant can see and manage only their own cards while all other cards stay redacted until revealed.
_Avoid_: Blur mode, hidden mode, draft mode

**Blind Voting**:
A board state in which participants can vote and see their own cast counts while aggregate totals stay hidden until revealed.
_Avoid_: Secret voting, hidden votes

**Action Item**:
A card flagged for post-retrospective follow-up with an open or done status and an optional free-text owner tag.
_Avoid_: Task, todo, follow-up

**Locked**:
A read-only board state that freezes content changes while preserving viewing, searching, exporting, and facilitator follow-up on existing Action Items.
_Avoid_: Archived, frozen, read-only mode

### Pointing Poker

**Room**:
A shareable workspace for one live Pointing Poker session.
_Avoid_: Board, game

**Display Name**:
The name a Participant chooses for themselves in a Room.
_Avoid_: Username, account name

**Story**:
A titled piece of work that a team estimates together in Pointing Poker.

**Deck**:
The ordered set of choices a participant can vote for when estimating a Story.
_Avoid_: Metric, voting options

**Voting Round**:
One opportunity for Participants to estimate the active Story, from the opening of voting through reveal or cancellation.

**Accepted Estimate**:
The Deck value a Facilitator records for a Story as the team's agreed estimate.
_Avoid_: Average, winning vote
