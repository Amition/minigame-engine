import { afterEach, describe, expect, it } from 'vitest';
import {
  clamp,
  clamp01,
  createInputActions,
  easings,
  every,
  Node,
  Pool,
  springProp,
  toCss,
  tween,
  type EaseFn,
  type EaseName,
  type RGBA,
} from '@engine';
import { createTestGame, RecordingAudio, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

// The composed easings as they were before the flat rewrite: the reference the fast versions must match.
function referenceEasings(): Record<string, EaseFn> {
  const BACK = 1.70158;
  const ELASTIC = (2 * Math.PI) / 3;
  const bounceOut = (t: number): number => {
    const n = 7.5625;
    const d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  };
  const ins: Record<string, EaseFn> = {
    quad: (t) => t * t,
    cubic: (t) => t * t * t,
    quart: (t) => t * t * t * t,
    quint: (t) => t * t * t * t * t,
    sine: (t) => 1 - Math.cos((t * Math.PI) / 2),
    expo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
    circ: (t) => 1 - Math.sqrt(1 - t * t),
    back: (t) => (BACK + 1) * t * t * t - BACK * t * t,
    elastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * ELASTIC)),
    bounce: (t) => 1 - bounceOut(1 - t),
  };
  const exact =
    (f: EaseFn): EaseFn =>
    (t) =>
      t <= 0 ? 0 : t >= 1 ? 1 : f(t);
  const out: Record<string, EaseFn> = { linear: exact((t) => t) };
  for (const [name, fin] of Object.entries(ins)) {
    out[`${name}In`] = exact(fin);
    out[`${name}Out`] = exact((t) => 1 - fin(1 - t));
    out[`${name}InOut`] = exact((t) => (t < 0.5 ? fin(2 * t) / 2 : 1 - fin(2 - 2 * t) / 2));
  }
  return out;
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');
function referenceToCss(c: RGBA): string {
  const r = Math.round(clamp(c.r, 0, 255));
  const g = Math.round(clamp(c.g, 0, 255));
  const b = Math.round(clamp(c.b, 0, 255));
  if (c.a >= 1) return '#' + hex2(r) + hex2(g) + hex2(b);
  return `rgba(${r},${g},${b},${+clamp01(c.a).toFixed(3)})`;
}

describe('easing fast paths', () => {
  it('match the composed reference within 1e-12 over 1001 samples, with exact endpoints and clamping', () => {
    const ref = referenceEasings();
    expect(Object.keys(easings)).toEqual(Object.keys(ref));
    for (const name of Object.keys(ref) as EaseName[]) {
      const f = easings[name];
      let maxDiff = 0;
      for (let i = 0; i <= 1000; i++) {
        const x = i / 1000;
        maxDiff = Math.max(maxDiff, Math.abs(f(x) - ref[name]!(x)));
      }
      for (const x of [1e-9, 1e-15, 5e-324, 0.5 - 1e-15, 0.5, 0.5 + 1e-15, 1 - 1e-12, 1 - Number.EPSILON]) {
        maxDiff = Math.max(maxDiff, Math.abs(f(x) - ref[name]!(x)));
      }
      expect(maxDiff, name).toBeLessThanOrEqual(1e-12);
      expect(f(0), name).toBe(0);
      expect(f(1), name).toBe(1);
      expect(f(-0.5), name).toBe(0);
      expect(f(1.5), name).toBe(1);
    }
  });
});

describe('toCss cache', () => {
  it('formats exactly like the uncached conversion, including rounding edges and cache collisions', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const samples: RGBA[] = [];
    for (let i = 0; i < 20000; i++) {
      samples.push({ r: rnd() * 300 - 20, g: rnd() * 300 - 20, b: rnd() * 300 - 20, a: rnd() < 0.3 ? 1 : rnd() * 1.4 - 0.2 });
    }
    for (let k = 0; k <= 2000; k++) samples.push({ r: 10, g: 20, b: 30, a: k / 2000 });
    for (const a of [0.0625, 0.0005, 0.1235, 0.9995, 0.3335, 1 - 1e-12, 1e-12, -0, NaN, Infinity, -Infinity]) {
      samples.push({ r: 255, g: 0, b: 127.5, a });
    }
    for (const bad of [NaN, Infinity, -Infinity]) samples.push({ r: bad, g: 1, b: 2, a: 0.5 }, { r: 1, g: bad, b: 2, a: 1 });
    for (let pass = 0; pass < 2; pass++) {
      for (const c of samples) expect(toCss(c)).toBe(referenceToCss(c));
    }
  });
});

describe('tween/timer pause checks', () => {
  it('a callback pausing or reparenting mid-frame freezes tweens later in the same frame', async () => {
    t = await createTestGame({ render: 'none' });
    const layer = t.game.sceneLayer;
    const parent = layer.add(new Node());
    const frozen = layer.add(new Node());
    frozen.paused = true;
    const a = parent.add(new Node());
    const b = parent.add(new Node());
    const c = layer.add(new Node());
    tween(a, { x: 100 }, 1, {
      ease: 'linear',
      onUpdate: (p) => {
        if (p > 0.26) parent.paused = true;
      },
    });
    tween(b, { x: 100 }, 1, { ease: 'linear' });
    tween(c, { y: 100 }, 1, {
      ease: 'linear',
      onUpdate: (p) => {
        if (p > 0.51 && c.parent !== frozen) frozen.add(c);
      },
    });
    tween(c, { x: 100 }, 1, { ease: 'linear' });
    await t.step(16);
    expect(a.x).toBeCloseTo(100 * (16 / 60));
    expect(b.x).toBeCloseTo(100 * (15 / 60));
    await t.step(20);
    expect(b.x).toBeCloseTo(100 * (15 / 60));
    expect(c.x).toBeCloseTo(100 * (30 / 60));
    await t.step(10);
    expect(c.x).toBeCloseTo(100 * (30 / 60));
  });

  it('a timer callback pausing a node stops that node\u2019s timers for the rest of the frame', async () => {
    t = await createTestGame({ render: 'none' });
    const layer = t.game.sceneLayer;
    const holder = layer.add(new Node());
    const kid = holder.add(new Node());
    let ticks = 0;
    every(0.5, () => (holder.paused = true), { owner: layer });
    every(0.5, () => void ticks++, { owner: kid });
    await t.advance(0.6);
    expect(ticks).toBe(0);
    holder.paused = false;
    await t.advance(0.45);
    expect(ticks).toBe(1);
  });
});

describe('springProp at rest', () => {
  it('stops writing once settled, resumes on a new target and writes snaps and an initial value', async () => {
    t = await createTestGame({ render: 'none' });
    const owner = t.game.sceneLayer.add(new Node());
    let writes = 0;
    let stored = 0;
    const obj = {
      get v() {
        return stored;
      },
      set v(x: number) {
        stored = x;
        writes++;
      },
    };
    const fx = springProp(obj, 'v', { owner, frequency: 4, dampingRatio: 1, value: 5 });
    await t.step();
    expect(stored).toBe(5);
    expect(writes).toBe(1);
    await t.step(30);
    expect(writes).toBe(1);
    fx.target = 10;
    await t.advance(3);
    expect(stored).toBe(10);
    const settled = writes;
    expect(settled).toBeGreaterThan(5);
    await t.step(30);
    expect(writes).toBe(settled);
    fx.snap(2);
    await t.step(2);
    expect(stored).toBe(2);
    expect(writes).toBe(settled + 1);
  });
});

describe('Pool bookkeeping', () => {
  it('keeps get() order in active(), releases in that order and compacts after heavy churn', () => {
    const pool = new Pool({ create: () => ({ id: 0 }) });
    const items = Array.from({ length: 5 }, (_, i) => Object.assign(pool.get(), { id: i }));
    pool.release(items[1]!);
    pool.release(items[3]!);
    expect(pool.get()).toBe(items[3]);
    expect(pool.active().map((o) => o.id)).toEqual([0, 2, 4, 3]);
    pool.releaseAll();
    expect(pool.stats).toEqual({ created: 5, active: 0, free: 5 });
    expect(pool.get()).toBe(items[3]);
    pool.release(items[3]!);

    const live: { id: number }[] = [];
    for (let round = 0; round < 500; round++) {
      live.push(pool.get());
      if (live.length > 40) pool.release(live.shift()!);
    }
    expect(pool.stats.active).toBe(40);
    expect(pool.active()).toEqual(live);
    for (const o of live.splice(0, 35)) pool.release(o);
    expect(pool.active()).toEqual(live);
    pool.release(live[0]!);
    pool.release(live[0]!);
    expect(pool.stats.active).toBe(4);
  });

  it('drops releases beyond max and discards invalid free items for good', () => {
    let bad: object | null = null;
    const pool = new Pool<object>({ create: () => ({}), max: 1, valid: (o) => o !== bad });
    const a = pool.get();
    const b = pool.get();
    pool.release(a);
    pool.release(b);
    expect(pool.stats.free).toBe(1);
    bad = a;
    const c = pool.get();
    expect(c).not.toBe(a);
    expect(c).not.toBe(b);
    pool.release(a);
    expect(pool.stats).toEqual({ created: 3, active: 1, free: 0 });
  });
});

describe('headless audio log', () => {
  it('coalesces volume ramps per sound and segment, and stays bounded', () => {
    let now = 0;
    const audio = new RecordingAudio(() => now);
    const music = audio.play('music', { loop: true });
    const other = audio.play('amb');
    for (let i = 1; i <= 60; i++) {
      now += 16;
      music.setVolume(1 - i / 60);
      other.setVolume(i / 60);
    }
    audio.play('click');
    music.setVolume(0.5);
    expect(audio.log.map((e) => `${e.action}:${e.key}:${e.opts?.volume ?? ''}`)).toEqual([
      'play:music:',
      'play:amb:',
      'volume:music:0',
      'volume:amb:1',
      'play:click:',
      'volume:music:0.5',
    ]);
    expect(audio.log[2]!.time).toBe(960);

    audio.logLimit = 100;
    for (let i = 0; i < 250; i++) audio.play(`s${i}`);
    expect(audio.log.length).toBeLessThanOrEqual(100);
    expect(audio.played().pop()).toBe('s249');
    music.setVolume(0.2);
    expect(audio.log[audio.log.length - 1]).toMatchObject({ action: 'volume', key: 'music', opts: { volume: 0.2 } });
  });
});

describe('input sampling', () => {
  it('a virtual source removing itself does not skip the next source that frame', async () => {
    t = await createTestGame({ render: 'none' });
    const input = createInputActions(t.game, { jump: ['Space'] });
    const off: (() => void)[] = [];
    off.push(
      input.bindVirtual('jump', () => {
        off[0]!();
        return false;
      }),
    );
    input.bindVirtual('jump', () => true);
    await t.step();
    expect(input.pressed('jump')).toBe(true);
    await t.step();
    expect(input.down('jump')).toBe(true);
  });
});
