let supportsTopLayerExit: boolean | undefined;

function canTransitionTopLayerExit(): boolean {
  if (!globalThis.CSS?.supports('overlay: auto')) return false;
  if (supportsTopLayerExit !== undefined) return supportsTopLayerExit;

  // Some engines parse allow-discrete but still hide display: none immediately.
  const probe = document.createElement('div');
  probe.style.cssText = 'position: fixed; transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  void getComputedStyle(probe).display;
  probe.style.display = 'none';
  supportsTopLayerExit = getComputedStyle(probe).display === 'block';
  probe.remove();
  return supportsTopLayerExit;
}

export function showBoardDrawer(dialog: HTMLDialogElement): void {
  dialog.removeAttribute('data-closing');
  if (!dialog.open) dialog.showModal();
}

export function closeBoardDrawer(
  dialog: HTMLDialogElement,
  afterClose: () => void,
  afterExit?: () => void,
): () => void {
  let interrupted = false;
  const panel = dialog.firstElementChild;
  const transitions = () => panel?.getAnimations?.() ?? [];
  function finishClose() {
    dialog.removeAttribute('data-closing');
    dialog.close();
    afterClose();
  }
  function afterTransitions(animations: Animation[], callback: () => void) {
    if (animations.length === 0) {
      callback();
      return;
    }
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (!interrupted) callback();
    });
  }

  if (canTransitionTopLayerExit()) {
    finishClose();
    if (afterExit) afterTransitions(transitions(), afterExit);
  } else {
    dialog.setAttribute('data-closing', '');
    afterTransitions(transitions(), () => {
      finishClose();
      afterExit?.();
    });
  }
  return () => { interrupted = true; };
}

export function createDrawerBackdropDismiss(close: () => void) {
  let pressed = false;

  function reset() {
    pressed = false;
  }

  return {
    reset,
    onPointerDown(event: PointerEvent) {
      pressed = event.target === event.currentTarget && event.button === 0;
    },
    onClick(event: MouseEvent) {
      const dismiss = pressed && event.target === event.currentTarget;
      reset();
      if (dismiss) close();
    },
  };
}
