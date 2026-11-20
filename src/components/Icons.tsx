import {
  ArrowRightLeft,
  Flag,
  Pencil,
  Plus,
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

export function CloseIcon(props: IconProps) {
  return <LucideIcon icon={X} class={props.class ?? 'size-3.5'} />;
}

export function FlagIcon(props: IconProps) {
  return <LucideIcon icon={Flag} class={props.class ?? 'size-3.5'} />;
}
