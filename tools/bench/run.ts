/**
 * Headless frame-time benchmark of an app scene. Numbers are relative (for spotting regressions between runs on
 * the same machine), not device fps: rendering is @napi-rs/canvas on the CPU.
 *
 *   pnpm bench                                                   -> default app, its start scene, 10 s, iphone-14
 *   pnpm bench --app game --scene play --taps random --seconds 20
 *   pnpm bench --app sandbox --scene debug-overlay --json
 *
 * Options:
 *   --app <dir>          app directory containing main.ts (default: package.json "engine.app", else sandbox)
 *   --scene <name>       scene to open (default: the app's start scene)
 *   --params <json>      params passed to the scene
 *   --device <name>      device name or WxH@dpr (default: iphone-14)
 *   --seconds <n>        simulated seconds to measure, 60 frames each (default 10)
 *   --warmup <n>         simulated seconds run before measuring (default 1)
 *   --taps none|random   random taps in the lower 2/3 of the view (default none)
 *   --tap-every <s>      seconds between random taps (default 0.8)
 *   --seed <n>           rng seed for the app and the taps (default 1)
 *   --json               print a JSON object instead of the table
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { autoTextureResolution, Rng, textureStats, type AppDef, type TextureStatsEntry } from '@engine';
import { createTestGame } from '@engine/testing';
import { defaultApp } from '../common/app';

interface Args {
  app: string;
  scene?: string;
  params?: unknown;
  device: string;
  seconds: number;
  warmup: number;
  taps: 'none' | 'random';
  tapEvery: number;
  seed: number;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { app: defaultApp(), device: 'iphone-14', seconds: 10, warmup: 1, taps: 'none', tapEvery: 0.8, seed: 1, json: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    const v = () => {
      const val = argv[++i];
      if (val === undefined) throw new Error(`missing value for ${k}`);
      return val;
    };
    const num = (min: number) => {
      const n = Number(v());
      if (!Number.isFinite(n) || n < min) throw new Error(`${k} expects a number >= ${min}`);
      return n;
    };
    switch (k) {
      case '--app':
        a.app = v();
        break;
      case '--scene':
        a.scene = v();
        break;
      case '--params':
        a.params = JSON.parse(v());
        break;
      case '--device':
        a.device = v();
        break;
      case '--seconds':
        a.seconds = num(1 / 60);
        break;
      case '--warmup':
        a.warmup = num(0);
        break;
      case '--taps': {
        const t = v();
        if (t !== 'none' && t !== 'random') throw new Error('--taps expects none or random');
        a.taps = t;
        break;
      }
      case '--tap-every':
        a.tapEvery = num(1 / 60);
        break;
      case '--seed':
        a.seed = num(-Infinity);
        break;
      case '--json':
        a.json = true;
        break;
      default:
        throw new Error(`unknown option ${k}`);
    }
  }
  return a;
}

interface Summary {
  avg: number;
  p95: number;
  max: number;
}

function summarize(values: Float64Array): Summary {
  if (values.length === 0) return { avg: 0, p95: 0, max: 0 };
  const sorted = Float64Array.from(values).sort();
  let sum = 0;
  for (const v of sorted) sum += v;
  return {
    avg: sum / sorted.length,
    p95: sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)]!,
    max: sorted[sorted.length - 1]!,
  };
}

const flush = () => new Promise<void>((r) => setImmediate(r));
const mb = (bytes: number) => bytes / 1048576;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const appDir = resolve(args.app);
  const mainFile = resolve(appDir, 'main.ts');
  if (!existsSync(mainFile)) throw new Error(`no main.ts in ${appDir}`);
  const app = (await import(pathToFileURL(mainFile).href)).default as AppDef;
  const wall0 = performance.now();
  const t = await createTestGame({
    app,
    device: args.device,
    assetsDir: resolve(appDir, 'assets'),
    seed: args.seed,
    ...(args.scene ? { scene: args.scene } : {}),
    ...(args.params !== undefined ? { params: args.params } : {}),
  });
  const { game, platform } = t;
  const dt = 1 / 60;
  const rng = new Rng(args.seed);
  let tapCount = 0;
  let pendingEnd: { x: number; y: number } | null = null;
  let nextTap = args.tapEvery;
  let simTime = 0;

  const timings = { update: 0, render: 0 };
  const frame = async () => {
    if (args.taps === 'random') {
      if (pendingEnd) {
        platform.touch('end', [{ id: 1, ...pendingEnd }]);
        pendingEnd = null;
      } else if (simTime >= nextTap) {
        nextTap += args.tapEvery;
        const v = game.view;
        const p = game.stageToScreen(rng.float(0, v.width), rng.float(v.height / 3, v.height));
        platform.touch('start', [{ id: 1, x: p.x, y: p.y }]);
        pendingEnd = p;
        tapCount++;
      }
    }
    platform.clock += dt * 1000;
    simTime += dt;
    const a = performance.now();
    game.update(dt);
    const b = performance.now();
    game.render();
    const c = performance.now();
    timings.update = b - a;
    timings.render = c - b;
    await flush();
  };

  const warmFrames = Math.round(args.warmup * 60);
  for (let i = 0; i < warmFrames; i++) await frame();
  tapCount = 0;
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  const heap0 = process.memoryUsage().heapUsed;

  const n = Math.max(1, Math.round(args.seconds * 60));
  const update = new Float64Array(n);
  const render = new Float64Array(n);
  const total = new Float64Array(n);
  const nodes = new Float64Array(n);
  const drawn = new Float64Array(n);
  const particles = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    await frame();
    update[i] = timings.update;
    render[i] = timings.render;
    total[i] = timings.update + timings.render;
    nodes[i] = game.stats.nodes;
    drawn[i] = game.stats.drawnNodes;
    particles[i] = game.stats.particles;
  }
  gc?.();
  const heap1 = process.memoryUsage().heapUsed;
  const tex = textureStats({ top: 5 });
  const view = game.view;
  const result = {
    app: args.app,
    scene: game.scenes.currentName,
    device: args.device,
    view: { width: Math.round(view.width), height: Math.round(view.height), pixelRatio: game.pixelRatio, pxPerUnit: game.pixelRatio * game.scale },
    autoTextureResolution: autoTextureResolution(),
    frames: n,
    warmupFrames: warmFrames,
    seconds: n / 60,
    taps: args.taps === 'random' ? { every: args.tapEvery, count: tapCount } : null,
    seed: args.seed,
    updateMs: summarize(update),
    renderMs: summarize(render),
    frameMs: summarize(total),
    nodes: summarize(nodes),
    drawnNodes: summarize(drawn),
    particles: summarize(particles),
    textures: { count: tex.count, mb: tex.mb, top: tex.top },
    heapMB: { start: mb(heap0), end: mb(heap1), delta: mb(heap1 - heap0), gc: !!gc },
    wallSeconds: (performance.now() - wall0) / 1000,
    note: 'headless numbers are relative (compare runs on the same machine), not device fps',
  };
  t.destroy();

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const f2 = (v: number) => v.toFixed(2).padStart(8);
  const f0 = (v: number) => Math.round(v).toString().padStart(8);
  const row = (label: string, s: Summary, fmt: (v: number) => string) => `  ${label.padEnd(12)}${fmt(s.avg)}${fmt(s.p95)}${fmt(s.max)}`;
  const topList = (list: TextureStatsEntry[]) =>
    list.map((e) => `${e.key} ${e.width}x${e.height} ${mb(e.bytes).toFixed(2)} MB`).join(', ');
  const lines = [
    `bench: ${result.app} / ${result.scene} on ${result.device} ` +
      `(view ${result.view.width}x${result.view.height}, dpr ${result.view.pixelRatio}, ${result.view.pxPerUnit.toFixed(2)} px/unit, ` +
      `auto texture resolution ${result.autoTextureResolution})`,
    `  ${result.seconds.toFixed(1)} s simulated = ${n} frames (+${warmFrames} warm-up), ` +
      (result.taps ? `random taps every ${result.taps.every} s (${result.taps.count} taps)` : 'no taps') +
      `, seed ${args.seed}, wall ${result.wallSeconds.toFixed(1)} s`,
    '',
    `  ${''.padEnd(12)}${'avg'.padStart(8)}${'p95'.padStart(8)}${'max'.padStart(8)}`,
    row('update ms', result.updateMs, f2),
    row('render ms', result.renderMs, f2),
    row('frame ms', result.frameMs, f2),
    row('nodes', result.nodes, f0),
    row('drawn', result.drawnNodes, f0),
    row('particles', result.particles, f0),
    `  ${'textures'.padEnd(12)}${tex.count} sources, ${tex.mb.toFixed(2)} MB` + (tex.top.length ? `; largest: ${topList(tex.top)}` : ''),
    `  ${'heap'.padEnd(12)}${result.heapMB.delta >= 0 ? '+' : ''}${result.heapMB.delta.toFixed(2)} MB ` +
      `(${result.heapMB.start.toFixed(1)} -> ${result.heapMB.end.toFixed(1)} MB${gc ? ', after gc' : ', no gc: run with NODE_OPTIONS=--expose-gc for a steadier delta'})`,
    '',
    '  Note: headless numbers (@napi-rs/canvas CPU raster at the device backing size) are relative: compare runs on the',
    '  same machine to catch regressions; they are not device fps. Check real phones with the debug overlay (?stats=1).',
  ];
  console.log(lines.join('\n'));
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
