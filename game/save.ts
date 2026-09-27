import { createSave, type SaveStore } from '@engine';

export interface SuikaSave {
  best: number;
  games: number;
  watermelons: number;
}

let store: SaveStore<SuikaSave> | null = null;

/** Persistent progress (created on first use, after the platform is set). */
export function suikaSave(): SaveStore<SuikaSave> {
  store ??= createSave<SuikaSave>('suika', { best: 0, games: 0, watermelons: 0 });
  return store;
}
