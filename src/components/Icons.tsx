interface IconProps {
  class?: string;
}

export function PlusIcon(props: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class ?? 'h-4 w-4'}
    >
      <path d="M8 3.25v9.5M3.25 8h9.5" />
    </svg>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class ?? 'h-3.5 w-3.5'}
    >
      <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5.25 12.75 2.5 13.5l.75-2.75L11.5 2.5Z" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class ?? 'h-3.5 w-3.5'}
    >
      <path d="M2.75 4.25h10.5M6 4.25V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.25M4.25 4.25l.6 8.25a1 1 0 0 0 1 .92h4.3a1 1 0 0 0 1-.92l.6-8.25" />
    </svg>
  );
}

export function ArrowRightLeftIcon(props: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class ?? 'h-3.5 w-3.5'}
    >
      <path d="M3 5.25h10M10.5 2.75 13 5.25l-2.5 2.5M13 10.75H3M5.5 8.25 3 10.75l2.5 2.5" />
    </svg>
  );
}

export function MoreHorizontalIcon(props: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="currentColor"
      class={props.class ?? 'h-4 w-4'}
    >
      <circle cx="3.5" cy="8" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="12.5" cy="8" r="1.25" />
    </svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class ?? 'h-3.5 w-3.5'}
    >
      <path d="M10 3.5 5.5 8 10 12.5" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class ?? 'h-3.5 w-3.5'}
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class ?? 'h-3.5 w-3.5'}
    >
      <path d="M3.25 8.5 6.5 11.75 12.75 4.5" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class ?? 'h-3.5 w-3.5'}
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function SmilePlusIcon(props: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class ?? 'h-3.5 w-3.5'}
    >
      <path d="M13.5 8.5a5.5 5.5 0 1 1-6-6" />
      <path d="M5.75 9.5a2.5 2.5 0 0 0 4.5 0" />
      <circle cx="6" cy="7" r=".6" fill="currentColor" stroke="none" />
      <circle cx="10" cy="7" r=".6" fill="currentColor" stroke="none" />
      <path d="M12.25 1.75v3.5M10.5 3.5H14" />
    </svg>
  );
}

export function FlagIcon(props: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class ?? 'h-3.5 w-3.5'}
    >
      <path d="M3.75 13.75v-11h3.1c.9 0 1.35.35 2.2.35.85 0 1.3-.35 2.2-.35h1v6.75h-1c-.9 0-1.35.35-2.2.35-.85 0-1.3-.35-2.2-.35h-3.1" />
    </svg>
  );
}

export function MessageSquareIcon(props: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class ?? 'h-3.5 w-3.5'}
    >
      <path d="M13.5 9.75a1.5 1.5 0 0 1-1.5 1.5H5.5L2.5 13.75V4a1.5 1.5 0 0 1 1.5-1.5h8a1.5 1.5 0 0 1 1.5 1.5z" />
    </svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class ?? 'h-3.5 w-3.5'}
    >
      <path d="M8 2.5v7.25M5.25 7.25 8 10l2.75-2.75M2.75 11.75v1a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1v-1" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class ?? 'h-3.5 w-3.5'}
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  );
}
