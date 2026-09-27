import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestGame, type TestGame } from '@engine/testing';
import { arrowDef, START_SKULLS, upgradeCost } from './config';
import {
  buyUpgrade,
  canAfford,
  equippedArrows,
  equipSlot,
  grantTrial,
  hasTrial,
  isMaxed,
  isOwned,
  nextUpgradeCost,
  toggleEquip,
  unlockArrow,
  upgradeLevel,
} from './progress';
import { archerSave, currentStats, loadout, trials } from './save';

let t: TestGame | null = null;
beforeEach(async () => {
  t = await createTestGame({ render: 'none', pixelRatio: 1 });
  trials.clear();
});
afterEach(() => {
  t?.destroy();
  t = null;
});

const setSkulls = (n: number) => archerSave().set({ skulls: n });

describe('progress', () => {
  it('starts from the defaults on fresh storage', () => {
    expect(archerSave().data.skulls).toBe(START_SKULLS);
    expect(equippedArrows()).toEqual(['normal']);
    expect(isOwned('normal')).toBe(true);
    expect(isOwned('electric')).toBe(false);
  });

  it('canAfford compares with the saved skulls and never affords Infinity', () => {
    setSkulls(50);
    expect(canAfford(50)).toBe(true);
    expect(canAfford(51)).toBe(false);
    expect(canAfford(Infinity)).toBe(false);
  });

  it('buyUpgrade deducts the cost and raises the level', () => {
    setSkulls(100);
    expect(buyUpgrade('hp')).toBe('ok');
    expect(upgradeLevel('hp')).toBe(1);
    expect(archerSave().data.skulls).toBe(100 - upgradeCost('hp', 0));
    expect(nextUpgradeCost('hp')).toBe(upgradeCost('hp', 1));
    expect(currentStats().maxHp).toBe(125);
  });

  it('buyUpgrade refuses when poor and keeps the save untouched', () => {
    setSkulls(5);
    expect(buyUpgrade('armor')).toBe('poor');
    expect(upgradeLevel('armor')).toBe(0);
    expect(archerSave().data.skulls).toBe(5);
  });

  it('buyUpgrade stops at the max level', () => {
    setSkulls(1_000_000);
    for (let i = 0; i < 3; i++) expect(buyUpgrade('slots')).toBe('ok');
    expect(isMaxed('slots')).toBe(true);
    const left = archerSave().data.skulls;
    expect(buyUpgrade('slots')).toBe('max');
    expect(archerSave().data.skulls).toBe(left);
    expect(upgradeLevel('slots')).toBe(3);
  });

  it('purchases are flushed to storage', async () => {
    setSkulls(100);
    buyUpgrade('damage');
    const raw = t!.platform.storage.get('archer');
    expect(raw).toContain('"damage":1');
  });

  it('unlockArrow buys an arrow and auto-equips it while a slot is free', () => {
    setSkulls(1000);
    expect(unlockArrow('electric')).toBe('ok');
    expect(isOwned('electric')).toBe(true);
    expect(archerSave().data.skulls).toBe(1000 - arrowDef('electric').cost);
    expect(equippedArrows()).toEqual(['normal', 'electric']);
    expect(equipSlot('electric')).toBe(2);
    expect(unlockArrow('electric')).toBe('owned');
    expect(unlockArrow('poison')).toBe('ok');
    expect(isOwned('poison')).toBe(true);
    expect(equippedArrows()).toEqual(['normal', 'electric']);
  });

  it('unlockArrow refuses when poor', () => {
    setSkulls(10);
    expect(unlockArrow('missile')).toBe('poor');
    expect(isOwned('missile')).toBe(false);
    expect(archerSave().data.skulls).toBe(10);
  });

  it('toggleEquip equips, unequips, respects the slot count and keeps one arrow', () => {
    setSkulls(10_000);
    unlockArrow('electric');
    unlockArrow('poison');
    expect(toggleEquip('missile')).toBe('locked');
    expect(toggleEquip('poison')).toBe('full');
    expect(toggleEquip('electric')).toBe('unequipped');
    expect(toggleEquip('poison')).toBe('equipped');
    expect(equippedArrows()).toEqual(['normal', 'poison']);
    expect(toggleEquip('normal')).toBe('unequipped');
    expect(toggleEquip('poison')).toBe('last');
    expect(equippedArrows()).toEqual(['poison']);
    buyUpgrade('slots');
    expect(toggleEquip('electric')).toBe('equipped');
    expect(toggleEquip('normal')).toBe('equipped');
    expect(equippedArrows()).toEqual(['poison', 'electric', 'normal']);
    expect(loadout()).toEqual(['poison', 'electric', 'normal']);
  });

  it('grantTrial lends a locked arrow for the next run', () => {
    expect(hasTrial('split')).toBe(false);
    grantTrial('split');
    expect(hasTrial('split')).toBe(true);
    expect(isOwned('split')).toBe(false);
    expect(loadout()).toEqual(['normal', 'split']);
  });
});
