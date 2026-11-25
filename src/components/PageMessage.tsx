import type { ParentProps } from 'solid-js';

export default function PageMessage(props: ParentProps<{
  title: string;
  message: string;
  headingRef?: (element: HTMLHeadingElement) => void;
}>) {
  return (
    <main class="mx-auto grid min-h-[60dvh] w-full max-w-xl flex-1 place-items-center px-4 py-12 sm:px-6">
      <div class="w-full space-y-4 rounded-lg border border-border bg-surface p-6 sm:p-8">
        <h1
          ref={(element) => props.headingRef?.(element)}
          tabindex={props.headingRef ? -1 : undefined}
          class="text-2xl font-semibold tracking-tight text-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
        >
          {props.title}
        </h1>
        <p class="text-base leading-relaxed text-text-muted">{props.message}</p>
        {props.children}
      </div>
    </main>
  );
}
