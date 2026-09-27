import { textureMemory } from '../gfx/texture';
import type { Platform } from '../platform/types';
import type { Node } from '../scene/node';

/** Rolling window of per-frame samples in a fixed ring buffer (no allocation per sample). */
export class GameStatSeries {
  /** Most recent sample. */
  last = 0;
  private readonly buf: Float64Array;
  private scratch: Float64Array | null = null;
  private n = 0;
  private next = 0;

  constructor(readonly size = 120) {
    this.buf = new Float64Array(Math.max(1, size));
  }

  push(v: number): void {
    this.last = v;
    this.buf[this.next] = v;
    this.next = (this.next + 1) % this.buf.length;
    if (this.n < this.buf.length) this.n++;
  }

  /** Samples in the window (up to size). */
  get count(): number {
    return this.n;
  }

  get avg(): number {
    if (this.n === 0) return 0;
    let s = 0;
    for (let i = 0; i < this.n; i++) s += this.buf[i]!;
    return s / this.n;
  }

  get max(): number {
    let m = 0;
    for (let i = 0; i < this.n; i++) if (this.buf[i]! > m) m = this.buf[i]!;
    return m;
  }

  get min(): number {
    if (this.n === 0) return 0;
    let m = Infinity;
    for (let i = 0; i < this.n; i++) if (this.buf[i]! < m) m = this.buf[i]!;
    return m;
  }

  /** Percentile of the window, p in 0..1 (0.95 = p95). Sorts a reused scratch copy. */
  percentile(p: number): number {
    if (this.n === 0) return 0;
    const s = (this.scratch ??= new Float64Array(this.buf.length));
    s.set(this.buf);
    const view = s.subarray(0, this.n);
    view.sort();
    return view[Math.min(this.n - 1, Math.max(0, Math.ceil(p * this.n) - 1))]!;
  }

  /** Sample `ago` frames back (0 = last), 0 when out of range. */
  at(ago: number): number {
    if (ago < 0 || ago >= this.n) return 0;
    const len = this.buf.length;
    return this.buf[(this.next - 1 - ago + len * 2) % len]!;
  }

  reset(): void {
    this.n = 0;
    this.next = 0;
    this.last = 0;
  }
}

/** Plain copy of the current stats (for logs, JSON, window.__engine). */
export interface GameStatsSnapshot {
  fps: number;
  frames: number;
  frameMs: { avg: number; max: number };
  updateMs: { avg: number; max: number };
  renderMs: { avg: number; max: number };
  /** Worst frame interval in the window (hitches). */
  intervalMaxMs: number;
  nodes: number;
  drawnNodes: number;
  particles: number;
  textures: number;
  textureMB: number;
}

interface StatsHost {
  readonly platform: Platform;
  readonly stage: Node;
}

/**
 * Per-game performance counters, filled by the Game loop (`game.stats`). update() and render() are timed
 * separately, so harnesses that call them one by one still get numbers. Reading is cheap: series summaries are
 * computed on demand, the node walk is cached until the next frame.
 *
 *     const s = game.stats;
 *     console.log(s.fps, s.updateMs.avg, s.renderMs.max, s.nodes, s.textureMB);
 */
export class GameStats {
  /** When false the loop skips its clock reads (fps and counts still update). */
  enabled = true;
  /**
   * Millisecond clock for CPU timings: platform.now(), except headless where the platform clock is simulated
   * and performance.now() is used instead.
   */
  clock: () => number;
  /** Frames per second, smoothed over ~0.5 s of frame intervals (the dt given to step()/update()). */
  fps = 0;
  /** Frame intervals (ms): the loop's dt before clamping. Max = the worst hitch in the window. */
  readonly intervalMs: GameStatSeries;
  /** CPU ms per frame: update + render. */
  readonly frameMs: GameStatSeries;
  readonly updateMs: GameStatSeries;
  readonly renderMs: GameStatSeries;
  /** Nodes whose render() ran in the last frame (visible and not culled). */
  drawnNodes = 0;
  /** Rendered frames since start (or reset()). */
  frames = 0;

  private smoothed = 0;
  private pendingInterval = -1;
  private pendingUpdateMs = 0;
  private version = 0;
  private walkedVersion = -1;
  private nodeCount = 0;
  private particleCount = 0;

  constructor(
    private readonly host: StatsHost,
    windowSize = 120,
  ) {
    this.intervalMs = new GameStatSeries(windowSize);
    this.frameMs = new GameStatSeries(windowSize);
    this.updateMs = new GameStatSeries(windowSize);
    this.renderMs = new GameStatSeries(windowSize);
    const p = host.platform;
    const perf = p.name === 'headless' && typeof performance !== 'undefined' ? performance : null;
    this.clock = perf ? () => perf.now() : () => p.now();
  }

  /** Nodes in the stage, including the stage itself (walks the tree once per frame, on first read). */
  get nodes(): number {
    this.walk();
    return this.nodeCount;
  }

  /** Live particles of every ParticleEmitter in the stage (same walk as nodes). */
  get particles(): number {
    this.walk();
    return this.particleCount;
  }

  /** Tracked texture sources (see textureStats()). Shared by every game in the process. */
  get textureCount(): number {
    return textureMemory.count;
  }

  /** Estimated bytes of tracked textures (4 per pixel). */
  get textureBytes(): number {
    return textureMemory.bytes;
  }

  get textureMB(): number {
    return textureMemory.bytes / 1048576;
  }

  /** Clears the windows and counters. */
  reset(): void {
    this.fps = 0;
    this.smoothed = 0;
    this.frames = 0;
    this.drawnNodes = 0;
    this.pendingInterval = -1;
    this.pendingUpdateMs = 0;
    this.intervalMs.reset();
    this.frameMs.reset();
    this.updateMs.reset();
    this.renderMs.reset();
    this.version++;
  }

  snapshot(): GameStatsSnapshot {
    return {
      fps: this.fps,
      frames: this.frames,
      frameMs: { avg: this.frameMs.avg, max: this.frameMs.max },
      updateMs: { avg: this.updateMs.avg, max: this.updateMs.max },
      renderMs: { avg: this.renderMs.avg, max: this.renderMs.max },
      intervalMaxMs: this.intervalMs.max,
      nodes: this.nodes,
      drawnNodes: this.drawnNodes,
      particles: this.particles,
      textures: this.textureCount,
      textureMB: this.textureMB,
    };
  }

  // ---------------------------------------------------------------- called by Game

  /** Game.step(): the frame interval before clamping (fps uses it instead of update's clamped dt). */
  noteInterval(dt: number): void {
    this.pendingInterval = dt;
  }

  /** Start timestamp for endUpdate()/endRender() (0 when disabled). */
  now(): number {
    return this.enabled ? this.clock() : 0;
  }

  endUpdate(rawDt: number, t0: number): void {
    const iv = this.pendingInterval >= 0 ? this.pendingInterval : rawDt;
    this.pendingInterval = -1;
    this.version++;
    if (iv > 0) {
      this.intervalMs.push(iv * 1000);
      this.smoothed = this.smoothed > 0 ? this.smoothed + (iv - this.smoothed) * (1 - Math.exp(-iv / 0.5)) : iv;
      this.fps = 1 / this.smoothed;
    }
    if (!this.enabled) return;
    const ms = this.clock() - t0;
    this.updateMs.push(ms);
    this.pendingUpdateMs += ms;
  }

  endRender(t0: number, drawn: number): void {
    this.drawnNodes = drawn;
    this.frames++;
    this.version++;
    if (!this.enabled) return;
    const ms = this.clock() - t0;
    this.renderMs.push(ms);
    this.frameMs.push(this.pendingUpdateMs + ms);
    this.pendingUpdateMs = 0;
  }

  private walk(): void {
    if (this.walkedVersion === this.version) return;
    this.walkedVersion = this.version;
    this.nodeCount = 0;
    this.particleCount = 0;
    this.count(this.host.stage);
  }

  private count(n: Node): void {
    this.nodeCount++;
    const pc = (n as { particleCount?: unknown }).particleCount;
    if (typeof pc === 'number') this.particleCount += pc;
    const ch = n.children;
    for (let i = 0; i < ch.length; i++) this.count(ch[i]!);
  }
}

const fmt = (v: number, digits = 2) => v.toFixed(digits);

/** One-line summary: `fps 60.0 | frame 1.20 ms (max 3.40) | update 0.30/0.90 | render ... | nodes 245 ...`. */
export function formatGameStats(s: GameStats): string {
  return (
    `fps ${fmt(s.fps, 1)} | frame ${fmt(s.frameMs.avg)} ms (max ${fmt(s.frameMs.max)}) | ` +
    `update ${fmt(s.updateMs.avg)}/${fmt(s.updateMs.max)} | render ${fmt(s.renderMs.avg)}/${fmt(s.renderMs.max)} | ` +
    `nodes ${s.nodes} (drawn ${s.drawnNodes}) | particles ${s.particles} | ` +
    `textures ${s.textureCount} = ${fmt(s.textureMB)} MB`
  );
}
