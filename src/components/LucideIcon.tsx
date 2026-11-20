import type { JSX } from '@solidjs/web';
import type { IconNode } from 'lucide';
import { For, Match, Switch } from 'solid-js';

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
      <For each={props.icon}>
        {(node) => (
          <Switch>
            <Match when={node[0] === 'path'}>
              <path {...(node[1] as Record<string, string | number | undefined>)} />
            </Match>
            <Match when={node[0] === 'circle'}>
              <circle {...(node[1] as Record<string, string | number | undefined>)} />
            </Match>
            <Match when={node[0] === 'rect'}>
              <rect {...(node[1] as Record<string, string | number | undefined>)} />
            </Match>
            <Match when={node[0] === 'line'}>
              <line {...(node[1] as Record<string, string | number | undefined>)} />
            </Match>
            <Match when={node[0] === 'polyline'}>
              <polyline {...(node[1] as Record<string, string | number | undefined>)} />
            </Match>
            <Match when={node[0] === 'polygon'}>
              <polygon {...(node[1] as Record<string, string | number | undefined>)} />
            </Match>
            <Match when={node[0] === 'ellipse'}>
              <ellipse {...(node[1] as Record<string, string | number | undefined>)} />
            </Match>
          </Switch>
        )}
      </For>
    </svg>
  );
}
