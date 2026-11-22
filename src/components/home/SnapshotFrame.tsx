import type { JSX } from '@solidjs/web';
import type { ParentProps } from 'solid-js';

export default function SnapshotFrame(props: ParentProps<{ title: string; status: JSX.Element }>) {
  return (
    <div
      aria-hidden="true"
      class="home-preview-frame home-snapshot flex min-w-0 flex-col overflow-clip rounded-2xl border border-border bg-surface select-none"
    >
      <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-border/75 px-3.5 py-2.5">
        <p class="font-semibold">{props.title}</p>
        <div class="flex flex-wrap items-center gap-1.5">{props.status}</div>
      </div>
      {props.children}
    </div>
  );
}
