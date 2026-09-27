import { bakeTexture, textures, textureStats, texturePixels, type Ctx2D, type Texture } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APPLES, ARROWS, COLORS, type ArrowId } from '../config';
import app from '../main';
import { BODY, J, JOINT_COUNT, type FighterView, type PlatformView, type StuckArrowView, type Vec } from '../types';
import { ARMOR_COLORS } from './fighter';
import {
  ARROW_CARD_H,
  ARROW_CARD_W,
  ART_KEYS,
  armorTier,
  bakeArcherArt,
  drawApple,
  drawArrow,
  drawBackdrop,
  drawExplosion,
  drawFighter,
  drawHpBar,
  drawLightning,
  drawPlatform,
  drawStuckArrow,
  nockDistance,
  setArtTime,
} from './index';

let t: TestGame;

beforeAll(async () => {
  t = await createTestGame({ app, scene: 'gallery', device: '1623x750@1' });
});

afterAll(() => t.destroy());

const ARROW_IDS: readonly ArrowId[] = ARROWS.map((a) => a.id);

/** Standing skeleton with the pelvis at (x, y), bow arm stretched toward `facing`; `collapsed` puts every joint on one spot. */
function skeleton(x: number, y: number, facing: 1 | -1, s = 1, collapsed = false): Vec[] {
  const j: Vec[] = [];
  for (let i = 0; i < JOINT_COUNT; i++) j.push({ x, y });
  if (collapsed) return j;
  const at = (dx: number, dy: number): Vec => ({ x: x + facing * dx * s, y: y + dy * s });
  j[J.neck] = at(0, -BODY.torso);
  j[J.head] = at(0, -BODY.torso - BODY.neck);
  j[J.elbowF] = at(BODY.upperArm, -BODY.torso);
  j[J.handF] = at(BODY.upperArm + BODY.foreArm, -BODY.torso);
  j[J.elbowB] = at(-22, -BODY.torso + 12);
  j[J.handB] = at(0, -BODY.torso);
  j[J.kneeF] = at(8, BODY.thigh);
  j[J.footF] = at(12, BODY.thigh + BODY.shin);
  j[J.kneeB] = at(-8, BODY.thigh);
  j[J.footB] = at(-12, BODY.thigh + BODY.shin);
  return j;
}

function everyStuck(x: number, y: number): StuckArrowView[] {
  return ARROW_IDS.map((type, i) => ({ type, x: x + i, y: y - 40 + i * 4, angle: Math.PI + (i - 5) * 0.2 }));
}

function fighterView(over: Partial<FighterView> & { facing: 1 | -1 }): FighterView {
  const scale = over.scale ?? 1;
  return {
    id: 1,
    side: over.facing === 1 ? 'player' : 'enemy',
    scale,
    joints: skeleton(200, 200, over.facing, scale),
    aimAngle: over.facing === 1 ? 0 : Math.PI,
    draw: 0,
    nocked: 'normal',
    hp: 60,
    maxHp: 100,
    alive: true,
    boss: false,
    armor: 0,
    stuck: [],
    poison: 0,
    stun: 0,
    balloons: 0,
    flash: 0,
    ...over,
  };
}

/** Armor points covering every gear tier (none, helmet, + chest plate, visor + shoulder guards). */
const ARMOR_LEVELS = [0, 1, 3, 6, 10] as const;

/** Every fighter variant the battle can produce: all arrows nocked, all effects, all armor tiers, both facings, dead, boss, collapsed. */
function fighterVariants(): FighterView[] {
  const out: FighterView[] = [];
  for (const facing of [1, -1] as const) {
    ARROW_IDS.forEach((nocked, i) => {
      const draw = (i % 3) / 2;
      const armor = ARMOR_LEVELS[i % ARMOR_LEVELS.length]!;
      out.push(fighterView({ facing, nocked, draw, armor, aimAngle: (facing === 1 ? 0 : Math.PI) + (i - 5) * 0.25 }));
      out.push(
        fighterView({
          facing,
          nocked,
          draw,
          boss: i % 2 === 0,
          scale: i % 2 === 0 ? 1.6 : 1,
          side: 'enemy',
          armor: ARMOR_LEVELS[(i + 2) % ARMOR_LEVELS.length]!,
          stuck: everyStuck(200, 200),
          poison: 3,
          stun: 1,
          balloons: 1 + (i % 6),
          flash: 0.3 + (i % 3) * 0.3,
        }),
      );
    });
    out.push(fighterView({ facing, alive: false, nocked: null, hp: 0, balloons: 2, stuck: everyStuck(200, 200) }));
    out.push(fighterView({ facing, alive: false, nocked: null, hp: 0, armor: 8, stuck: everyStuck(200, 200) }));
    out.push(fighterView({ facing, side: 'enemy', hp: 250, maxHp: 0, boss: true }));
    out.push(fighterView({ facing, side: 'enemy', scale: 1.6, boss: true, armor: 10, poison: 2, flash: 0.8 }));
    out.push(fighterView({ facing, joints: skeleton(200, 200, facing, 1, true), draw: 1, poison: 1, stun: 1, balloons: 3, boss: true }));
    out.push(fighterView({ facing, joints: skeleton(200, 200, facing, 1, true), alive: false, nocked: null, flash: 1 }));
    out.push(fighterView({ facing, joints: skeleton(200, 200, facing, 1, true), alive: false, nocked: null, armor: 7, boss: true }));
  }
  return out;
}

const PLATFORMS: readonly PlatformView[] = [
  { id: 1, kind: 'tower', x: 150, y: 400, w: 220, h: 600, angle: 0, stuck: everyStuck(260, 200) },
  { id: 2, kind: 'tower', x: 150, y: 400, w: 90, h: 30, angle: 0.3, stuck: [] },
  { id: 3, kind: 'block', x: 200, y: 200, w: 120, h: 120, angle: Math.PI / 4, stuck: everyStuck(140, 250) },
  { id: 4, kind: 'block', x: 200, y: 200, w: 80, h: 140, angle: -2.1, stuck: [] },
];

/** Runs every painter over every variant once. */
function paintEverything(ctx: Ctx2D, time: number): void {
  setArtTime(time);
  drawBackdrop(ctx, 400, 300, time);
  drawBackdrop(ctx, 1623, 750, time);
  for (const f of fighterVariants()) {
    drawFighter(ctx, f);
    drawHpBar(ctx, f);
  }
  ARROW_IDS.forEach((type, i) => {
    for (const angle of [0, 0.7, Math.PI / 2, 2.4, Math.PI, -Math.PI / 2, -2.8]) {
      drawArrow(ctx, type, 200, 150, angle);
      drawArrow(ctx, type, 200, 150, angle, 2.5);
      drawStuckArrow(ctx, type, 200, 150, angle + i);
    }
  });
  for (const p of PLATFORMS) drawPlatform(ctx, p);
  for (const a of APPLES) {
    drawApple(ctx, a.kind, 100, 100, 22, 0.4);
    drawApple(ctx, a.kind, 100, 100, 4, -1);
  }
  for (const pr of [-0.2, 0, 0.1, 0.32, 0.5, 0.62, 0.9, 1, 1.4]) drawExplosion(ctx, 200, 150, 80, pr);
  drawLightning(ctx, 10, 10, 300, 40, 7);
  drawLightning(ctx, 50, 50, 50, 50, 3);
  drawLightning(ctx, 50, 50, 58, 52, -4);
}

function bake(w: number, h: number, draw: (ctx: Ctx2D) => void): Texture {
  return bakeTexture(w, h, draw, { resolution: 1 });
}

/** Pixels matching an RGB colour within tol, split into the halves left and right of x = split. */
function countColor(tex: Texture, hex: string, split: number, tol = 40): { left: number; right: number } {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const { data, width, height } = texturePixels(tex);
  const out = { left: 0, right: 0 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3]! < 200) continue;
      if (Math.abs(data[i]! - r) + Math.abs(data[i + 1]! - g) + Math.abs(data[i + 2]! - b) > tol) continue;
      if (x < split) out.left++;
      else out.right++;
    }
  }
  return out;
}

/** Opaque pixels of armor steel (lit metal or shaded plates), split left and right of x = split. */
function steel(tex: Texture, split = 200): { left: number; right: number; total: number } {
  const m = countColor(tex, ARMOR_COLORS.metal, split, 30);
  const s = countColor(tex, ARMOR_COLORS.shade, split, 30);
  return { left: m.left + s.left, right: m.right + s.right, total: m.left + m.right + s.left + s.right };
}

/** Topmost row with an opaque pixel of an RGB colour (within tol), or Infinity. */
function colorTop(tex: Texture, hex: string, tol = 30): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const { data, width, height } = texturePixels(tex);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3]! < 200) continue;
      if (Math.abs(data[i]! - r) + Math.abs(data[i + 1]! - g) + Math.abs(data[i + 2]! - b) <= tol) return y;
    }
  }
  return Infinity;
}

/** Bounding box of opaque pixels in logical units. */
function inkBox(tex: Texture): { x0: number; x1: number; y0: number; y1: number } {
  const { data, width, height } = texturePixels(tex);
  const k = width / tex.width;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! < 128) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  return { x0: x0 / k, x1: x1 / k, y0: y0 / k, y1: y1 / k };
}

describe('bakeArcherArt', () => {
  const sized: [string, number, number][] = [
    [ART_KEYS.skull, 48, 48],
    [ART_KEYS.lock, 48, 48],
    [ART_KEYS.film, 48, 48],
    [ART_KEYS.gear, 48, 48],
    [ART_KEYS.podium, 64, 64],
    ...APPLES.map((a): [string, number, number] => [ART_KEYS.apple(a.kind), 64, 64]),
    ...ARROWS.map((a): [string, number, number] => [ART_KEYS.arrow(a.id), ARROW_CARD_W, ARROW_CARD_H]),
  ];

  it('card size constants match the contract', () => {
    expect(ARROW_CARD_W).toBe(300);
    expect(ARROW_CARD_H).toBe(56);
  });

  it.each(sized)('registers %s at %i x %i with visible ink', (key, w, h) => {
    bakeArcherArt();
    expect(textures.has(key)).toBe(true);
    const tex = textures.get(key);
    expect(tex.width).toBeGreaterThanOrEqual(w);
    expect(tex.width).toBeLessThan(w + 1);
    expect(tex.height).toBeGreaterThanOrEqual(h);
    expect(tex.height).toBeLessThan(h + 1);
    const box = inkBox(tex);
    expect(box.x1 - box.x0).toBeGreaterThan(w * 0.4);
  });

  it.each(ARROW_IDS)('card %s lies horizontally with its tip on the left', (id) => {
    const tex = textures.get(ART_KEYS.arrow(id));
    const box = inkBox(tex);
    expect(box.x0).toBeLessThan(ARROW_CARD_W * 0.08);
    expect(box.x1).toBeGreaterThan(ARROW_CARD_W * 0.9);
    expect(box.y0).toBeGreaterThan(1);
    expect(box.y1).toBeLessThan(ARROW_CARD_H - 1);
    // the tip (leftmost ink) sits on the centre line
    const { data, width } = texturePixels(tex);
    const k = width / tex.width;
    const col = Math.round(box.x0 * k) + 1;
    let sum = 0;
    let n = 0;
    for (let y = 0; y < ARROW_CARD_H * k; y++) {
      if (data[(y * width + col) * 4 + 3]! >= 128) {
        sum += y / k;
        n++;
      }
    }
    expect(n).toBeGreaterThan(0);
    expect(Math.abs(sum / n - ARROW_CARD_H / 2)).toBeLessThan(6);
  });

  it('can be called again and re-registers every key', () => {
    const before = textures.get(ART_KEYS.skull);
    bakeArcherArt();
    expect(textures.get(ART_KEYS.skull)).not.toBe(before);
    for (const a of ARROWS) expect(textures.has(ART_KEYS.arrow(a.id))).toBe(true);
  });
});

describe('world painters', () => {
  it('run for every arrow type, apple kind, platform kind and fighter variant without throwing or leaking state', () => {
    bake(400, 300, (ctx) => {
      const m0 = ctx.getTransform();
      const check = (what: string) => {
        const m = ctx.getTransform();
        expect([m.a, m.b, m.c, m.d, m.e, m.f], what).toEqual([m0.a, m0.b, m0.c, m0.d, m0.e, m0.f]);
        expect(ctx.globalAlpha, what).toBe(1);
        expect(ctx.globalCompositeOperation, what).toBe('source-over');
      };
      for (const f of fighterVariants()) {
        drawFighter(ctx, f);
        check(`fighter ${f.facing} ${f.nocked} alive=${f.alive}`);
      }
      for (const type of ARROW_IDS) {
        drawArrow(ctx, type, 200, 150, 2.6, 1.6);
        drawStuckArrow(ctx, type, 200, 150, -0.4);
        check(`arrow ${type}`);
      }
      for (const p of PLATFORMS) {
        drawPlatform(ctx, p);
        check(`platform ${p.kind}`);
      }
      for (const a of APPLES) {
        drawApple(ctx, a.kind, 100, 100, 22, 0.4);
        check(`apple ${a.kind}`);
      }
      for (const pr of [0, 0.3, 0.7, 1]) {
        drawExplosion(ctx, 200, 150, 80, pr);
        check(`explosion ${pr}`);
      }
      drawLightning(ctx, 10, 10, 300, 40, 7);
      check('lightning');
      drawBackdrop(ctx, 400, 300, 12.5);
      check('backdrop');
      paintEverything(ctx, 3.3);
      check('everything');
    });
  });

  it('never create textures, however many frames they draw', () => {
    bake(400, 300, (ctx) => {
      const before = textureStats({ top: 0 }).count;
      for (let frame = 0; frame < 20; frame++) paintEverything(ctx, frame / 60);
      expect(textureStats({ top: 0 }).count).toBe(before);
    });
  }, 30_000);

  it('mirror the fighter: the bow is on the facing side', () => {
    for (const facing of [1, -1] as const) {
      const tex = bake(400, 300, (ctx) => drawFighter(ctx, fighterView({ facing, nocked: null })));
      const bow = countColor(tex, COLORS.bow, 200);
      expect(bow.left + bow.right).toBeGreaterThan(50);
      if (facing === 1) expect(bow.right).toBeGreaterThan(bow.left * 5);
      else expect(bow.left).toBeGreaterThan(bow.right * 5);
    }
  });

  it('show an HP bar only on living enemies, filled in proportion to hp', () => {
    // no nocked arrow: the normal arrow's fletching is the same red as the bar
    const red = (f: FighterView) => {
      const c = countColor(
        bake(400, 300, (ctx) => drawFighter(ctx, { ...f, nocked: null })),
        COLORS.hp,
        200,
        30,
      );
      return c.left + c.right;
    };
    const full = red(fighterView({ facing: -1, side: 'enemy', hp: 100 }));
    const half = red(fighterView({ facing: -1, side: 'enemy', hp: 50 }));
    expect(full).toBeGreaterThan(100);
    expect(half).toBeGreaterThan(full * 0.3);
    expect(half).toBeLessThan(full * 0.7);
    expect(red(fighterView({ facing: -1, side: 'enemy', hp: 0 }))).toBe(0);
    expect(red(fighterView({ facing: -1, side: 'enemy', alive: false }))).toBe(0);
    expect(red(fighterView({ facing: 1 }))).toBe(0);
  });

  it('draw arrows with the tip at (x, y) and the shaft behind it', () => {
    for (const type of ARROW_IDS) {
      const box = inkBox(bake(200, 60, (ctx) => drawArrow(ctx, type, 150, 30, 0)));
      expect(box.x1, type).toBeGreaterThan(146);
      expect(box.x1, type).toBeLessThan(152);
      expect(box.x0, type).toBeGreaterThan(150 - BODY.arrowLen - 4);
      expect(box.x0, type).toBeLessThan(150 - BODY.arrowLen + 6);
    }
  });

  it('draw stuck arrows without the buried head', () => {
    for (const type of ARROW_IDS) {
      const box = inkBox(bake(200, 60, (ctx) => drawStuckArrow(ctx, type, 150, 30, 0)));
      expect(box.x1, type).toBeLessThan(146);
    }
  });

  it('draw a deterministic backdrop that drifts with time', () => {
    const at = (time: number) => texturePixels(bake(300, 200, (ctx) => drawBackdrop(ctx, 300, 200, time))).data;
    const a = at(5);
    expect(Buffer.from(at(5)).equals(Buffer.from(a))).toBe(true);
    expect(Buffer.from(at(9)).equals(Buffer.from(a))).toBe(false);
  });

  it('nockDistance grows with the draw and the scale', () => {
    expect(nockDistance(1)).toBeGreaterThan(nockDistance(0));
    expect(nockDistance(1, 1.6)).toBeCloseTo(nockDistance(1) * 1.6, 6);
    expect(nockDistance(2)).toBe(nockDistance(1));
    expect(nockDistance(-1)).toBe(nockDistance(0));
  });
});

describe('armor gear', () => {
  const CROWN = '#f5c542';
  /** No nocked arrow (its grey head is close to steel); facing -1 stays a player unless side says otherwise (no HP bar). */
  const plain = (over: Partial<FighterView> & { facing: 1 | -1 }): FighterView => fighterView({ side: 'player', nocked: null, ...over });
  const shot = (f: FighterView): Texture => bake(400, 300, (ctx) => drawFighter(ctx, f));

  it('maps armor points to the documented tiers', () => {
    expect([0, -1, NaN, 1, 2, 3, 5, 6, 10, 40].map(armorTier)).toEqual([0, 0, 0, 1, 1, 2, 2, 3, 3, 3]);
  });

  it('paints steel only when the fighter has armor', () => {
    for (const facing of [1, -1] as const) {
      expect(steel(shot(plain({ facing, armor: 0 }))).total, `facing ${facing}`).toBe(0);
      expect(steel(shot(plain({ facing, side: 'enemy', alive: false, boss: true, armor: 0 }))).total).toBe(0);
      for (const armor of [1, 3, 6, 10]) {
        expect(steel(shot(plain({ facing, armor }))).total, `facing ${facing} armor ${armor}`).toBeGreaterThan(300);
      }
    }
  });

  it('paints more steel on each higher tier and the same within a tier', () => {
    const at = (armor: number) => steel(shot(plain({ facing: 1, armor }))).total;
    const [t1, t2, t3] = [at(1), at(3), at(6)];
    expect(at(2)).toBe(t1);
    expect(at(5)).toBe(t2);
    expect(at(10)).toBe(t3);
    expect(t2).toBeGreaterThan(t1 * 2);
    expect(t3).toBeGreaterThan(t2 * 1.3);
  });

  it('mirrors the gear with the facing: visor, lit chest half and front shoulder guard lead', () => {
    const r = shot(plain({ facing: 1, armor: 8 }));
    const l = shot(plain({ facing: -1, armor: 8 }));
    const mr = countColor(r, ARMOR_COLORS.metal, 200, 30);
    const ml = countColor(l, ARMOR_COLORS.metal, 200, 30);
    expect(mr.right).toBeGreaterThan(mr.left * 1.5);
    expect(ml.left).toBeGreaterThan(ml.right * 1.5);
    const sr = steel(r);
    const sl = steel(l);
    expect(Math.abs(sr.left - sl.right)).toBeLessThanOrEqual(sr.left * 0.05 + 4);
    expect(Math.abs(sr.right - sl.left)).toBeLessThanOrEqual(sr.right * 0.05 + 4);
  });

  it('scales the gear with bosses and lifts the crown onto the helmet', () => {
    const small = steel(shot(plain({ facing: -1, armor: 8 }))).total;
    const big = steel(shot(plain({ facing: -1, armor: 8, scale: 1.6, boss: true }))).total;
    expect(big / small).toBeGreaterThan(1.6 * 1.6 * 0.8);
    expect(big / small).toBeLessThan(1.6 * 1.6 * 1.2);
    const crownTop = (armor: number) => colorTop(shot(plain({ facing: 1, armor, scale: 1.6, boss: true })), CROWN);
    const bare = crownTop(0);
    expect(bare).toBeLessThan(Infinity);
    expect(crownTop(8)).toBeLessThan(bare - 3);
    expect(crownTop(1)).toBe(crownTop(8));
  });

  it('keeps the hit flash, poison bubbles and stun sparks visible over the gear', () => {
    setArtTime(1.3);
    const cold = steel(shot(plain({ facing: 1, armor: 8 }))).total;
    expect(steel(shot(plain({ facing: 1, armor: 8, flash: 1 }))).total).toBeLessThan(cold * 0.1);
    expect(steel(shot(plain({ facing: 1, armor: 8, poison: 3 }))).total).toBeLessThan(cold * 0.5);
    const bubbles = (armor: number) => {
      const c = countColor(shot(plain({ facing: 1, armor, poison: 3 })), COLORS.poison, 200, 60);
      return c.left + c.right;
    };
    expect(bubbles(8)).toBeGreaterThan(20);
    expect(bubbles(8)).toBeGreaterThan(bubbles(0) * 0.6);
    const sparks = countColor(shot(plain({ facing: 1, armor: 8, stun: 1 })), COLORS.electric, 200, 40);
    expect(sparks.left + sparks.right).toBeGreaterThan(20);
  });
});

describe('gallery scene', () => {
  it('renders the review sheet, the zoom page and the armor page', async () => {
    await t.step(2);
    expect(t.png().length).toBeGreaterThan(0);
    await t.go('gallery', { page: 'zoom' });
    await t.step(2);
    expect(t.png().length).toBeGreaterThan(0);
    await t.go('gallery', { page: 'armor' });
    await t.step(2);
    expect(t.png().length).toBeGreaterThan(0);
    expect(t.findAll('ArtPaint').length).toBeGreaterThan(15);
  });
});
