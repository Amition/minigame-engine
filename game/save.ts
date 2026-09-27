import { createSave, type SaveStore } from '@engine';

export interface SuikaSave {
  best: number;
  games: number;
  watermelons: number;
}

const store = createSave<SuikaSave>('suika', { best: 0, games: 0, watermelons: 0 });

/** Persistent progress. */
export function suikaSave(): SaveStore<SuikaSave> {
  return store;
}
