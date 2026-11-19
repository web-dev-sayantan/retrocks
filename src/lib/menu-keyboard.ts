export function getEnabledMenuItems(menu: HTMLElement | undefined): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? []).filter((item) => {
    if (item.matches(':disabled, [aria-disabled="true"]') || item.closest('[hidden]')) return false;
    const style = getComputedStyle(item);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

export function handleMenuNavigation(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing) return;
  const menu = event.currentTarget as HTMLElement;
  const items = getEnabledMenuItems(menu);
  if (items.length === 0) return;

  const index = items.indexOf(document.activeElement as HTMLElement);
  let next: HTMLElement | undefined;
  switch (event.key) {
    case 'Home': next = items[0]; break;
    case 'End': next = items.at(-1); break;
    case 'ArrowDown': next = items[(index + 1) % items.length]; break;
    case 'ArrowUp': next = index <= 0 ? items.at(-1) : items[index - 1]; break;
  }
  if (next) {
    event.preventDefault();
    next.focus();
  }
}
