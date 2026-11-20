// Registers @testing-library/jest-dom's matchers (toHaveTextContent etc.)
// with vitest's expect, including their types.
import '@testing-library/jest-dom/vitest';

// jsdom exposes the dialog element but leaves its modal methods to the browser.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}

// jsdom omits or leaves unimplemented several members @ui-sdk/solid relies on.
if (typeof HTMLElement !== 'undefined') {
  HTMLElement.prototype.showPopover = function () {};
  HTMLElement.prototype.hidePopover = function () {};
}

// jsdom never implements isContentEditable, so @ui-sdk/solid's shortcut
// registry cannot tell a contenteditable region from plain markup.
if (
  typeof HTMLElement !== 'undefined' &&
  typeof HTMLElement.prototype.isContentEditable === 'undefined'
) {
  Object.defineProperty(HTMLElement.prototype, 'isContentEditable', {
    configurable: true,
    get(this: HTMLElement) {
      return this.closest('[contenteditable]:not([contenteditable="false"])') !== null;
    },
  });
}
if (typeof Element !== 'undefined') {
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = function () {};
  Element.prototype.checkVisibility = () => true;
  Element.prototype.getClientRects = () => [] as unknown as DOMRectList;
}
if (typeof document !== 'undefined') {
  document.elementFromPoint = () => null;
  document.elementsFromPoint = () => [];
  document.head.appendChild(
    Object.assign(document.createElement('style'), {
      textContent: '[popover]:not([hidden]) { display: block !important }',
    }),
  );
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
