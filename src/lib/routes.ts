/**
 * Returns true for all Board workspace paths (`/b` and `/b/*`).
 * Shared between server middleware (`X-Robots-Tag`) and app meta (`<meta name="robots">`).
 */
export function isBoardPathname(pathname: string): boolean {
  return pathname === '/b' || pathname.startsWith('/b/');
}
