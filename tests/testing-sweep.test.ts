import { afterEach, describe, expect, it } from 'vitest';
import { rng } from '@engine';
import { createTestGame, formatSweep, sweepSeeds, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

describe('sweepSeeds', () => {
  it('runs once per seed in order and summarizes one number per seed', async () => {
    const order: number[] = [];
    const s = await sweepSeeds([3, 1, 2, 5, 4, 6, 7, 8, 9, 10], (seed) => {
      order.push(seed);
      return seed * 10;
    });
    expect(order).toEqual([3, 1, 2, 5, 4, 6, 7, 8, 9, 10]);
    expect(s.seeds).toEqual(order);
    expect(s.values).toEqual(order.map((x) => x * 10));
    expect([s.min, s.max, s.mean, s.median]).toEqual([10, 100, 55, 55]);
    expect(s.p10).toBeCloseTo(19);
    expect(s.p90).toBeCloseTo(91);
  });

  it('takes { from, count }; an even count interpolates the median like (s[n/2-1] + s[n/2]) / 2', async () => {
    const s = await sweepSeeds({ from: 1, count: 6 }, (seed) => [7, 3, 12, 6, 9, 8][seed - 1]!);
    expect(s.seeds).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.median).toBe((7 + 8) / 2);
    const one = await sweepSeeds([42], () => 5);
    expect([one.min, one.max, one.median, one.p10, one.p90, one.mean]).toEqual([5, 5, 5, 5, 5, 5]);
  });

  it('awaits async runs one after another (test games share the platform)', async () => {
    let running = 0;
    const run = async (seed: number) => {
      expect(running).toBe(0);
      running++;
      t = await createTestGame({ seed, render: 'none', pixelRatio: 1 });
      await t.step(2);
      const v = rng.int(0, 1000);
      t.destroy();
      t = null;
      running--;
      return v;
    };
    const s = await sweepSeeds([1, 2, 3], run);
    expect(new Set(s.values).size).toBeGreaterThan(1);
    expect((await sweepSeeds([1, 2, 3], run)).values).toEqual(s.values);
  });

  it('several metrics of the same run get their own stats', async () => {
    const r = await sweepSeeds({ from: 1, count: 4 }, (seed) => ({ kills: seed * 2, time: 100 - seed }));
    expect(r.kills.values).toEqual([2, 4, 6, 8]);
    expect(r.kills.median).toBe(5);
    expect(r.time.min).toBe(96);
    expect(r.time.seeds).toEqual([1, 2, 3, 4]);
  });

  it('formatSweep is one line with the stats and every seed, per metric', async () => {
    const s = await sweepSeeds({ from: 1, count: 6 }, (seed) => [8, 6, 12, 7, 9, 8][seed - 1]!);
    expect(formatSweep(s)).toBe('median 8 (p10 6.5, p90 10.5, min 6, max 12, mean 8.33) over 6 seeds [1:8 2:6 3:12 4:7 5:9 6:8]');
    const r = await sweepSeeds([1, 2], (seed) => ({ kills: seed, time: seed * 1.5 }));
    const line = formatSweep(r);
    expect(line).not.toContain('\n');
    expect(line).toMatch(/^kills: median 1\.5 .* \| time: median 2\.25 .*\[1:1\.5 2:3\]$/);
  });

  it('rejects empty sweeps and inconsistent results', async () => {
    await expect(sweepSeeds([], () => 1)).rejects.toThrow(/no seeds/);
    await expect(sweepSeeds({ from: 1, count: 0 }, () => 1)).rejects.toThrow(/no seeds/);
    await expect(sweepSeeds([1, 2], (seed) => (seed === 1 ? { a: 1 } : ({ b: 2 } as unknown as { a: number })))).rejects.toThrow(
      /seed 2 returned no number for "a"/,
    );
    await expect(sweepSeeds([1, 2], (seed) => (seed === 1 ? 1 : (undefined as unknown as number)))).rejects.toThrow(/seed 2 returned/);
  });
});
