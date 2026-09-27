import { bakeTexture, texturePixels } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FRUIT_TEX_PAD, FRUITS, fruit } from '../fruits';
import app from '../main';
import { bakeFruitArt, drawFruitFace, FruitNode, fruitTexture, type FruitFace } from './fruit-art';

const RES = 2;
const FACES: readonly FruitFace[] = ['idle', 'blink', 'happy', 'surprised', 'worried'];

let t: TestGame;

beforeAll(async () => {
  // iphone-14 view (750x1623) at 1 px per unit keeps rendered frames cheap
  t = await createTestGame({ app, scene: 'gallery', device: '750x1623@1' });
  bakeFruitArt(RES);
});

afterAll(() => t.destroy());

describe('fruit body textures', () => {
  it.each(FRUITS.map((f) => [f.level, f.key] as const))('level %i (%s) has the padded size', (level) => {
    const size = FRUIT_TEX_PAD * 2 * fruit(level).radius;
    const tex = fruitTexture(level);
    expect(tex.width).toBeGreaterThanOrEqual(size);
    expect(tex.width).toBeLessThanOrEqual(size + 1 / RES);
    expect(tex.height).toBeCloseTo(tex.width, 6);
    expect(fruitTexture(level)).toBe(tex);
  });

  it.each(FRUITS.map((f) => [f.level, f.key] as const))('level %i (%s) fills exactly its circle', (level) => {
    const r = fruit(level).radius;
    const size = FRUIT_TEX_PAD * 2 * r;
    const { data, width } = texturePixels(fruitTexture(level));
    const alpha = (x: number, y: number) => {
      const px = Math.round((size / 2 + x) * RES);
      const py = Math.round((size / 2 + y) * RES);
      return data[(py * width + px) * 4 + 3]!;
    };
    const polar = (angle: number, d: number) => alpha(Math.cos(angle) * d * r, Math.sin(angle) * d * r);
    const mean = (angle: number, d: number) => {
      let sum = 0;
      for (let i = -5; i <= 5; i++) sum += polar(angle + (i * Math.PI) / 90, d);
      return sum / 11;
    };

    expect(alpha(0, 0)).toBe(255);
    // right, bottom, left (stems, leaves and crowns only stick out at the top)
    for (const angle of [0, Math.PI / 2, Math.PI]) {
      expect(mean(angle, 0.96)).toBeGreaterThan(235);
      expect(mean(angle, 1.07)).toBeLessThan(25);
      expect(polar(angle, 1.2)).toBe(0);
    }
  });

  it('rebakes at another resolution and caches again', () => {
    const before = fruitTexture(0);
    bakeFruitArt(1);
    const low = fruitTexture(0);
    expect(low).not.toBe(before);
    expect(texturePixels(low).width).toBe(Math.ceil(FRUIT_TEX_PAD * 2 * fruit(0).radius));
    bakeFruitArt(RES);
    expect(fruitTexture(0)).not.toBe(low);
  });
});

describe('drawFruitFace', () => {
  it('draws every expression on every fruit, small or large', () => {
    const tex = bakeTexture(120, 120, (ctx) => {
      ctx.translate(60, 60);
      for (const f of FRUITS) {
        for (const face of FACES) {
          for (const r of [8, 26, f.radius]) drawFruitFace(ctx, f.level, r, face);
        }
      }
    });
    const { data } = texturePixels(tex);
    let ink = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) ink++;
    expect(ink).toBeGreaterThan(0);
  });
});

describe('FruitNode', () => {
  it('is a Fruit centred on (x, y) with the level radius', () => {
    const n = new FruitNode(3, { x: 100, y: 200 });
    expect(n.kind).toBe('Fruit');
    expect(n.level).toBe(3);
    expect(n.radius).toBe(fruit(3).radius);
    expect(n.width).toBe(2 * fruit(3).radius);
    expect(n.height).toBe(2 * fruit(3).radius);
    expect(n.anchorX).toBe(0.5);
    expect(n.anchorY).toBe(0.5);
    expect(n.x).toBe(100);
    expect(n.y).toBe(200);
  });

  it('radius setter resizes the node', () => {
    const n = new FruitNode(5);
    n.radius = 40;
    expect(n.radius).toBe(40);
    expect(n.width).toBe(80);
    expect(n.height).toBe(80);
    n.radius = -3;
    expect(n.radius).toBe(0);
    expect(n.width).toBe(0);
  });

  it('describe() lists level, fruit key and face', () => {
    const n = new FruitNode(9);
    n.face = 'worried';
    expect(n.describe()).toMatchObject({ level: 9, fruit: 'half-melon', face: 'worried' });
  });

  it('squash wobbles without touching scaleX / scaleY and settles', async () => {
    const n = t.scene!.add(new FruitNode(2, { x: 375, y: 800, rotation: 0.7, scaleX: 1.1, scaleY: 0.9 }));
    n.squash(1.5);
    await t.step(4);
    expect(n.scaleX).toBe(1.1);
    expect(n.scaleY).toBe(0.9);
    for (let i = 0; i < 60; i++) n.tick(1 / 60);
    expect(n.scaleX).toBe(1.1);
    expect(n.scaleY).toBe(0.9);
    expect(n.rotation).toBe(0.7);
    n.destroy();
  });

  it('draws every face and a zero radius without throwing', async () => {
    const nodes = FACES.map((face, i) => {
      const n = t.scene!.add(new FruitNode(i, { x: 100 + i * 120, y: 700 }));
      n.face = face;
      n.squash();
      return n;
    });
    nodes[0]!.radius = 0;
    await t.step(1);
    expect(t.png().length).toBeGreaterThan(0);
    for (const n of nodes) n.destroy();
  });
});

describe('gallery scene', () => {
  it('shows all 11 fruits plus expression, touching and squash rows inside an iphone-14 view', () => {
    const fruits = t.findAll<FruitNode>('Fruit');
    for (const f of FRUITS) expect(fruits.some((n) => n.level === f.level && n.radius === f.radius)).toBe(true);
    for (const face of FACES) expect(t.find(`Fruit[face=${face}]`)).not.toBeNull();
    const view = t.game.view;
    for (const n of fruits) {
      const c = n.worldCenter();
      expect(c.x - n.radius).toBeGreaterThanOrEqual(-1);
      expect(c.x + n.radius).toBeLessThanOrEqual(view.width + 1);
      expect(c.y + n.radius).toBeLessThanOrEqual(view.height);
    }
  });
});
