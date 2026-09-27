import { describe, expect, it } from 'vitest';
import { Rng } from '@engine';
import { FRUITS, JAR_WIDTH, fruit } from './fruits';
import { SuikaModel, type SuikaEvent } from './model';
import { FruitPhysics } from './physics';

const H = 1000;
const run = (p: FruitPhysics, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) p.step(1 / 60);
};

function maxPenetration(p: FruitPhysics): number {
  let worst = 0;
  const bs = p.bodies;
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i]!;
      const b = bs[j]!;
      worst = Math.max(worst, a.r + b.r - Math.hypot(b.x - a.x, b.y - a.y));
    }
  }
  return worst;
}

/** A physics-only pile: random small fruits, levels chosen so neighbours rarely share a level (no merging here). */
function pile(seed: number, count: number): FruitPhysics {
  const p = new FruitPhysics({ width: JAR_WIDTH, height: H });
  const rng = new Rng(seed);
  for (let i = 0; i < count; i++) {
    const level = rng.int(0, 5);
    const r = fruit(level).radius;
    p.add(level, r, rng.float(r, JAR_WIDTH - r), 100 - i * 10);
    run(p, 0.25);
  }
  return p;
}

describe('FruitPhysics', () => {
  it('drops a fruit onto the floor and lets it rest', () => {
    const p = new FruitPhysics({ width: JAR_WIDTH, height: H });
    const b = p.add(3, 60, 300, 100);
    run(p, 2);
    expect(b.y).toBeCloseTo(H - 60, 0);
    expect(Math.abs(b.vy)).toBeLessThan(1);
    expect(b.landed).toBe(true);
  });

  it('stacks a pile stably inside the jar without overlaps or jitter', () => {
    const p = pile(3, 45);
    run(p, 4);
    for (const b of p.bodies) {
      expect(b.x).toBeGreaterThanOrEqual(b.r - 0.5);
      expect(b.x).toBeLessThanOrEqual(JAR_WIDTH - b.r + 0.5);
      expect(b.y).toBeLessThanOrEqual(H - b.r + 0.5);
      expect(Number.isFinite(b.x + b.y + b.vx + b.vy + b.angle)).toBe(true);
    }
    expect(maxPenetration(p)).toBeLessThan(3);
    expect(p.maxSpeedNow()).toBeLessThan(25);
  });

  it('turns sliding into rolling (clockwise when moving right)', () => {
    const p = new FruitPhysics({ width: 4000, height: H });
    const r = 60;
    const b = p.add(3, r, 200, H - r, { vx: 600 });
    run(p, 0.5);
    expect(b.vx).toBeGreaterThan(100);
    expect(b.av).toBeGreaterThan(0);
    expect(b.av * r).toBeCloseTo(b.vx, -1);
    expect(b.angle).toBeGreaterThan(0.5);
  });

  it('grows a merged fruit to its full radius', () => {
    const p = new FruitPhysics({ width: JAR_WIDTH, height: H });
    const b = p.add(5, 92, 300, H - 92, { r: 76 });
    run(p, 0.3);
    expect(b.r).toBe(92);
    expect(b.y).toBeCloseTo(H - 92, 0);
  });

  it('reports touching same-level pairs once each', () => {
    const p = new FruitPhysics({ width: JAR_WIDTH, height: H });
    const a = p.add(0, 26, 300, H - 26);
    const b = p.add(0, 26, 352, H - 26);
    p.add(1, 38, 500, H - 38);
    const { merges } = p.step(1 / 60);
    expect(merges).toHaveLength(1);
    expect(new Set([merges[0]!.a, merges[0]!.b])).toEqual(new Set([a, b]));
  });

  it('is deterministic', () => {
    const snap = (p: FruitPhysics) => p.bodies.map((b) => `${b.x.toFixed(6)},${b.y.toFixed(6)},${b.angle.toFixed(6)}`).join(';');
    expect(snap(pile(9, 20))).toBe(snap(pile(9, 20)));
  });
});

describe('SuikaModel', () => {
  const make = (seed = 1) => new SuikaModel({ width: JAR_WIDTH, height: H, dangerY: 200, seed });

  it('merges two grapes into a cherry and scores it', () => {
    const m = make();
    m.physics.add(0, 26, 300, H - 26);
    m.physics.add(0, 26, 351, H - 26);
    const events = m.step(1 / 60);
    const merge = events.find((e) => e.type === 'merge');
    expect(merge).toMatchObject({ type: 'merge', level: 1, points: FRUITS[1]!.points, combo: 1 });
    expect(m.score).toBe(FRUITS[1]!.points);
    expect(m.physics.bodies.map((b) => b.level)).toEqual([1]);
  });

  it('two watermelons vanish for the bonus', () => {
    const m = make();
    m.physics.add(10, 204, 204, H - 204);
    m.physics.add(10, 204, 612, H - 204);
    const events = m.step(1 / 60);
    expect(events.find((e) => e.type === 'merge')).toMatchObject({ into: null, level: 11 });
    expect(m.physics.bodies).toHaveLength(0);
  });

  it('drops, waits for the cooldown and spawns the next fruit', () => {
    const m = make();
    const first = m.current!;
    const second = m.next;
    m.setAim(100);
    const body = m.drop()!;
    expect(body.level).toBe(first);
    expect(body.x).toBe(100);
    expect(m.canDrop()).toBe(false);
    const events: SuikaEvent[] = [];
    for (let i = 0; i < 40; i++) events.push(...m.step(1 / 60));
    expect(events.find((e) => e.type === 'spawn')).toMatchObject({ level: second });
    expect(m.current).toBe(second);
  });

  it('ends the game when fruits stay above the danger line', () => {
    const m = make();
    for (let i = 0; i < 12; i++) m.physics.add(200 + i, 170, i % 2 ? 180 : 530, H - 170 - i * 170);
    let over: SuikaEvent | undefined;
    const events: SuikaEvent[] = [];
    for (let i = 0; i < 60 * 8 && !over; i++) {
      const ev = m.step(1 / 60);
      events.push(...ev);
      over = ev.find((e) => e.type === 'gameover');
    }
    expect(events.find((e) => e.type === 'danger')).toMatchObject({ on: true });
    expect(over).toBeDefined();
    expect(m.state).toBe('over');
    expect(m.revive().length).toBeGreaterThan(0);
    expect(m.state).toBe('playing');
  });

  it('plays a whole random game without breaking', () => {
    const m = make(42);
    const rng = new Rng(5);
    let merges = 0;
    let t = 0;
    while (m.state === 'playing' && t < 60 * 60 * 6) {
      if (m.canDrop() && t % 45 === 0) {
        m.setAim(rng.float(0, JAR_WIDTH));
        m.drop();
      }
      for (const e of m.step(1 / 60)) if (e.type === 'merge') merges++;
      t++;
    }
    expect(merges).toBeGreaterThan(20);
    expect(m.score).toBeGreaterThan(50);
    for (const b of m.physics.bodies) {
      expect(Number.isFinite(b.x + b.y)).toBe(true);
      expect(b.x).toBeGreaterThanOrEqual(b.r - 1);
      expect(b.x).toBeLessThanOrEqual(JAR_WIDTH - b.r + 1);
      expect(b.y).toBeLessThanOrEqual(H - b.r + 1);
    }
  });
});
