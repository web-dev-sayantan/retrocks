export function getEnabledMenuItems(menu: HTMLElement | undefined): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? []).filter((item) => {
    if (item.matches(':disabled, [aria-disabled="true"]') || item.closest('[hidden]')) return false;
    const style = getComputedStyle(item);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}
