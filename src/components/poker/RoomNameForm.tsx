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
}>) {
  const headingId = createUniqueId();

  return (
    <main class="poker-entry">
      <h1 id={headingId} class="poker-title">{props.heading}</h1>
      <Show when={props.description}>
        <p class="mt-3 text-base leading-relaxed text-text-muted">{props.description}</p>
      </Show>
      <form action={props.action} aria-labelledby={headingId} class="poker-form mt-8 grid gap-5" method="post">
        <Field name="displayName" class="grid gap-2">
          <FieldLabel class="font-semibold">Display Name</FieldLabel>
          <FieldDescription class="text-sm leading-relaxed text-text-muted">
            Others in this Room can see your Display Name. Use your name or an alias.
          </FieldDescription>
          <Input
            class="poker-input board-focus-ring"
            autocomplete="nickname"
            enterkeyhint="go"
            required
            maxlength={POKER_DISPLAY_NAME_LIMIT}
            pattern={'.*\\S.*'}
          />
        </Field>
        {props.children}
        <Button type="submit" disabled={props.pending} class="poker-primary board-focus-ring justify-self-start disabled:opacity-65">
          {props.submitLabel}
        </Button>
        <p aria-live="polite" class="text-sm font-medium text-[var(--poker-error)]">{props.error}</p>
      </form>
    </main>
  );
}
