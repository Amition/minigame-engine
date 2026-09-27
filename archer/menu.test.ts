import { afterEach, describe, expect, it } from 'vitest';
import {
  convertPoint,
  formatLint,
  isAudioMuted,
  keepClearZones,
  lintUI,
  openModalsOf,
  setUILayout,
  type Node,
  type Rect,
  type ScrollView,
} from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';
import { AD_SKULLS, arrowDef, NO_UPGRADES, START_SKULLS, upgradeCost } from './config';
import { screenLayout } from './layout';
import app from './main';
import { equippedArrows, hasTrial, isOwned, unlockArrow } from './progress';
import { archerSave, loadout, trials } from './save';
import { menuGeometry } from './scenes/menu';
import type { MenuPreviewParams, MenuPreviewScene } from './scenes/menu-preview';

const DEVICES = ['iphone-se-land', 'iphone-14-land', 'ipad-land'] as const;
const shots = !!process.env.GAME_SHOTS;

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
  trials.clear();
});

async function open(device: string = 'iphone-se-land', params?: MenuPreviewParams): Promise<{ t: TestGame; scene: MenuPreviewScene }> {
  t = await createTestGame({ app, device, scene: 'menu-preview', params, render: 'none', pixelRatio: 1 });
  await t.advance(0.3);
  return { t, scene: t.scene as MenuPreviewScene };
}

/** Lint errors plus the tap-size and font-size rules (warnings by default, required here). */
function expectClean(game: TestGame, label: string): void {
  const issues = lintUI(game.game.stage, game.game);
  const bad = issues.filter((i) => i.severity === 'error' || i.rule === 'small-tap-target' || i.rule === 'small-font');
  expect(bad, `${label}\n${formatLint(issues)}`).toHaveLength(0);
}

const text = (tg: TestGame, sel: string) => String(tg.get(sel).describe().text ?? '');
const toasts = (tg: TestGame) => tg.findAll('Toast').map((n) => String(n.describe().text));
const inside = (r: Rect, x: number, y: number) => x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
const offBy = (a: Rect, b: Rect) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h));
const covers = (tg: TestGame) => lintUI(tg.game.stage, tg.game).filter((i) => i.rule === 'covers-keep-clear');
const hitRect = (n: Node): Rect => {
  const b = n.worldBounds();
  const p = n.hitPadding;
  return { x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p };
};

describe('start menu layout', () => {
  it('menu and its dialogs lint clean on three landscape devices', async () => {
    const states: [string, MenuPreviewParams | undefined, string[]][] = [
      ['menu', undefined, []],
      ['menu-demo', { demo: true }, []],
      ['settings', undefined, ['#menu-settings']],
      ['leaderboard-empty', undefined, ['#menu-leaderboard']],
      ['leaderboard', { demo: true }, ['#menu-leaderboard']],
      ['arrow-locked', undefined, ['#arrow-electric']],
      ['arrow-trial', undefined, ['#arrow-split']],
    ];
    for (const device of DEVICES) {
      for (const [state, params, taps] of states) {
        const { t: tg } = await open(device, params);
        for (const sel of taps) {
          await tg.tap(sel);
          await tg.advance(0.5);
        }
        if (taps.length) expect(openModalsOf().length, `${device} ${state}`).toBe(1);
        expectClean(tg, `${device} ${state}`);
        if (shots) await tg.screenshot(`.shots/archer-menu-${state}-${device}.png`);
        tg.destroy();
        t = null;
      }
    }
  });

  it('keeps the idle enemy, the score band and the zone free on every device', async () => {
    for (const device of DEVICES) {
      const { t: tg, scene } = await open(device);
      const g = tg.game;
      const lay = screenLayout(g.view, g.safe);
      const geo = menuGeometry(g.view, g.safe, lay.zone, lay.hudBottom);
      const zoneRight = lay.zone.x + lay.zone.w;
      const zones = keepClearZones(g.stage, g);
      expect(zones.map((z) => z.name).sort(), device).toEqual(['Node#keep-clear-enemy', 'Node#keep-clear-player']);
      expect(offBy(zones.find((z) => z.node?.id === 'keep-clear-enemy')!.rect, geo.enemy), device).toBeLessThan(0.01);
      expect(offBy(zones.find((z) => z.node?.id === 'keep-clear-player')!.rect, geo.player), device).toBeLessThan(0.01);
      const hits = covers(tg);
      expect(hits, `${device}\n${formatLint(hits)}`).toHaveLength(0);
      for (const sel of ['#menu-upgrades', '#arrow-list', '#slots-header', '#menu-settings', '#menu-leaderboard']) {
        const b = tg.get(sel).worldBounds();
        expect(b.x, `${device} ${sel} in the zone`).toBeGreaterThanOrEqual(zoneRight);
        expect(b.x + b.w, `${device} ${sel} off the safe area`).toBeLessThanOrEqual(g.safe.x + g.safe.w);
        expect(b.y + b.h, `${device} ${sel} off the safe area`).toBeLessThanOrEqual(g.safe.y + g.safe.h);
      }
      expect(tg.get('#slots-header').worldBounds().y).toBeGreaterThanOrEqual(g.safe.y + 70);
      expect(tg.get('#menu-zone').worldBounds().x + tg.get('#menu-zone').worldBounds().w).toBeLessThanOrEqual(zoneRight);
      const controls: Node[] = [];
      scene.menu.root.walk((n) => void (n.interactive && n.id !== 'menu-ad' && n.id !== 'arrow-list' && controls.push(n)));
      expect(controls.length).toBeGreaterThan(8 + 10);
      for (const n of controls) {
        expect(hitRect(n).x, `${device} ${n.id} hit area reaches into the zone`).toBeGreaterThanOrEqual(zoneRight);
      }
      expect(tg.get('#arrow-list').worldBounds().x).toBeGreaterThanOrEqual(zoneRight);
      const ad = tg.get('#menu-ad').worldBounds();
      expect(ad.y).toBeGreaterThanOrEqual(lay.hudBottom);
      expect(inside(lay.zone, ad.x, ad.y)).toBe(true);
      tg.destroy();
      t = null;
    }
  });

  it('a menu button moved onto the idle enemy is a covers-keep-clear error', async () => {
    const { t: tg } = await open();
    const g = tg.game;
    const lay = screenLayout(g.view, g.safe);
    const { enemy } = menuGeometry(g.view, g.safe, lay.zone, lay.hudBottom);
    const btn = tg.get('#menu-settings');
    const p = convertPoint(null, btn.parent, enemy.x + (enemy.w - btn.width) / 2, enemy.y + (enemy.h - btn.height) / 2);
    setUILayout(btn, { left: p.x, top: p.y });
    await tg.step(1);
    const c = btn.worldCenter();
    expect(inside(enemy, c.x, c.y)).toBe(true);
    const hits = covers(tg);
    expect(hits.map((i) => `${i.severity} ${i.node.id} ${i.other?.id}`)).toEqual(['error menu-settings keep-clear-enemy']);
    expect(formatLint(hits)).toMatch(/covers keep-clear Node#keep-clear-enemy/);
  });

  it('taps inside the zone (away from +100) hit no menu node', async () => {
    for (const device of DEVICES) {
      const { t: tg, scene } = await open(device);
      const root = scene.menu.root;
      const { zone } = screenLayout(tg.game.view, tg.game.safe);
      const adBtn = tg.get('#menu-ad');
      const ad = hitRect(adBtn);
      let probes = 0;
      for (let x = zone.x + 3; x < zone.x + zone.w; x += 19) {
        for (let y = zone.y + 3; y < zone.y + zone.h; y += 19) {
          if (inside(ad, x, y)) continue;
          const hit = tg.game.hitTest(x, y);
          expect(hit && (hit === root || hit.isDescendantOf(root)) ? hit.kind + '#' + hit.id : null, `${device} ${x},${y}`).toBeNull();
          probes++;
        }
      }
      expect(probes).toBeGreaterThan(300);
      const c = adBtn.worldCenter();
      expect(tg.game.hitTest(c.x, c.y)).toBe(adBtn);
      tg.destroy();
      t = null;
    }
  });
});

describe('start menu behaviour', () => {
  it('buying deducts skulls and updates the row', async () => {
    const { t: tg, scene } = await open();
    await tg.tap('#buy-hp');
    expect(archerSave().data.skulls).toBe(START_SKULLS - upgradeCost('hp', 0));
    expect(archerSave().data.levels.hp).toBe(1);
    expect(text(tg, '#price-hp')).toBe(String(upgradeCost('hp', 1)));
    expect(text(tg, '#bonus-hp')).toBe('+25');
    expect(tg.played()).toContain('buy');
    expect(scene.changes).toBe(1);
    expect(text(tg, '#hud-skulls')).toBe(String(START_SKULLS - 10));
    await tg.tap('#buy-slots');
    expect(text(tg, '#slots-header')).toBe('箭矢槽 1/3');
    expect(text(tg, '#price-slots')).toBe(String(upgradeCost('slots', 1)));
  });

  it('a poor purchase denies, shakes and toasts', async () => {
    const { t: tg, scene } = await open('iphone-se-land', { skulls: 5 });
    await tg.tap('#buy-armor');
    await tg.advance(0.1);
    expect(toasts(tg)).toContain('骷髅币不足');
    expect(tg.played()).toContain('deny');
    expect(archerSave().data.levels.armor).toBe(0);
    expect(archerSave().data.skulls).toBe(5);
    expect(scene.changes).toBe(0);
  });

  it('refresh() re-reads the save; maxed rows show 已满', async () => {
    const { t: tg, scene } = await open();
    archerSave().set({ skulls: 999, levels: { ...NO_UPGRADES, lives: 3, damage: 2 } });
    scene.menu.refresh();
    await tg.step(1);
    expect(text(tg, '#price-lives')).toBe('已满');
    expect(text(tg, '#bonus-lives')).toBe('+3');
    expect(text(tg, '#price-damage')).toBe(String(upgradeCost('damage', 2)));
    await tg.tap('#buy-lives');
    await tg.advance(0.1);
    expect(toasts(tg)).toContain('已满级');
    expect(archerSave().data.skulls).toBe(999);
  });

  it('owned cards equip, unequip and refuse when the slots are full', async () => {
    const { t: tg, scene } = await open('iphone-se-land', { skulls: 5000 });
    unlockArrow('electric');
    unlockArrow('poison');
    scene.menu.refresh();
    await tg.step(1);
    expect(text(tg, '#slots-header')).toBe('箭矢槽 2/2');
    await tg.tap('#arrow-poison');
    await tg.advance(0.1);
    expect(toasts(tg)).toContain('箭矢槽已满，可在升级中增加');
    expect(tg.played()).toContain('deny');
    expect(equippedArrows()).toEqual(['normal', 'electric']);
    await tg.tap('#arrow-electric');
    expect(equippedArrows()).toEqual(['normal']);
    expect(text(tg, '#slots-header')).toBe('箭矢槽 1/2');
    expect(tg.played()).toContain('equip');
    await tg.tap('#arrow-poison');
    expect(equippedArrows()).toEqual(['normal', 'poison']);
    await tg.tap('#arrow-normal');
    await tg.tap('#arrow-poison');
    await tg.advance(0.1);
    expect(equippedArrows()).toEqual(['poison']);
    expect(toasts(tg)).toContain('至少要装备一种箭矢');
    expect(scene.changes).toBe(3);
  });

  it('a locked card opens a dialog that unlocks the arrow', async () => {
    const { t: tg, scene } = await open();
    await tg.tap('#arrow-electric');
    await tg.advance(0.4);
    expect(openModalsOf().length).toBe(1);
    expect(tg.find('Dialog[title=电击箭]')).toBeTruthy();
    expect(text(tg, '#arrow-desc')).toBe(arrowDef('electric').desc);
    expect(tg.find('#arrow-trial')).toBeNull();
    await tg.tap('#arrow-unlock');
    await tg.advance(0.4);
    expect(openModalsOf().length).toBe(0);
    expect(isOwned('electric')).toBe(true);
    expect(equippedArrows()).toEqual(['normal', 'electric']);
    expect(archerSave().data.skulls).toBe(START_SKULLS - arrowDef('electric').cost);
    expect(tg.played()).toContain('buy');
    expect(scene.changes).toBe(1);
    expect(text(tg, '#slots-header')).toBe('箭矢槽 2/2');
  });

  it('unlocking without enough skulls keeps the dialog open', async () => {
    const { t: tg } = await open('iphone-se-land', { skulls: 20 });
    (tg.get('#arrow-list') as ScrollView).scrollIntoView(tg.get('#arrow-missile'), false);
    await tg.step(1);
    await tg.tap('#arrow-missile');
    await tg.advance(0.4);
    await tg.tap('#arrow-unlock');
    await tg.advance(0.2);
    expect(openModalsOf().length).toBe(1);
    expect(toasts(tg)).toContain('骷髅币不足');
    expect(isOwned('missile')).toBe(false);
  });

  it('a trial arrow can be lent for one run through a (simulated) rewarded ad', async () => {
    const { t: tg, scene } = await open();
    expect(text(tg, '#trial-tag-split')).toBe('单次\n体验');
    await tg.tap('#arrow-split');
    await tg.advance(0.4);
    await tg.tap('#arrow-trial');
    await tg.advance(0.5);
    expect(tg.platform.ads.calls.some((c) => c.startsWith('rewarded'))).toBe(true);
    expect(hasTrial('split')).toBe(true);
    expect(isOwned('split')).toBe(false);
    expect(loadout()).toEqual(['normal', 'split']);
    expect(text(tg, '#trial-tag-split')).toBe('本局\n可用');
    expect(scene.changes).toBe(1);
    await tg.tap('#arrow-split');
    await tg.advance(0.4);
    expect(tg.find('#arrow-trial')).toBeNull();
  });

  it('a skipped trial ad lends nothing', async () => {
    const { t: tg, scene } = await open();
    tg.platform.ads.rewardedResult = false;
    (tg.get('#arrow-list') as ScrollView).scrollIntoView(tg.get('#arrow-vampire'), false);
    await tg.step(1);
    await tg.tap('#arrow-vampire');
    await tg.advance(0.4);
    await tg.tap('#arrow-trial');
    await tg.advance(0.5);
    expect(hasTrial('vampire')).toBe(false);
    expect(toasts(tg)).toContain('广告未看完，无法体验');
    expect(scene.changes).toBe(0);
  });

  it('+100 grants skulls through a rewarded ad and hides without ads', async () => {
    const { t: tg, scene } = await open();
    await tg.tap('#menu-ad');
    await tg.advance(0.2);
    expect(archerSave().data.skulls).toBe(START_SKULLS + AD_SKULLS);
    expect(tg.platform.storage.get('archer')).toContain(`"skulls":${START_SKULLS + AD_SKULLS}`);
    expect(scene.changes).toBe(1);
    expect(tg.played()).toContain('coin');
    const ad = scene.menu.root.find('#menu-ad')!;
    expect(ad.visible).toBe(true);
    (tg.platform as unknown as { ads: unknown }).ads = null;
    await tg.step(1);
    expect(ad.visible).toBe(false);
  });

  it('settings toggles the sound channels', async () => {
    const { t: tg } = await open();
    await tg.tap('#menu-settings');
    await tg.advance(0.4);
    expect(tg.find('Modal[title=设置]')).toBeTruthy();
    expect(isAudioMuted('sfx')).toBe(false);
    await tg.tap('#sfx-toggle');
    expect(isAudioMuted('sfx')).toBe(true);
    await tg.tap('#music-toggle');
    expect(isAudioMuted('music')).toBe(true);
  });

  it('the leaderboard lists the saved runs, or an empty state', async () => {
    const { t: tg } = await open();
    await tg.tap('#menu-leaderboard');
    await tg.advance(0.4);
    expect(text(tg, '#board-empty')).toBe('还没有记录，快去战斗吧');
    tg.destroy();
    const { t: t2 } = await open('iphone-se-land', { demo: true });
    await t2.tap('#menu-leaderboard');
    await t2.advance(0.4);
    const runs = archerSave().data.runs;
    expect(t2.findAll('Row').filter((n) => n.id?.startsWith('run-'))).toHaveLength(runs.length);
    expect(t2.get('#run-0').findAll('Label').map((n) => String(n.describe().text))).toContain(String(runs[0]!.score));
  });

  it('close() fades the menu out and destroys it (and its dialogs)', async () => {
    const { t: tg, scene } = await open();
    await tg.tap('#menu-settings');
    await tg.advance(0.4);
    const root = scene.menu.root;
    scene.menu.close();
    await tg.advance(0.1);
    expect(root.destroyed).toBe(false);
    expect(root.alpha).toBeLessThan(1);
    await tg.advance(0.3);
    expect(root.destroyed).toBe(true);
    expect(tg.find('#menu')).toBeNull();
    expect(openModalsOf().length).toBe(0);
    scene.menu.refresh();
    scene.menu.close();
  });
});
