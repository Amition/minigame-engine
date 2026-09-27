/** Seeds of a sweep: an explicit list, or `count` consecutive seeds starting at `from`. */
export type SweepSeeds = readonly number[] | { from: number; count: number };

/** One metric over a seed sweep. `values[i]` is the result of `seeds[i]`; the rest summarizes them. */
export interface SweepStats {
  seeds: number[];
  values: number[];
  min: number;
  max: number;
  mean: number;
  median: number;
  /** 10th / 90th percentile, interpolated linearly between the sorted values (numpy's default). */
  p10: number;
  p90: number;
}

type Metrics = Readonly<Record<string, number>>;

function seedList(seeds: SweepSeeds): number[] {
  if ('from' in seeds) return Array.from({ length: Math.max(0, seeds.count) }, (_, i) => seeds.from + i);
  return [...seeds];
}

function quantile(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function stats(seeds: number[], values: number[]): SweepStats {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    seeds,
    values,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    mean: values.reduce((s, v) => s + v, 0) / values.length,
    median: quantile(sorted, 0.5),
    p10: quantile(sorted, 0.1),
    p90: quantile(sorted, 0.9),
  };
}

/**
 * Runs `run` once per seed, one after another (test games share the platform and rng, so never in parallel), and
 * summarizes the results. Return one number per seed, or several metrics of the same run as an object: then every
 * metric gets its own stats. For balance tests: "a bot kills 6-12 enemies at the median over seeds 1-6".
 *
 *     const kills = await sweepSeeds({ from: 1, count: 6 }, (seed) => botRun(seed).kills);
 *     expect(kills.median, formatSweep(kills)).toBeGreaterThanOrEqual(6);
 *
 *     const r = await sweepSeeds([1, 2, 3], (seed) => ({ kills: m.score, time: m.time }));
 *     expect(r.time.p90, formatSweep(r)).toBeLessThan(180);
 */
export async function sweepSeeds(seeds: SweepSeeds, run: (seed: number) => number | Promise<number>): Promise<SweepStats>;
export async function sweepSeeds<K extends string>(
  seeds: SweepSeeds,
  run: (seed: number) => Readonly<Record<K, number>> | Promise<Readonly<Record<K, number>>>,
): Promise<Record<K, SweepStats>>;
export async function sweepSeeds(
  seeds: SweepSeeds,
  run: (seed: number) => number | Metrics | Promise<number | Metrics>,
): Promise<SweepStats | Record<string, SweepStats>> {
  const list = seedList(seeds);
  if (list.length === 0) throw new Error('sweepSeeds: no seeds');
  const results: (number | Metrics)[] = [];
  for (const seed of list) results.push(await run(seed));
  const first = results[0]!;
  if (typeof first === 'number') {
    const bad = results.findIndex((r) => typeof r !== 'number');
    if (bad >= 0) throw new Error(`sweepSeeds: seed ${list[bad]} returned ${JSON.stringify(results[bad])}, expected a number`);
    return stats(list, results as number[]);
  }
  const out: Record<string, SweepStats> = {};
  for (const key of Object.keys(first)) {
    const values = results.map((r, i) => {
      const v = typeof r === 'number' ? undefined : r[key];
      if (typeof v !== 'number') throw new Error(`sweepSeeds: seed ${list[i]} returned no number for "${key}"`);
      return v;
    });
    out[key] = stats(list, values);
  }
  return out;
}

const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, ''));

function formatOne(s: SweepStats): string {
  const perSeed = s.seeds.map((seed, i) => `${seed}:${num(s.values[i]!)}`).join(' ');
  return (
    `median ${num(s.median)} (p10 ${num(s.p10)}, p90 ${num(s.p90)}, min ${num(s.min)}, max ${num(s.max)}, ` +
    `mean ${num(s.mean)}) over ${s.seeds.length} seeds [${perSeed}]`
  );
}

/**
 * One line for failure messages: `median 8 (p10 6.5, p90 11, min 6, max 12, mean 8.5) over 6 seeds [1:8 2:6 ...]`;
 * metric objects give `kills: ... | time: ...`.
 */
export function formatSweep(s: SweepStats | Readonly<Record<string, SweepStats>>): string {
  if ('values' in s && Array.isArray(s.values)) return formatOne(s as SweepStats);
  return Object.entries(s as Record<string, SweepStats>)
    .map(([k, v]) => `${k}: ${formatOne(v)}`)
    .join(' | ');
}
