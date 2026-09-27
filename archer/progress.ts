import { ARROWS, arrowDef, upgradeCost, type ArrowId, type UpgradeId } from './config';
import { archerSave, currentStats, trials } from './save';

/**
 * Meta progression over archerSave(): upgrade purchases, arrow unlocks, the equipped loadout and ad trials.
 * No rendering; successful changes are flushed to storage right away.
 */

export type BuyResult = 'ok' | 'max' | 'poor';
export type UnlockResult = 'ok' | 'owned' | 'poor';
export type EquipResult = 'equipped' | 'unequipped' | 'full' | 'locked' | 'last';

export function skulls(): number {
  return archerSave().data.skulls;
}

/** True when the save holds at least `n` skulls (never for Infinity, the price of a maxed upgrade). */
export function canAfford(n: number): boolean {
  return Number.isFinite(n) && skulls() >= n;
}

export function upgradeLevel(id: UpgradeId): number {
  return archerSave().data.levels[id] ?? 0;
}

/** Price of the next level; Infinity when maxed. */
export function nextUpgradeCost(id: UpgradeId): number {
  return upgradeCost(id, upgradeLevel(id));
}

export function isMaxed(id: UpgradeId): boolean {
  return !Number.isFinite(nextUpgradeCost(id));
}

export function buyUpgrade(id: UpgradeId): BuyResult {
  const s = archerSave();
  const level = upgradeLevel(id);
  const cost = upgradeCost(id, level);
  if (!Number.isFinite(cost)) return 'max';
  if (!canAfford(cost)) return 'poor';
  s.set({ skulls: s.data.skulls - cost, levels: { ...s.data.levels, [id]: level + 1 } });
  s.flush();
  return 'ok';
}

export function isOwned(id: ArrowId): boolean {
  return id === 'normal' || archerSave().data.owned.includes(id);
}

/** Equipped arrows as the next run sees them: owned, known, in order, trimmed to the slot count. */
export function equippedArrows(): ArrowId[] {
  const known = new Set(ARROWS.map((a) => a.id));
  const list = archerSave().data.equipped.filter((id, i, all) => known.has(id) && isOwned(id) && all.indexOf(id) === i);
  return list.slice(0, currentStats().slots);
}

export function isEquipped(id: ArrowId): boolean {
  return equippedArrows().includes(id);
}

/** 1-based position in the loadout, 0 when not equipped. */
export function equipSlot(id: ArrowId): number {
  return equippedArrows().indexOf(id) + 1;
}

export function unlockArrow(id: ArrowId): UnlockResult {
  if (isOwned(id)) return 'owned';
  const cost = arrowDef(id).cost;
  if (!canAfford(cost)) return 'poor';
  const s = archerSave();
  const equipped = equippedArrows();
  if (equipped.length < currentStats().slots) equipped.push(id);
  s.set({ skulls: s.data.skulls - cost, owned: [...s.data.owned, id], equipped });
  s.flush();
  return 'ok';
}

export function toggleEquip(id: ArrowId): EquipResult {
  if (!isOwned(id)) return 'locked';
  const s = archerSave();
  const equipped = equippedArrows();
  if (equipped.includes(id)) {
    if (equipped.length <= 1) return 'last';
    s.set({ equipped: equipped.filter((e) => e !== id) });
    s.flush();
    return 'unequipped';
  }
  if (equipped.length >= currentStats().slots) return 'full';
  s.set({ equipped: [...equipped, id] });
  s.flush();
  return 'equipped';
}

/** Lends a locked arrow for the next run (rewarded ad); the play scene clears `trials` when the run ends. */
export function grantTrial(id: ArrowId): void {
  trials.add(id);
}

export function hasTrial(id: ArrowId): boolean {
  return trials.has(id);
}
