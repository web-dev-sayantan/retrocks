export type PokerSharingResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: 'ROOM_NOT_FOUND' | 'FORBIDDEN' | 'INVALID_LINK' | 'LINK_REPLACED' | 'RATE_LIMITED' | 'LINK_UNAVAILABLE';
      message: string;
    };

export interface PokerFacilitatorLink {
  href: string;
  revision: number;
}
