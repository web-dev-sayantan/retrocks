import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
} from '@ui-sdk/solid/drawer';
import { Trash2 } from 'lucide';
import {
  For,
  Show,
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
} from '../lib/board-types';
import { confirmBoardAction } from '../lib/board-confirm';
import { createActionItemFollowUp } from '../lib/action-item-follow-up';
import {
  canDeleteComment,
  canEditActionItem,
  canEditActionItemFollowUp,
  canInteractWithCard,
} from '../lib/board-permissions';
import { formatRelativeTime } from '../lib/relative-time';
import { COLUMN_ACCENT_STYLES } from '../lib/templates';
import BoardOverlayHeader from './BoardOverlayHeader';
import { useBoardWorkspace } from './BoardWorkspaceContext';
import CardReactions from './CardReactions';
import CardText from './CardText';
import LucideIcon from './LucideIcon';

export interface CardDetailDrawerProps {
  card: CardViewDTO;
  isOpen: boolean;
  side: 'bottom' | 'right';
  onClose: () => void;
  onExit: () => void;
  restoreFocusTarget: () => HTMLElement | undefined;
}

export default function CardDetailDrawer(props: CardDetailDrawerProps) {
  const workspace = useBoardWorkspace();
  const actionOwnerId = createUniqueId();
  const [actionError, setActionError] = createSignal<string | null>(null);
  const [commentDraft, setCommentDraft] = createSignal('');
  const [commentError, setCommentError] = createSignal<string | null>(null);
  const [deleteCommentError, setDeleteCommentError] = createSignal<string | null>(null);
  const [isPosting, setIsPosting] = createSignal(false);
  const [deletingCommentId, setDeletingCommentId] = createSignal<string | null>(
    null,
  );

  const column = createMemo(
    () => workspace.columns.find((col) => col.id === props.card.columnId) ?? null,
  );

  const followUp = createActionItemFollowUp({
    target: () => canEditActionItemFollowUp(workspace, props.card)
      ? props.card.id
      : undefined,
    open: () => props.isOpen,
    owner: () => props.card.actionOwner,
    done: () => props.card.actionDone,
    pending: () => workspace.actions.isActionItemPending(props.card.id),
    update: (id, patch) => workspace.actions.updateActionItem(id, patch),
    ownerError: 'Could not update the Action Item. Try again.',
  });
  const { ownerEdit, isSaving: isSavingAction } = followUp;

  onSettled(() => () => {
    // An abrupt unmount (Board deleted, Card redacted) drops focus on the body.
    const restoreFocusTarget = untrack(() => props.restoreFocusTarget);
    queueMicrotask(() => {
      if (document.activeElement === document.body) restoreFocusTarget()?.focus({ preventScroll: true });
    });
  });

  const canInteract = createMemo(() => canInteractWithCard(workspace, props.card));

  const isAtCommentLimit = createMemo(
    () => props.card.comments.length >= MAX_COMMENTS_PER_CARD,
  );

  async function updateAction(patch: ActionItemPatch): Promise<boolean> {
    if (isSavingAction()) return false;
    if (!canEditActionItem(workspace, props.card, patch)) return false;
    setActionError(null);
    ownerEdit.resetError();
    try {
      const ok = await workspace.actions.updateActionItem(props.card.id, patch);
      if (!ok) setActionError('Could not update the Action Item. Try again.');
      return ok;
    } catch {
      setActionError('Could not update the Action Item. Try again.');
      return false;
    }
  }

  async function submitComment(): Promise<void> {
    const trimmed = commentDraft().trim();
    if (
      trimmed.length === 0 ||
      isPosting() ||
      !canInteract() ||
      isAtCommentLimit()
    ) {
      return;
    }
    setIsPosting(true);
    setCommentError(null);
    try {
      const error = await workspace.actions.createComment(props.card.id, trimmed);
      if (error) setCommentError(error);
      else setCommentDraft('');
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

  async function handleDeleteComment(commentId: string): Promise<void> {
    if (deletingCommentId() !== null) return;
    const confirmed = await confirmBoardAction({
      title: 'Delete this comment?',
      description: 'The comment is removed for everyone on this Board.',
      confirmLabel: 'Delete comment',
    });
    if (!confirmed) return;
    setDeletingCommentId(commentId);
    setDeleteCommentError(null);
    try {
      const error = await workspace.actions.deleteComment(props.card.id, commentId);
      if (error) setDeleteCommentError(error);
    } finally {
      setDeletingCommentId(null);
    }
  }

  return (
    <Drawer
      open={props.isOpen}
      side={props.side}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      onOpenChangeComplete={(open) => {
        if (!open) props.onExit();
      }}
    >
      <DrawerBackdrop data-print-hide="true" class="board-drawer-backdrop" />
      <DrawerContent
        finalFocus={props.restoreFocusTarget}
        render={(contentProps) => (
          <div
            {...contentProps}
            aria-labelledby={undefined}
            aria-label="Card details"
            data-board-overlay="true"
            data-print-hide="true"
            class="board-drawer-panel"
          />
        )}
      >
        <BoardOverlayHeader
          closeLabel="Close Card details"
          onClose={() => props.onClose()}
        >
          <div class="flex min-w-0 items-center gap-2">
            <Show when={column()}>
              {(col) => (
                <>
                  <span
                    aria-hidden="true"
                    class={[
                      'h-2.5 w-2.5 shrink-0 rounded-full',
                      COLUMN_ACCENT_STYLES[col().accent].swatch,
                    ]}
                  />
                  <h2 class="min-w-0 wrap-anywhere">
                    {col().title}
                  </h2>
                </>
              )}
            </Show>
          </div>
        </BoardOverlayHeader>

        {/* Scrollable body */}
        <div class="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {/* Card content */}
          <section class="space-y-3">
            <div class="text-base leading-relaxed text-text">
              <CardText text={props.card.content} />
            </div>

            <div class="flex flex-wrap items-center gap-2 text-xs text-text-muted">
              <Show when={props.card.isMine}>
                <span class="rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-text">
                  You
                </span>
              </Show>
              <Show when={props.card.isActionItem}>
                <span class="rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-text">
                  Action Item
                </span>
              </Show>
              <time class="tabular-nums">
                {formatRelativeTime(props.card.createdAt, workspace.nowMs)}
              </time>
            </div>

            <CardReactions
              cardId={props.card.id}
              reactions={props.card.reactions}
              myReactions={props.card.myReactions}
              disabled={!canInteract()}
              onToggleReaction={workspace.actions.toggleReaction}
            />

            <div class="space-y-2 rounded-lg border border-border bg-canvas p-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h3 class="text-xs font-semibold text-text-muted">
                  Action Item
                </h3>
                <label class="inline-flex min-h-11 min-w-11 cursor-pointer items-center gap-2 text-xs font-medium text-text">
                  <input
                    type="checkbox"
                    checked={props.card.isActionItem}
                    disabled={
                      !canEditActionItem(workspace, props.card, {
                        isActionItem: !props.card.isActionItem,
                      }) || isSavingAction()
                    }
                    onChange={async (event) => {
                      const checkbox = event.currentTarget;
                      const ok = await updateAction({ isActionItem: checkbox.checked });
                      if (!ok && checkbox.isConnected) checkbox.checked = props.card.isActionItem;
                    }}
                    class="h-4 w-4 cursor-pointer rounded-sm border-border accent-accent disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  {props.card.isActionItem
                    ? 'Action Item'
                    : 'Flag as Action Item'}
                </label>
              </div>

              <Show when={props.card.isActionItem}>
                <label class="flex min-h-11 min-w-11 cursor-pointer items-center gap-2 text-xs text-text">
                  <input
                    type="checkbox"
                    checked={followUp.doneChecked()}
                    disabled={followUp.doneDisabled()}
                    onChange={(event) => {
                      setActionError(null);
                      void followUp.changeDone(event.currentTarget);
                    }}
                    class="h-4 w-4 cursor-pointer rounded-sm border-border accent-accent disabled:cursor-not-allowed disabled:opacity-50"
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
                    ref={followUp.bindOwnerInput}
                    id={actionOwnerId}
                    type="text"
                    aria-label="Action owner"
                    aria-invalid={ownerEdit.error() ? 'true' : undefined}
                    placeholder={'e.g. "Platform"'}
                    // Uncontrolled: seeded on mount and re-synced while idle; typing and saves live in the DOM.
                    defaultValue={props.card.actionOwner}
                    maxlength={MAX_ACTION_OWNER_LENGTH}
                    disabled={
                      !canEditActionItemFollowUp(workspace, props.card) ||
                      workspace.actions.isActionItemPending(props.card.id)
                    }
                    readonly={ownerEdit.isSaving()}
                    {...ownerEdit.inputProps}
                    class={[
                      'mt-1 min-h-11 w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-text sm:min-h-9',
                      'placeholder:text-text-muted board-focus-ring read-only:opacity-50 disabled:opacity-50',
                    ]}
                  />
                  <p class="mt-1 text-[11px] text-text-muted">
                    Optional short tag, never an email or account.
                  </p>
                </div>
              </Show>
              <Show when={isSavingAction()}>
                <p role="status" class="text-xs text-text-muted">Updating Action Item…</p>
              </Show>
              <Show when={followUp.doneFailed()}>
                <p role="alert" class="text-sm text-rose-700 dark:text-rose-300">Could not update Done. Try again.</p>
              </Show>
              <Show when={ownerEdit.error() ?? actionError()}>
                {(message) => (
                  <p role="alert" class="text-sm text-rose-700 dark:text-rose-300">{message()}</p>
                )}
              </Show>
            </div>
          </section>

          {/* Chronological anonymous comments */}
          <section class="space-y-3 border-t border-border pt-4">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-xs font-semibold text-text-muted">
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
                      <p class="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-text">
                        {comment.content}
                      </p>
                      <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <div class="flex items-center gap-1.5 text-[11px] text-text-muted">
                          <Show when={comment.isMine}>
                            <span class="rounded-full border border-border bg-surface-subtle px-1.5 py-0.5 text-[10px] font-medium text-text">
                              You
                            </span>
                          </Show>
                          <time class="tabular-nums">
                            {formatRelativeTime(comment.createdAt, workspace.nowMs)}
                          </time>
                        </div>

                        <Show when={canDeleteComment(workspace, comment, props.card)}>
                          <button
                            type="button"
                            aria-label="Delete"
                            title="Delete comment"
                            disabled={deletingCommentId() !== null}
                            onClick={() => {
                              setDeleteCommentError(null);
                              void handleDeleteComment(comment.id);
                            }}
                            class={[
                              'inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md text-text-muted sm:min-h-7 sm:min-w-7',
                              'transition-colors hover:bg-surface-subtle hover:text-rose-700 dark:hover:text-rose-300',
                              'board-focus-ring',
                              'disabled:cursor-not-allowed disabled:opacity-50',
                            ]}
                          >
                            <LucideIcon icon={Trash2} class="size-3.5" />
                          </button>
                        </Show>
                      </div>
                      <Show when={deletingCommentId() === comment.id && deleteCommentError()}>
                        <p role="alert" class="mt-2 text-sm text-rose-700 dark:text-rose-300">{deleteCommentError()}</p>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </section>
        </div>

        {/* Comment composer footer */}
        <Show when={canInteract()}>
          <div class="border-t border-border bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 sm:pb-3">
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
                  aria-invalid={commentError() ? 'true' : undefined}
                  readonly={isPosting()}
                  placeholder="Write an anonymous comment..."
                  value={commentDraft()}
                  maxlength={MAX_COMMENT_LENGTH}
                  rows={2}
                  onInput={(e) => setCommentDraft(e.currentTarget.value)}
                  onKeyDown={handleComposerKeyDown}
                  class={[
                    'w-full resize-none rounded-md border border-border bg-canvas px-3 py-2 text-base text-text',
                    'placeholder:text-text-muted board-focus-ring',
                  ]}
                />
                <Show when={commentError()}>
                  <p role="alert" class="text-sm text-rose-700 dark:text-rose-300">{commentError()}</p>
                </Show>
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-[11px] text-text-muted tabular-nums">
                    {commentDraft().length}/{MAX_COMMENT_LENGTH}
                  </span>
                  <button
                    type="submit"
                    disabled={
                      isPosting() || commentDraft().trim().length === 0
                    }
                    class={[
                      'min-h-11 rounded-md bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-contrast sm:min-h-8',
                      'cursor-pointer transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50',
                      'board-focus-ring',
                    ]}
                  >
                    {isPosting() ? 'Posting…' : 'Post comment'}
                  </button>
                </div>
              </form>
            </Show>
          </div>
        </Show>
      </DrawerContent>
    </Drawer>
  );
}
