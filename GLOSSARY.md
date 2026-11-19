# Retrocks

A zero-login, privacy-first collaborative retrospective board application for agile teams and brainstorming sessions.

## Language

### Roles & Access

**Participant**:
An anonymous person viewing or contributing to a board without an account or personal profile.
_Avoid_: User, member, account

**Facilitator**:
A participant who holds board-level control over facilitation modes, column structure, voting rules, locking, and deletion.
_Avoid_: Admin, host, owner, moderator

**Co-Facilitator Link**:
A shareable link for a specific board that grants the Facilitator role when opened.
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
