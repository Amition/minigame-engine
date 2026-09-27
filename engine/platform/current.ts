import type { Platform } from './types';

let current: Platform | null = null;

export function setPlatform(p: Platform | null): void {
  current = p;
}

/** The active platform. Throws if called before runApp/createTestGame set one. */
export function platform(): Platform {
  if (!current) throw new Error('No platform set. Call runApp() or createTestGame() first.');
  return current;
}

export function hasPlatform(): boolean {
  return current !== null;
}
