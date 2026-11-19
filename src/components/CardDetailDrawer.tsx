import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  onSettled,
  untrack,
} from 'solid-js';

import {
  MAX_ACTION_OWNER_LENGTH,
  MAX_COMMENTS_PER_CARD,
  MAX_COMMENT_LENGTH,
  type ActionItemPatch,
  type CardViewDTO,
  type ColumnDTO,
  type ReactionEmoji,
} from '../lib/board-types';
import { formatRelativeTime } from '../lib/recent-boards';
import { COLUMN_ACCENT_STYLES } from '../lib/templates';
import CardReactions from './CardReactions';
import CardText from './CardText';
import { CloseIcon, TrashIcon } from './Icons';

export interface CardDetailDrawerProps {
  card: CardViewDTO;
  column: ColumnDTO | null;
  isFacilitator: boolean;
  isLocked: boolean;
  isBlurred: boolean;
  nowMs: number;
  onClose: () => void;
  onUpdateActionItem: (
    cardId: string,
    patch: ActionItemPatch,
  ) => Promise<boolean>;
  onToggleReaction: (cardId: string, emoji: ReactionEmoji) => Promise<boolean>;
  onCreateComment: (cardId: string, content: string) => Promise<boolean>;
  onDeleteComment: (cardId: string, commentId: string) => Promise<boolean>;
}

export default function CardDetailDrawer(props: CardDetailDrawerProps) {
  const actionOwnerId = createUniqueId();
  const [ownerDraft, setOwnerDraft] = createSignal(
    untrack(() => props.card.actionOwner),
  );
  const [isSavingAction, setIsSavingAction] = createSignal(false);
  const [commentDraft, setCommentDraft] = createSignal('');
  const [isPosting, setIsPosting] = createSignal(false);
  const [confirmingCommentId, setConfirmingCommentId] = createSignal<
    string | null
  >(null);
  const [deletingCommentId, setDeletingCommentId] = createSignal<string | null>(
    null,
  );

  onSettled(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        props.onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  const isAtCommentLimit = createMemo(
    () => props.card.comments.length >= MAX_COMMENTS_PER_CARD,
  );

  createEffect(
    () => props.card.actionOwner,
    (owner) => {
      setOwnerDraft(owner);
    },
  );

  async function updateAction(patch: ActionItemPatch): Promise<boolean> {
    if (props.isLocked || isSavingAction()) return false;
    setIsSavingAction(true);
    try {
      return await props.onUpdateActionItem(props.card.id, patch);
    } finally {
      setIsSavingAction(false);
    }
  }

  async function saveActionOwner(): Promise<void> {
    if (props.isLocked || isSavingAction()) return;
    const trimmed = ownerDraft().trim();
    if (trimmed === props.card.actionOwner) {
      setOwnerDraft(props.card.actionOwner);
      return;
    }
    const ok = await updateAction({ actionOwner: trimmed });
    setOwnerDraft(ok ? trimmed : props.card.actionOwner);
  }

  async function submitComment(): Promise<void> {
    const trimmed = commentDraft().trim();
    if (
      trimmed.length === 0 ||
      isPosting() ||
      props.isLocked ||
      isAtCommentLimit()
    ) {
      return;
    }
    setIsPosting(true);
    try {
      const ok = await props.onCreateComment(props.card.id, trimmed);
      if (ok) {
        setCommentDraft('');
      }
    } finally {
      setIsPosting(false);
    }
  }

  function handleFormSubmit(event: SubmitEvent): void {
    event.preventDefault();
    void submitComment();
  }

  function handleComposerKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitComment();
    }
  }

  async function handleConfirmDeleteComment(commentId: string): Promise<void> {
    if (deletingCommentId() !== null) return;
    setDeletingCommentId(commentId);
    try {
      const ok = await props.onDeleteComment(props.card.id, commentId);
      if (ok || confirmingCommentId() === commentId) {
        setConfirmingCommentId(null);
      }
    } finally {
      setDeletingCommentId(null);
    }
  }

  function canDeleteComment(isMine: boolean): boolean {
    if (props.isLocked) return false;
    if (isMine) return true;
    return props.isFacilitator && !props.isBlurred;
  }

  return (
    <div data-print-hide="true" class="fixed inset-0 z-40">
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={() => props.onClose()}
        class="fixed inset-0 bg-black/40 backdrop-blur-[1px]"
      />

      {/* Responsive Bottom Sheet (< 640px) / Slide-over Drawer (>= 640px) */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Card details"
        data-board-overlay="true"
        class={[
          'fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-border bg-surface text-text shadow-xl',
          'sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-full sm:max-w-md sm:rounded-none sm:border-t-0 sm:border-l',
        ]}
      >
        {/* Mobile grab handle */}
        <div class="flex justify-center pt-2.5 sm:hidden" aria-hidden="true">
          <div class="h-1 w-10 rounded-full bg-border" />
        </div>

        {/* Drawer header */}
        <div class="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div class="flex min-w-0 items-center gap-2">
            <Show when={props.column}>
              {(col) => (
                <>
                  <span
                    aria-hidden="true"
                    class={[
                      'h-2.5 w-2.5 shrink-0 rounded-full',
                      COLUMN_ACCENT_STYLES[col().accent].swatch,
                    ]}
                  />
                  <h2 class="truncate text-sm font-semibold text-text">
                    {col().title}
                  </h2>
                </>
              )}
            </Show>
          </div>
          <button
            type="button"
            aria-label="Close Card details"
            onClick={() => props.onClose()}
            class={[
              'inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg border border-border bg-surface text-text-muted sm:min-h-8 sm:min-w-8',
              'transition-colors hover:bg-surface-subtle hover:text-text',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            ]}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Scrollable body */}
        <div class="flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-5">
          {/* Card content */}
          <section class="space-y-3">
            <div class="text-sm leading-relaxed text-text">
              <CardText text={props.card.content} />
            </div>

            <div class="flex flex-wrap items-center gap-2 text-xs text-text-muted">
              <Show when={props.card.isMine}>
                <span class="rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-text">
                  You
                </span>
              </Show>
              <Show when={props.card.isActionItem}>
                <span class="rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-text-muted">
                  Action Item
                </span>
              </Show>
              <time class="tabular-nums">
                {formatRelativeTime(props.card.createdAt, props.nowMs)}
              </time>
            </div>

            <CardReactions
              cardId={props.card.id}
              reactions={props.card.reactions}
              myReactions={props.card.myReactions}
              disabled={props.isLocked}
              onToggleReaction={props.onToggleReaction}
            />

            <div class="space-y-2 rounded-lg border border-border bg-canvas/60 p-3">
              <div class="flex items-center justify-between gap-2">
                <h3 class="text-xs font-semibold tracking-wide text-text-muted uppercase">
                  Action Item
                </h3>
                <label class="inline-flex min-h-9 cursor-pointer items-center gap-2 text-xs font-medium text-text">
                  <input
                    type="checkbox"
                    checked={props.card.isActionItem}
                    disabled={props.isLocked || isSavingAction()}
                    onChange={(event) =>
                      void updateAction({
                        isActionItem: event.currentTarget.checked,
                      })
                    }
                    class="h-4 w-4 cursor-pointer rounded border-border accent-accent disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  {props.card.isActionItem
                    ? 'Action Item'
                    : 'Flag as Action Item'}
                </label>
              </div>

              <Show when={props.card.isActionItem}>
                <label class="flex min-h-9 cursor-pointer items-center gap-2 text-xs text-text">
                  <input
                    type="checkbox"
                    checked={props.card.actionDone}
                    disabled={props.isLocked || isSavingAction()}
                    onChange={(event) =>
                      void updateAction({
                        actionDone: event.currentTarget.checked,
                      })
                    }
                    class="h-4 w-4 cursor-pointer rounded border-border accent-accent disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  Done
                </label>

                <div>
                  <label
                    for={actionOwnerId}
                    class="block text-xs font-medium text-text-muted"
                  >
                    Owner (optional)
                  </label>
                  <input
                    id={actionOwnerId}
                    type="text"
                    aria-label="Action owner"
                    placeholder={'e.g. "Platform"'}
                    value={ownerDraft()}
                    maxlength={MAX_ACTION_OWNER_LENGTH}
                    disabled={props.isLocked || isSavingAction()}
                    onInput={(event) => setOwnerDraft(event.currentTarget.value)}
                    onBlur={() => void saveActionOwner()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void saveActionOwner();
                      } else if (event.key === 'Escape') {
                        setOwnerDraft(props.card.actionOwner);
                      }
                    }}
                    class={[
                      'mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text sm:min-h-9',
                      'placeholder:text-text-muted focus:border-focus focus:outline-none disabled:opacity-50',
                    ]}
                  />
                  <p class="mt-1 text-[11px] text-text-muted">
                    Optional short tag, never an email or account.
                  </p>
                </div>
              </Show>
            </div>
          </section>

          {/* Chronological anonymous comments */}
          <section class="space-y-3 border-t border-border pt-4">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-xs font-semibold tracking-wide text-text-muted uppercase">
                Comments
              </h3>
              <span class="text-xs text-text-muted tabular-nums">
                {props.card.comments.length}/{MAX_COMMENTS_PER_CARD}
              </span>
            </div>

            <Show
              when={props.card.comments.length > 0}
              fallback={
                <p class="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-text-muted">
                  No comments yet.
                </p>
              }
            >
              <ul class="space-y-2.5">
                <For each={props.card.comments}>
                  {(comment) => (
                    <li class="rounded-lg border border-border bg-canvas/60 p-3">
                      <p class="whitespace-pre-wrap break-words text-sm leading-relaxed text-text">
                        {comment.content}
                      </p>
                      <div class="mt-2 flex items-center justify-between gap-2">
                        <div class="flex items-center gap-1.5 text-[11px] text-text-muted">
                          <Show when={comment.isMine}>
                            <span class="rounded-full border border-border bg-surface-subtle px-1.5 py-0.5 text-[10px] font-medium text-text">
                              You
                            </span>
                          </Show>
                          <time class="tabular-nums">
                            {formatRelativeTime(comment.createdAt, props.nowMs)}
                          </time>
                        </div>

                        <Show when={canDeleteComment(comment.isMine)}>
                          <Show
                            when={confirmingCommentId() !== comment.id}
                            fallback={
                              <div class="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={deletingCommentId() === comment.id}
                                  onClick={() =>
                                    void handleConfirmDeleteComment(comment.id)
                                  }
                                  class={[
                                    'min-h-9 rounded-md bg-col-rose px-2.5 py-1 text-xs font-medium text-white sm:min-h-7 sm:px-2',
                                    'cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-50',
                                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                                  ]}
                                >
                                  {deletingCommentId() === comment.id
                                    ? 'Deleting...'
                                    : 'Confirm?'}
                                </button>
                                <button
                                  type="button"
                                  disabled={deletingCommentId() === comment.id}
                                  onClick={() => setConfirmingCommentId(null)}
                                  class={[
                                    'min-h-9 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-muted sm:min-h-7 sm:px-2',
                                    'cursor-pointer transition-colors hover:bg-surface-subtle hover:text-text',
                                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                                  ]}
                                >
                                  Cancel
                                </button>
                              </div>
                            }
                          >
                            <button
                              type="button"
                              aria-label="Delete"
                              title="Delete comment"
                              onClick={() => setConfirmingCommentId(comment.id)}
                              class={[
                                'inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md text-text-muted sm:min-h-7 sm:min-w-7',
                                'transition-colors hover:bg-surface-subtle hover:text-col-rose',
                                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                              ]}
                            >
                              <TrashIcon />
                            </button>
                          </Show>
                        </Show>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </section>
        </div>

        {/* Comment composer footer */}
        <Show when={!props.isLocked}>
          <div class="border-t border-border bg-surface px-4 py-3 sm:px-5">
            <Show
              when={!isAtCommentLimit()}
              fallback={
                <p class="text-xs text-text-muted">
                  Comment limit reached ({MAX_COMMENTS_PER_CARD}/
                  {MAX_COMMENTS_PER_CARD}).
                </p>
              }
            >
              <form onSubmit={handleFormSubmit} class="space-y-2">
                <textarea
                  aria-label="Comment"
                  placeholder="Write an anonymous comment..."
                  value={commentDraft()}
                  maxlength={MAX_COMMENT_LENGTH}
                  rows={2}
                  onInput={(e) => setCommentDraft(e.currentTarget.value)}
                  onKeyDown={handleComposerKeyDown}
                  class={[
                    'w-full resize-none rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-text',
                    'placeholder:text-text-muted focus:border-focus focus:outline-none',
                  ]}
                />
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[11px] text-text-muted tabular-nums">
                    {commentDraft().length}/{MAX_COMMENT_LENGTH}
                  </span>
                  <button
                    type="submit"
                    disabled={
                      isPosting() || commentDraft().trim().length === 0
                    }
                    class={[
                      'min-h-11 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-contrast sm:min-h-8',
                      'cursor-pointer transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    ]}
                  >
                    {isPosting() ? 'Posting...' : 'Post comment'}
                  </button>
                </div>
              </form>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
