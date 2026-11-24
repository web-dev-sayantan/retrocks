import { Button } from '@ui-sdk/solid/button';
import { Field, FieldDescription, FieldLabel } from '@ui-sdk/solid/field';
import { Input } from '@ui-sdk/solid/input';
import type { JSX } from '@solidjs/web';
import { Show, createUniqueId, type ParentProps } from 'solid-js';

import { POKER_DISPLAY_NAME_LIMIT } from '../../lib/poker-types';
import './poker.css';

export default function RoomNameForm(props: ParentProps<{
  heading: string;
  description?: string;
  submitLabel: string;
  action: JSX.SerializableAttributeValue;
  error?: string;
  pending?: boolean;
  secondary?: JSX.Element;
}>) {
  const headingId = createUniqueId();

  return (
    <main class="poker-entry">
      <h1 id={headingId} class="poker-entry-title">{props.heading}</h1>
      <Show when={props.description}>
        <p class="mt-2.5 text-sm leading-relaxed text-text-muted [text-wrap:pretty]">{props.description}</p>
      </Show>
      <form action={props.action} aria-labelledby={headingId} class="poker-form mt-7 grid gap-5" method="post">
        <Field name="displayName" class="grid gap-1.5">
          <FieldLabel class="text-sm font-semibold">Display Name</FieldLabel>
          <FieldDescription class="text-xs leading-relaxed text-text-muted">
            Others in this Room can see your Display Name. Use your name or an alias.
          </FieldDescription>
          <Input
            class="poker-input board-focus-ring mt-1"
            autocomplete="nickname"
            enterkeyhint="go"
            required
            maxlength={POKER_DISPLAY_NAME_LIMIT}
            pattern={'.*\\S.*'}
          />
        </Field>
        {props.children}
        <Button
          type="submit"
          disabled={props.pending}
          class="poker-primary spring-press board-focus-ring justify-self-start !rounded-full !px-5 disabled:opacity-60"
        >
          {props.submitLabel}
        </Button>
        <p aria-live="polite" class="poker-error-text text-sm font-medium [&:empty]:hidden">{props.error}</p>
      </form>
      <Show when={props.secondary}>
        {(secondary) => <div class="mt-10 border-t border-border/60 pt-6">{secondary()}</div>}
      </Show>
    </main>
  );
}
