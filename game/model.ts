import { Rng } from '@engine';
import { FRUITS, MAX_LEVEL, WATERMELON_PAIR_BONUS, fruit } from './fruits';
import { FruitPhysics, type FruitBody } from './physics';

/**
 * 合成大西瓜 rules, independent of rendering: the dropper, spawn queue, merges, score, combos and the danger line.
 * The scene calls setAim/drop from input and step() at a fixed rate, and turns the returned events into visuals.
 */

export type SuikaEvent =
  | { type: 'drop'; body: FruitBody }
  | { type: 'spawn'; level: number; next: number }
  | {
      type: 'merge';
      a: FruitBody;
      b: FruitBody;
      /** The new fruit (null when two watermelons vanished). */
      into: FruitBody | null;
      level: number;
      x: number;
      y: number;
      points: number;
      combo: number;
    }
  | { type: 'impact'; body: FruitBody; strength: number }
  | { type: 'danger'; on: boolean }
  | { type: 'gameover'; score: number };

export interface SuikaOptions {
  width: number;
  height: number;
  /** Jar-local y of the danger line (fruit tops above it for too long end the game). */
  dangerY: number;
  seed?: number;
  /** Seconds a fruit may stay above the line. Default 2.5. */
  dangerLimit?: number;
  /** Seconds between a drop and the next fruit. Default 0.5. */
  cooldown?: number;
}

/** Spawn weights for levels 0..4. */
const SPAWN_WEIGHTS = [30, 28, 22, 12, 8] as const;
/** A merge within this many seconds of the previous one (and after the same drop) extends the combo. */
const COMBO_WINDOW = 1.2;
/** Fruits younger than this are ignored by the danger check (still falling in / just merged). */
const DANGER_GRACE = 1.0;

export class SuikaModel {
  readonly physics: FruitPhysics;
  readonly width: number;
  readonly dangerY: number;
  readonly dangerLimit: number;
  readonly cooldownTime: number;
  readonly rng: Rng;
  state: 'playing' | 'over' = 'playing';
  score = 0;
  /** Level waiting in the dropper (null during the cooldown after a drop). */
  current: number | null;
  next: number;
  aimX: number;
  combo = 0;
  drops = 0;
  merges = 0;
  bestLevel = 0;
  /** Seconds some fruit has been above the danger line. */
  dangerTime = 0;
  private comboTimer = 0;
  private cooldown = 0;
  private danger = false;
  private pending: SuikaEvent[] = [];

  constructor(opts: SuikaOptions) {
    this.width = opts.width;
    this.dangerY = opts.dangerY;
    this.dangerLimit = opts.dangerLimit ?? 2.5;
    this.cooldownTime = opts.cooldown ?? 0.5;
    this.rng = new Rng(opts.seed ?? 1);
    this.physics = new FruitPhysics({ width: opts.width, height: opts.height });
    this.current = this.roll();
    this.next = this.roll();
    this.aimX = opts.width / 2;
  }

  /** Jar-local centre y of the fruit waiting in the dropper. */
  dropperY(level: number): number {
    return Math.max(24 + fruit(level).radius, this.dangerY - 40 - fruit(level).radius);
  }

  /** Moves the dropper; clamped so the waiting fruit stays inside the jar. */
  setAim(x: number): void {
    const r = this.current !== null ? fruit(this.current).radius : FRUITS[0]!.radius;
    this.aimX = Math.min(this.width - r, Math.max(r, x));
  }

  canDrop(): boolean {
    return this.state === 'playing' && this.current !== null;
  }

  /** Releases the waiting fruit at aimX. Returns its body, or null when nothing can drop. */
  drop(): FruitBody | null {
    if (!this.canDrop()) return null;
    const level = this.current!;
    this.setAim(this.aimX);
    const body = this.physics.add(level, fruit(level).radius, this.aimX, this.dropperY(level), { vy: 200 });
    this.current = null;
    this.cooldown = this.cooldownTime;
    this.drops++;
    this.combo = 0;
    this.comboTimer = 0;
    this.pending.push({ type: 'drop', body });
    return body;
  }

  /** Advances the simulation by a fixed dt and returns what happened. */
  step(dt: number): SuikaEvent[] {
    const events = this.pending;
    this.pending = [];
    if (this.state === 'over') return events;

    const { merges } = this.physics.step(dt);
    for (const b of this.physics.bodies) {
      if (b.impact > 450 && b.landed) events.push({ type: 'impact', body: b, strength: b.impact });
    }

    if (this.comboTimer > 0 && (this.comboTimer -= dt) <= 0) this.combo = 0;
    for (const { a, b } of merges) events.push(this.merge(a, b));

    if (this.current === null && (this.cooldown -= dt) <= 0) {
      this.current = this.next;
      this.next = this.roll();
      this.setAim(this.aimX);
      events.push({ type: 'spawn', level: this.current, next: this.next });
    }

    const over = this.overLine();
    if (over) this.dangerTime += dt;
    else this.dangerTime = 0;
    if (over !== this.danger) {
      this.danger = over;
      events.push({ type: 'danger', on: over });
    }
    if (this.dangerTime >= this.dangerLimit) {
      this.state = 'over';
      this.current = null;
      events.push({ type: 'gameover', score: this.score });
    }
    return events;
  }

  /** True when a settled fruit pokes above the danger line. */
  overLine(): boolean {
    const t = this.physics.time;
    for (const b of this.physics.bodies) {
      if (!b.landed || t - b.born < DANGER_GRACE) continue;
      if (b.y - b.targetR < this.dangerY) return true;
    }
    return false;
  }

  /** Fruits currently above the danger line (for worried faces). */
  bodiesOverLine(): FruitBody[] {
    const t = this.physics.time;
    return this.physics.bodies.filter((b) => b.landed && t - b.born >= DANGER_GRACE && b.y - b.targetR < this.dangerY);
  }

  /** Continues after game over: removes every fruit that pokes above the line (rewarded revive). */
  revive(): FruitBody[] {
    const removed = this.physics.bodies.filter((b) => b.y - b.targetR < this.dangerY + 120);
    for (const b of removed) this.physics.remove(b);
    this.state = 'playing';
    this.dangerTime = 0;
    this.danger = false;
    if (this.current === null) {
      this.current = this.next;
      this.next = this.roll();
    }
    return removed;
  }

  private merge(a: FruitBody, b: FruitBody): SuikaEvent {
    const level = a.level + 1;
    const wa = a.targetR * a.targetR;
    const wb = b.targetR * b.targetR;
    const x = (a.x * wa + b.x * wb) / (wa + wb);
    const y = (a.y * wa + b.y * wb) / (wa + wb);
    this.physics.remove(a);
    this.physics.remove(b);
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.comboTimer = COMBO_WINDOW;
    this.merges++;
    let into: FruitBody | null = null;
    let points: number;
    if (level > MAX_LEVEL) {
      points = WATERMELON_PAIR_BONUS;
    } else {
      const f = fruit(level);
      points = f.points;
      into = this.physics.add(level, f.radius, x, y, {
        vx: (a.vx + b.vx) / 2,
        vy: Math.min(0, (a.vy + b.vy) / 2),
        r: a.targetR,
      });
      into.landed = true;
      this.bestLevel = Math.max(this.bestLevel, level);
    }
    if (this.combo >= 2) points += this.combo;
    this.score += points;
    return { type: 'merge', a, b, into, level, x, y, points, combo: this.combo };
  }

  /** Next dropper fruit: small ones early, then weighted grape..kiwi. */
  private roll(): number {
    const maxLevel = this.drops < 5 ? 2 : 4;
    let total = 0;
    for (let i = 0; i <= maxLevel; i++) total += SPAWN_WEIGHTS[i]!;
    let r = this.rng.next() * total;
    for (let i = 0; i <= maxLevel; i++) {
      r -= SPAWN_WEIGHTS[i]!;
      if (r < 0) return i;
    }
    return 0;
  }
}
