import { Dynamic, type JSX } from '@solidjs/web';
import type { IconNode } from 'lucide';
import { For } from 'solid-js';

export interface LucideIconProps {
  icon: IconNode;
  class?: JSX.SvgSVGAttributes<SVGSVGElement>['class'];
  strokeWidth?: number;
}

export default function LucideIcon(props: LucideIconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={props.strokeWidth ?? 1.75}
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class ?? 'size-4 shrink-0'}
    >
      {/* xmlns pins every child to the SVG namespace so unknown shape tags still render. */}
      <For each={props.icon}>
        {(node) => (
          <Dynamic
            component={node[0]}
            xmlns="http://www.w3.org/2000/svg"
            {...node[1]}
          />
        )}
      </For>
    </svg>
  );
}
