import { describe, expect, it } from 'vitest';
import {
  aabbCircleOverlap,
  ArcadeBody,
  PhysicsWorld,
  raycastGrid,
  Rng,
  segmentVsCircle,
  segmentVsRect,
  SpatialHash,
  TileMap,
  type ArcadeCollision,
} from '@engine';

const TILE = 32;

function box(rows: string[]): TileMap {
  return TileMap.fromAscii(rows, { '#': { id: 1, solid: true }, '.': 0, '-': { id: 2, oneWay: true } }, TILE);
}

describe('body-body collision', () => {
  it('separates overlapping AABBs by mass and reports the contact', () => {
    const w = new PhysicsWorld();
    const a = w.add({ id: 'a', x: 100, y: 100, width: 40, height: 40 });
    const b = w.add({ id: 'b', x: 130, y: 105, width: 40, height: 40, mass: 3 });
    const hits: ArcadeCollision[] = [];
    w.on('collide', (c) => hits.push(c));
    w.step();
    expect(b.left - a.right).toBeGreaterThanOrEqual(-1e-9);
    expect(100 - a.x).toBeCloseTo(7.5);
    expect(b.x - 130).toBeCloseTo(2.5);
    expect(hits).toHaveLength(1);
    expect([hits[0]!.nx, hits[0]!.ny]).toEqual([1, 0]);
    expect(a.touching.right && b.touching.left).toBe(true);
  });

  it('separates circles along the center line and bounces off immovable boxes', () => {
    const w = new PhysicsWorld();
    const a = w.add({ x: 0, y: 0, radius: 10 });
    const b = w.add({ x: 12, y: 9, radius: 10 });
    w.step();
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(20);
    expect((b.y - a.y) / (b.x - a.x)).toBeCloseTo(9 / 12);

    const g = new PhysicsWorld();
    g.add({ x: 0, y: 100, width: 400, height: 20, immovable: true });
    const ball = g.add({ x: 0, y: 80, radius: 12, vy: 600, bounce: 0.5 });
    g.step();
    expect(ball.y + 12).toBeLessThanOrEqual(90 + 1e-9);
    expect(ball.vy).toBeCloseTo(-300);
    expect(ball.touching.down).toBe(true);
  });

  it('ignores pairs whose layers and masks do not match; sensors only overlap', () => {
    const w = new PhysicsWorld();
    const a = w.add({ x: 0, y: 0, width: 20, height: 20, layer: 1, mask: 1 });
    const b = w.add({ x: 5, y: 0, width: 20, height: 20, layer: 2, mask: 2 });
    let overlaps = 0;
    const s = w.add({ x: 0, y: 0, width: 50, height: 50, sensor: true, layer: 1 | 2 });
    s.onOverlap = () => overlaps++;
    w.step();
    expect(a.x).toBe(0);
    expect(b.x).toBe(5);
    expect(s.x).toBe(0);
    expect(overlaps).toBe(2);
  });

  it('lets callbacks remove (and re-add) bodies mid-step without corrupting the step', () => {
    const w = new PhysicsWorld();
    const coins = [90, 100, 110].map((x) => w.add({ x, y: 100, radius: 10, sensor: true, immovable: true }));
    const hero = w.add({ x: 100, y: 100, width: 40, height: 40 });
    let got = 0;
    hero.onOverlap = (other) => {
      got++;
      w.remove(other);
      expect(w.queryPoint(other.x, other.y)).not.toContain(other);
    };
    w.update(1 / 60);
    expect(got).toBe(coins.length);
    expect(w.bodies).toEqual([hero]);
    expect([hero.x, hero.y]).toEqual([100, 100]);
    expect(hero.touching).toEqual({ up: false, down: false, left: false, right: false });
    const c = w.add({ x: 100, y: 100, radius: 5, sensor: true });
    hero.onOverlap = (other) => {
      w.remove(other);
      w.add(other);
    };
    w.update(1 / 60);
    expect(w.bodies.filter((b) => b === c)).toHaveLength(1);
    expect(c.world).toBe(w);
  });
});

describe('tilemap collision', () => {
  const rows = ['####################', '#..................#', '#..........#.......#', '#..........#.......#', '####################'];

  it('never tunnels through a one-tile wall at very high speed (fixed step)', () => {
    const w = new PhysicsWorld();
    w.addTileMap(box(rows));
    const b = w.add({ x: 60, y: 2.5 * TILE, width: 20, height: 20, vx: 30000 });
    w.update(1 / 60);
    expect(b.right).toBeCloseTo(11 * TILE);
    expect(b.blocked.right).toBe(true);
    expect(b.vx).toBe(0);
    b.ax = 1e6;
    for (let i = 0; i < 10; i++) w.update(1 / 60);
    expect(b.right).toBeCloseTo(11 * TILE);
    const c = w.add({ x: 13 * TILE, y: 2.5 * TILE, radius: 10, vx: -50000 });
    for (let i = 0; i < 5; i++) w.step();
    expect(c.left).toBeCloseTo(12 * TILE);
  });

  it('lands on the floor under gravity and reports ground contact every step', () => {
    const w = new PhysicsWorld({ gravity: 2000 });
    w.addTileMap(box(rows));
    const b = w.add({ x: 100, y: 60, width: 20, height: 30 });
    let landed = 0;
    for (let i = 0; i < 90; i++) {
      w.step();
      if (b.justLanded) landed++;
    }
    expect(b.bottom).toBeCloseTo(4 * TILE);
    expect(b.onGround).toBe(true);
    expect(b.vy).toBe(0);
    expect(landed).toBe(1);
  });

  it('passes up through one-way platforms and lands on them', () => {
    const w = new PhysicsWorld({ gravity: 1500 });
    w.addTileMap(box(['########', '#......#', '#......#', '#.----.#', '#......#', '#......#', '########']));
    const b = w.add({ x: 3 * TILE, y: 5.5 * TILE, width: 20, height: 20, vy: -1100 });
    let minY = Infinity;
    for (let i = 0; i < 120; i++) {
      w.step();
      minY = Math.min(minY, b.y);
    }
    expect(minY).toBeLessThan(3 * TILE);
    expect(b.bottom).toBeCloseTo(3 * TILE);
    expect(b.onGround).toBe(true);
    b.dropThrough = true;
    for (let i = 0; i < 60; i++) w.step();
    expect(b.bottom).toBeCloseTo(6 * TILE);
  });

  it('slides along walls (per-axis resolution)', () => {
    const w = new PhysicsWorld();
    w.addTileMap(box(rows));
    const b = w.add({ x: 10 * TILE - 11, y: 1.5 * TILE, width: 20, height: 20, vx: 300, vy: 300 });
    for (let i = 0; i < 20; i++) w.step();
    expect(b.right).toBeCloseTo(11 * TILE);
    expect(b.bottom).toBeCloseTo(4 * TILE);
  });
});

describe('queries and raycasts', () => {
  it('segment vs rect / circle', () => {
    const h = segmentVsRect(0, 5, 100, 5, { x: 40, y: 0, w: 10, h: 10 })!;
    expect(h.t).toBeCloseTo(0.4);
    expect([h.nx, h.ny]).toEqual([-1, 0]);
    expect(segmentVsRect(0, 20, 100, 20, { x: 40, y: 0, w: 10, h: 10 })).toBeNull();
    const up = segmentVsRect(45, 100, 45, 0, { x: 40, y: 0, w: 10, h: 10 })!;
    expect([up.y, up.nx, up.ny]).toEqual([10, 0, 1]);
    const c = segmentVsCircle(0, 0, 100, 0, 50, 0, 10)!;
    expect(c.x).toBeCloseTo(40);
    expect(c.nx).toBeCloseTo(-1);
    expect(segmentVsCircle(0, 30, 100, 30, 50, 0, 10)).toBeNull();
    expect(aabbCircleOverlap(0, 0, 10, 10, 18, 0, 10)!.depth).toBeCloseTo(2);
  });

  it('grid DDA raycast visits cells in order and hits the first solid one', () => {
    const solid = new Set(['3,0', '2,2']);
    const hit = raycastGrid((x, y) => solid.has(`${x},${y}`), 5, 5, 95, 5, 10)!;
    expect([hit.tx, hit.ty, hit.nx, hit.ny]).toEqual([3, 0, -1, 0]);
    expect(hit.x).toBeCloseTo(30);
    const diag = raycastGrid((x, y) => solid.has(`${x},${y}`), 5, 5, 35, 35, 10)!;
    expect([diag.tx, diag.ty]).toEqual([2, 2]);
    expect(raycastGrid(() => false, 0, 0, 100, 37, 10)).toBeNull();
  });

  it('world raycast returns the nearest of tiles and bodies; overlap queries filter exactly', () => {
    const w = new PhysicsWorld();
    w.addTileMap(box(['##########', '#........#', '##########']));
    const target = w.add({ id: 't', x: 5 * TILE, y: 1.5 * TILE, width: 16, height: 16, layer: 2 });
    const hit = w.raycast(40, 1.5 * TILE, 400, 1.5 * TILE)!;
    expect(hit.body).toBe(target);
    expect(hit.distance).toBeCloseTo(5 * TILE - 8 - 40);
    const miss = w.raycast(40, 1.5 * TILE, 400, 1.5 * TILE, { mask: 1 })!;
    expect(miss.body).toBeNull();
    expect(miss.map).not.toBeNull();
    expect(miss.x).toBeCloseTo(9 * TILE);
    w.add({ id: 'c', x: 100, y: 48, radius: 10 });
    expect(w.queryPoint(5 * TILE + 7, 48).map((b) => b.id)).toEqual(['t']);
    expect(w.queryPoint(5 * TILE + 9, 48)).toEqual([]);
    expect(w.queryCircle(100, 70, 12).map((b) => b.id)).toEqual(['c']);
    expect(w.queryRect({ x: 0, y: 0, w: 400, h: 100 }, 2).map((b) => b.id)).toEqual(['t']);
  });

  it('spatial hash buckets, updates and dedupes', () => {
    const h = new SpatialHash<string>(10);
    h.insert('a', { x: 0, y: 0, w: 25, h: 5 });
    h.insert('b', { x: 50, y: 50, w: 1, h: 1 });
    expect(h.query({ x: 0, y: 0, w: 30, h: 30 })).toEqual(['a']);
    h.update('b', { x: 15, y: 0, w: 1, h: 1 });
    expect(h.query({ x: 12, y: 1, w: 5, h: 5 })).toEqual(['a', 'b']);
    h.remove('a');
    expect(h.queryPoint(1, 1)).toEqual([]);
    expect(h.size).toBe(1);
  });
});

describe('determinism', () => {
  const run = () => {
    const rng = new Rng(99);
    const w = new PhysicsWorld({ gravity: 900 });
    w.addTileMap(box(['############', '#..........#', '#..........#', '#....--....#', '#..........#', '#..........#', '############']));
    for (let i = 0; i < 25; i++) {
      const circle = rng.chance(0.5);
      w.add(
        new ArcadeBody({
          id: `b${i}`,
          x: rng.float(50, 330),
          y: rng.float(40, 180),
          vx: rng.float(-400, 400),
          vy: rng.float(-400, 400),
          bounce: rng.float(0, 0.8),
          ...(circle ? { radius: rng.float(5, 10) } : { width: rng.float(8, 20), height: rng.float(8, 20) }),
        }),
      );
    }
    for (let i = 0; i < 240; i++) w.update(1 / 60);
    return w.dump();
  };

  it('produces identical results for identical inputs', () => {
    const a = run();
    expect(run()).toBe(a);
    expect(a).toContain('steps=240 bodies=25');
  });
});
