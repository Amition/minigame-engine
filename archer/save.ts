import { createSave, type SaveStore } from '@engine';
import { ARROWS, NO_UPGRADES, playerStats, START_SKULLS, type ArrowId, type PlayerStats, type UpgradeLevels } from './config';

export interface RunRecord {
  /** Enemies killed. */
  score: number;
  /** Skulls earned in the run. */
  skulls: number;
  /** Wall-clock ms (platform().now() is not wall time; use Date.now() only for this display field). */
  at: number;
}

export interface ArcherSave {
  skulls: number;
  levels: UpgradeLevels;
  /** Permanently unlocked arrows ('normal' is always owned). */
  owned: ArrowId[];
  /** Arrows carried into the next run, in switcher order; at most currentStats().slots. */
  equipped: ArrowId[];
  /** Best score (kills in one run). */
  best: number;
  /** Best runs, highest score first, at most 10 (the local leaderboard). */
  runs: RunRecord[];
  games: number;
}

const store = createSave<ArcherSave>('archer', {
  skulls: START_SKULLS,
  levels: { ...NO_UPGRADES },
  owned: ['normal'],
  equipped: ['normal'],
  best: 0,
  runs: [],
  games: 0,
});

/** Persistent progress. */
export function archerSave(): SaveStore<ArcherSave> {
  return store;
}

/** Stats from the saved upgrade levels. */
export function currentStats(): PlayerStats {
  return playerStats({ ...NO_UPGRADES, ...store.data.levels });
}

/**
 * Arrows tried for one run through a rewarded ad (单次体验). Not saved; the play scene clears it when a run ends.
 */
export const trials = new Set<ArrowId>();

/** Arrow types available in the next run: equipped (trimmed to the slot count) plus trials; never empty. */
export function loadout(): ArrowId[] {
  const slots = currentStats().slots;
  const known = new Set(ARROWS.map((a) => a.id));
  const list = store.data.equipped.filter((id) => known.has(id)).slice(0, slots);
  for (const id of trials) if (!list.includes(id)) list.push(id);
  if (list.length === 0) list.push('normal');
  return list;
}

export function addSkulls(n: number): void {
  if (n === 0) return;
  store.set({ skulls: Math.max(0, store.data.skulls + Math.round(n)) });
}

/** Records a finished run (leaderboard, best, games) and flushes. Returns true for a new best. */
export function recordRun(score: number, skulls: number): boolean {
  const d = store.data;
  const record = score > d.best;
  const runs = [...d.runs, { score, skulls, at: Date.now() }].sort((a, b) => b.score - a.score || b.skulls - a.skulls).slice(0, 10);
  store.set({ best: Math.max(d.best, score), runs, games: d.games + 1 });
  store.flush();
  return record;
}
