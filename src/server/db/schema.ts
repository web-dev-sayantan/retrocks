import 'server-only';

/**
 * Shared SQLite schema executed verbatim on both Cloudflare Durable Objects
 * (`ctx.storage.sql`) and Node SQLite (`node:sqlite`), per ADR-0002 & SPEC §6.
 */
export const BOARD_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS boards (
    id                          TEXT PRIMARY KEY,
    title                       TEXT NOT NULL,
    subtitle                    TEXT NOT NULL DEFAULT '',
    template_id                 TEXT NOT NULL,
    facilitator_token_hash      TEXT NOT NULL,
    facilitator_token_encrypted TEXT NOT NULL,
    token_salt                  TEXT NOT NULL,
    is_blurred                  INTEGER NOT NULL DEFAULT 0,
    blind_voting                INTEGER NOT NULL DEFAULT 0,
    is_locked                   INTEGER NOT NULL DEFAULT 0,
    allow_participant_group     INTEGER NOT NULL DEFAULT 0,
    vote_limit                  INTEGER,
    max_votes_per_card          INTEGER,
    timer_ends_at               INTEGER,
    timer_remaining_ms          INTEGER,
    timer_duration_ms           INTEGER,
    version                     INTEGER NOT NULL DEFAULT 1,
    retention_days              INTEGER NOT NULL DEFAULT 90,
    created_at                  INTEGER NOT NULL,
    last_active_at              INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS columns (
    id               TEXT PRIMARY KEY,
    board_id         TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    accent           TEXT NOT NULL DEFAULT 'slate',
    position         INTEGER NOT NULL,
    is_action_column INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS card_groups (
    id         TEXT PRIMARY KEY,
    board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    column_id  TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS cards (
    id                TEXT PRIMARY KEY,
    board_id          TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    column_id         TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
    group_id          TEXT REFERENCES card_groups(id) ON DELETE SET NULL,
    content           TEXT NOT NULL,
    author_token_hash TEXT NOT NULL,
    is_action_item    INTEGER NOT NULL DEFAULT 0,
    action_done       INTEGER NOT NULL DEFAULT 0,
    action_owner      TEXT NOT NULL DEFAULT '',
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS votes (
    board_id         TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    target_type      TEXT NOT NULL CHECK (target_type IN ('card', 'group')),
    target_id        TEXT NOT NULL,
    voter_token_hash TEXT NOT NULL,
    count            INTEGER NOT NULL DEFAULT 1,
    updated_at       INTEGER NOT NULL,
    PRIMARY KEY (target_type, target_id, voter_token_hash)
  )`,
  `CREATE TABLE IF NOT EXISTS reactions (
    board_id           TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    card_id            TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    emoji              TEXT NOT NULL,
    reactor_token_hash TEXT NOT NULL,
    created_at         INTEGER NOT NULL,
    PRIMARY KEY (card_id, emoji, reactor_token_hash)
  )`,
  `CREATE TABLE IF NOT EXISTS comments (
    id                TEXT PRIMARY KEY,
    board_id          TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    card_id           TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    content           TEXT NOT NULL,
    author_token_hash TEXT NOT NULL,
    created_at        INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_columns_board ON columns(board_id, position)`,
  `CREATE INDEX IF NOT EXISTS idx_groups_board ON card_groups(board_id, column_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_cards_board ON cards(board_id, column_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_votes_board ON votes(board_id, voter_token_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_reactions_board ON reactions(board_id, card_id)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_card ON comments(card_id, created_at)`,
] as const;
