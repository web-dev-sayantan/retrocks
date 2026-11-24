import type { JSX } from '@solidjs/web';
import { onSettled } from 'solid-js';

type EditorElement = HTMLInputElement | HTMLTextAreaElement;

interface InlineEditorMountProps {
  bind: (input: EditorElement) => () => void;
  children: (ref: (input: EditorElement) => void) => JSX.Element;
}

export function InlineEditorMount(props: InlineEditorMountProps): JSX.Element {
  let input: EditorElement | undefined;

  onSettled(() => {
    if (input?.isConnected) return props.bind(input);
  });

  const ref = (element: EditorElement) => { input = element; };
  return <>{props.children(ref)}</>;
}
