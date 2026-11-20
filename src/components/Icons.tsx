import {
  ArrowRightLeft,
  Check,
  ChevronRight,
  Ellipsis,
  Flag,
  MessageSquare,
  Pencil,
  Plus,
  SmilePlus,
  Trash2,
  X,
} from 'lucide';
import LucideIcon from './LucideIcon';

interface IconProps {
  class?: string;
}

export function PlusIcon(props: IconProps) {
  return <LucideIcon icon={Plus} class={props.class ?? 'size-4'} />;
}

export function PencilIcon(props: IconProps) {
  return <LucideIcon icon={Pencil} class={props.class ?? 'size-3.5'} />;
}

export function TrashIcon(props: IconProps) {
  return <LucideIcon icon={Trash2} class={props.class ?? 'size-3.5'} />;
}

export function ArrowRightLeftIcon(props: IconProps) {
  return <LucideIcon icon={ArrowRightLeft} class={props.class ?? 'size-3.5'} />;
}

export function MoreHorizontalIcon(props: IconProps) {
  return <LucideIcon icon={Ellipsis} class={props.class ?? 'size-4'} />;
}

export function ChevronRightIcon(props: IconProps) {
  return <LucideIcon icon={ChevronRight} class={props.class ?? 'size-3.5'} />;
}

export function CheckIcon(props: IconProps) {
  return <LucideIcon icon={Check} class={props.class ?? 'size-3.5'} />;
}

export function CloseIcon(props: IconProps) {
  return <LucideIcon icon={X} class={props.class ?? 'size-3.5'} />;
}

export function SmilePlusIcon(props: IconProps) {
  return <LucideIcon icon={SmilePlus} class={props.class ?? 'size-3.5'} />;
}

export function FlagIcon(props: IconProps) {
  return <LucideIcon icon={Flag} class={props.class ?? 'size-3.5'} />;
}

export function MessageSquareIcon(props: IconProps) {
  return <LucideIcon icon={MessageSquare} class={props.class ?? 'size-3.5'} />;
}
