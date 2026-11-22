export const pokerSetupPath = '/pointing-poker';

export function pokerRoomPath(id: string): string {
  return `/p/${encodeURIComponent(id)}`;
}

export function isPokerRoomPathname(pathname: string): boolean {
  return /^\/p\/[^/]+\/?$/.test(pathname);
}
