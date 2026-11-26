import { Button } from '@ui-sdk/solid/button';
import { Field, FieldDescription, FieldLabel } from '@ui-sdk/solid/field';
import { Input } from '@ui-sdk/solid/input';
import type { JSX } from '@solidjs/web';
import { Show, createUniqueId, onSettled, type ParentProps } from 'solid-js';

import { POKER_DISPLAY_NAME_LIMIT } from '../../lib/poker-types';
import './poker.css';

export default function RoomNameForm(props: ParentProps<{
  heading: string;
  description?: string;
  submitLabel: string;
  action: JSX.SerializableAttributeValue;
  error?: string;
  pending?: boolean;
  focusHeading?: boolean;
  secondary?: JSX.Element;
  preview?: JSX.Element;
  onDisplayNameChange?: (value: string) => void;
}>) {
  const headingId = createUniqueId();
  let heading!: HTMLHeadingElement;

  onSettled(() => {
    if (props.focusHeading) heading.focus();
  });

  const formColumn = () => (
    <div class="min-w-0">
      <h1
        ref={heading}
        id={headingId}
        tabindex={props.focusHeading ? -1 : undefined}
        class="board-focus-ring text-[2rem] leading-[1.12] font-semibold tracking-[-0.03em] text-text sm:text-[2.25rem]"
      >
        {props.heading}
      </h1>
      <Show when={props.description}>
        <p class="mt-2 max-w-[42ch] text-[15px] leading-relaxed text-text-muted [text-wrap:pretty]">{props.description}</p>
      </Show>
      <form action={props.action} aria-labelledby={headingId} class="mt-7 grid gap-5" method="post">
        <Field name="displayName" class="grid gap-2">
          <FieldLabel class="text-sm font-medium text-text">Display Name</FieldLabel>
          <Input
            class="board-input board-focus-ring"
            autocomplete="nickname"
            enterkeyhint="go"
            required
            maxlength={POKER_DISPLAY_NAME_LIMIT}
            pattern={'.*\\S.*'}
            onValueChange={(value) => props.onDisplayNameChange?.(value)}
          />
          <FieldDescription class="text-xs leading-relaxed text-text-muted">
            Others in this Room can see your Display Name. Use your name or an alias.
          </FieldDescription>
        </Field>
        {props.children}
        <Show when={props.error}>
          {(error) => (
            <p role="alert" class="disclosure-reveal rounded-md border border-col-rose bg-col-rose-tint px-3.5 py-2.5 text-sm text-text">
              {error()}
            </p>
          )}
        </Show>
        <Button
          type="submit"
          disabled={props.pending}
          class="spring-press board-focus-ring inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-md bg-accent px-5 py-2.5 text-base font-semibold text-accent-contrast hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {props.submitLabel}
        </Button>
      </form>
    </div>
  );

  return (
    <Show
      when={props.preview}
      fallback={
        <main class="poker-entry">
          {formColumn()}
          <Show when={props.secondary}>
            {(secondary) => <div class="mt-10 border-t border-border/60 pt-6">{secondary()}</div>}
          </Show>
        </main>
      }
    >
      {(preview) => (
        <main class="poker-entry-studio mx-auto max-w-xl px-4 pt-6 pb-12 sm:px-6 sm:pt-10 sm:pb-16 lg:max-w-6xl lg:pt-12 lg:pb-20">
          <div class="grid min-w-0 grid-cols-1 gap-y-8 lg:grid-cols-[minmax(0,26.5rem)_minmax(0,1fr)] lg:items-stretch lg:gap-x-12 xl:gap-x-16">
            <div class="min-w-0 lg:col-start-1">{formColumn()}</div>
            <div class="flex min-w-0 flex-col gap-6 lg:sticky lg:top-20 lg:col-start-2 lg:row-start-1">
              <div class="min-h-0 lg:flex-1">{preview()}</div>
              {props.secondary}
            </div>
          </div>
        </main>
      )}
    </Show>
  );
}
