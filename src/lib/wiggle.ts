import { createSignal, onCleanup } from 'solid-js';

export const UI_WIGGLE_DURATION_MS = 380;

export interface WiggleController {
  readonly wiggling: () => boolean;
  readonly trigger: () => void;
  readonly cancel: () => void;
  readonly ref: (el: HTMLElement | undefined) => void;
  readonly onAnimationEnd: (event: AnimationEvent) => void;
}

/**
 * Reusable attention-wiggle controller paired with the `.ui-wiggle` CSS class.
 *
 * Attach `ref`, `class="... ui-wiggle"`, `data-wiggling={wiggle.wiggling() ? 'true' : undefined}`,
 * and `onAnimationEnd={wiggle.onAnimationEnd}` to the target element, then call `wiggle.trigger()`.
 */
export function createWiggle(durationMs = UI_WIGGLE_DURATION_MS): WiggleController {
  const [wiggling, setWiggling] = createSignal(false);
  let target: HTMLElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function cancel() {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    setWiggling(false);
  }

  function trigger() {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }

    if (wiggling() && target && typeof target.getAnimations === 'function') {
      for (const animation of target.getAnimations()) {
        if ('animationName' in animation && animation.animationName === 'ui-wiggle') {
          animation.currentTime = 0;
          animation.play();
        }
      }
    }

    setWiggling(true);
    timer = setTimeout(() => {
      timer = undefined;
      setWiggling(false);
    }, durationMs);
  }

  onCleanup(cancel);

  return {
    wiggling,
    trigger,
    cancel,
    ref: (el: HTMLElement | undefined) => {
      target = el;
    },
    onAnimationEnd: (event: AnimationEvent) => {
      if (event.target !== event.currentTarget) return;
      if (event.animationName && event.animationName !== 'ui-wiggle') return;
      cancel();
    },
  };
}
