import {
  after,
  Box,
  clamp,
  createAudioManager,
  createSpring,
  every,
  fadeOut,
  fixedUpdate,
  floatUp,
  getAudioManager,
  hsl,
  Node,
  onAim,
  playSound,
  popIn,
  punch,
  rng,
  shake,
  spawnParticles,
  springProp,
  squashSpring,
  Text,
  wobble,
  type AimInfo,
  type Ctx2D,
  type Game,
  type NodeOptions,
  type SceneFactory,
  type SpringProp,
  type Vec2,
} from '@engine';
import { sfx } from '../audio/index';
import { DemoScene } from '../common';

const ARENA = '#10131a';
const TEXT = '#e6e9f2';
const MUTED = '#8a90a2';

function ensureAudio(game: Game): void {
  if (!getAudioManager(game)) createAudioManager(game, { library: { sfx } });
}

function button(parent: Node, id: string, label: string, cx: number, cy: number, w: number, h: number, fill: string, onTap: (b: Box) => void): Box {
  const b = parent.add(new Box(w, h, { fill, radius: 22 }, { id, x: cx, y: cy, anchor: 0.5 }));
  b.add(new Text(label, { fontSize: 28, color: '#ffffff', fontWeight: 'bold' }, { x: w / 2, y: h / 2, anchor: 0.5 }));
  b.onTap(() => onTap(b));
  return b;
}

// ---------------------------------------------------------------- helpers-aim

const GRAVITY = 1800;
const POWER = 7.5;
const MAX_PULL = 200;
const BALL_R = 24;
const TARGET = 96;

/** Y-shaped slingshot; the local origin is the pouch at rest, (pouchX, pouchY) where the bands meet now. */
class Slingshot extends Node {
  pouchX = 0;
  pouchY = 0;

  constructor(
    readonly spread: number,
    opts?: NodeOptions,
  ) {
    super(opts);
  }

  override get kind(): string {
    return 'Slingshot';
  }

  override draw(ctx: Ctx2D): void {
    const s = this.spread;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#92400e';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(-s, 0);
    ctx.lineTo(this.pouchX, this.pouchY);
    ctx.stroke();
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(-s, 0);
    ctx.lineTo(0, 90);
    ctx.lineTo(s, 0);
    ctx.moveTo(0, 90);
    ctx.lineTo(0, 210);
    ctx.stroke();
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(this.pouchX, this.pouchY);
    ctx.stroke();
  }

  override describe() {
    return { ...super.describe(), pouch: `${Math.round(this.pouchX)},${Math.round(this.pouchY)}` };
  }
}

/** Dotted flight preview (points in parent space); `ghost` dims it for the idle hint. */
class TrajectoryDots extends Node {
  points: Vec2[] = [];
  ghost = false;

  override get kind(): string {
    return 'Trajectory';
  }

  override draw(ctx: Ctx2D): void {
    const n = this.points.length;
    const base = ctx.globalAlpha;
    ctx.fillStyle = '#fde68a';
    for (let i = 0; i < n; i++) {
      const p = this.points[i]!;
      const k = 1 - i / n;
      ctx.globalAlpha = base * (this.ghost ? 0.45 : 0.95) * (0.35 + 0.65 * k);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3 + 5 * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = base;
  }

  override describe() {
    return { ...super.describe(), dots: this.points.length, ghost: this.ghost || undefined };
  }
}

interface Shot {
  ball: Box;
  vx: number;
  vy: number;
  cooldown: Map<Box, number>;
}

/**
 * Slingshot on onAim (press anywhere, pull back, release), dotted trajectory, projectiles simulated with a
 * node-bound fixedUpdate, squashSpring on landings and hits, wobble on targets, springProp bands, scenes.restart().
 */
class AimDemo extends DemoScene {
  readonly title = 'Helpers · Aim';
  private arena!: Box;
  private sling!: Slingshot;
  private pouchX!: SpringProp;
  private pouchY!: SpringProp;
  private dots!: TrajectoryDots;
  private loaded: Box | null = null;
  private readonly shots: Shot[] = [];
  private readonly targets: Box[] = [];
  private scoreLabel!: Text;
  private readout!: Text;
  private groundY = 0;
  private score = 0;

  protected build(): void {
    ensureAudio(this.game);
    const { y, w, h } = this.content;
    this.scoreLabel = this.add(new Text('命中 0', { fontSize: 32, fontWeight: 'bold', color: TEXT }, { id: 'score', x: 24, y: y + 38, anchorY: 0.5 }));
    this.readout = this.add(
      new Text('拖动瞄准', { fontSize: 24, color: MUTED }, { id: 'readout', x: w - 24, y: y + 38, anchorX: 1, anchorY: 0.5 }),
    );

    const aw = w - 48;
    const ah = h - 76 - 132;
    const arena = (this.arena = this.add(
      new Box(aw, ah, { fill: ARENA, stroke: '#2b3140', lineWidth: 2, radius: 24 }, { id: 'arena', x: 24, y: y + 76, clip: true, tags: ['lint-surface'] }),
    ));
    this.groundY = ah - 70;
    arena.add(new Box(aw, 70, { fill: '#1b2b22' }, { id: 'ground', y: this.groundY }));
    arena.add(new Text('按住任意位置向后拉，松手发射', { fontSize: 22, color: MUTED }, { x: 20, y: 18 }));

    [
      [0.2, 0.3],
      [0.5, 0.17],
      [0.8, 0.32],
    ].forEach(([fx, fy], i) => {
      const t = arena.add(
        new Box(TARGET, TARGET, { fill: hsl(200 + i * 55, 0.6, 0.42), radius: 22 }, { id: `target-${i}`, x: aw * fx!, y: ah * fy!, anchor: 0.5 }),
      );
      t.add(new Text('0', { fontSize: 34, fontWeight: 'bold', color: '#ffffff', stroke: { color: '#0b0d12', width: 6 } }, { x: TARGET / 2, y: TARGET / 2, anchor: 0.5 }));
      this.targets.push(t);
    });

    this.dots = arena.add(new TrajectoryDots({ id: 'trajectory' }));
    this.sling = arena.add(new Slingshot(64, { id: 'slingshot', x: aw / 2, y: this.groundY - 230 }));
    this.pouchX = springProp(this.sling, 'pouchX', { frequency: 5, dampingRatio: 0.15 });
    this.pouchY = springProp(this.sling, 'pouchY', { frequency: 5, dampingRatio: 0.15 });
    this.reload(false);
    this.aimAt(-60, 150, true);

    onAim(
      arena,
      {
        start: () => this.aimAt(0, 0, false),
        move: (a) => this.aimAt(a.dx, a.dy, false),
        release: (a) => this.release(a),
        cancel: () => this.aimAt(0, 0, false),
      },
      { space: arena, maxDistance: MAX_PULL, enabled: () => this.loaded !== null },
    );
    fixedUpdate(this, 60, (dt) => this.simulate(dt));

    button(this, 'restart', '重新开始', w / 2, y + h - 64, 300, 96, '#3b82f6', () => {
      void this.game.scenes.restart({ transition: 'fade', duration: 0.3 });
    });
  }

  private reload(pop = true): void {
    const ball = this.arena.add(new Box(BALL_R * 2, BALL_R * 2, { fill: '#f59e0b', radius: BALL_R }, { id: 'ball', anchor: 0.5 }));
    ball.x = this.sling.x + this.sling.pouchX;
    ball.y = this.sling.y + this.sling.pouchY;
    this.loaded = ball;
    if (pop) popIn(ball, 0.3);
  }

  private aimAt(dx: number, dy: number, ghost: boolean): void {
    this.pouchX.snap(dx);
    this.pouchY.snap(dy);
    this.sling.pouchX = dx;
    this.sling.pouchY = dy;
    const dist = Math.hypot(dx, dy);
    this.dots.ghost = ghost;
    if (dist < 20) {
      this.dots.points = [];
      this.readout.text = '拖动瞄准';
      return;
    }
    const vx = -dx * POWER;
    const vy = -dy * POWER;
    const x0 = this.sling.x + dx;
    const y0 = this.sling.y + dy;
    const pts: Vec2[] = [];
    for (let i = 1; i <= 26; i++) {
      const t = i * 0.055;
      const p = { x: x0 + vx * t, y: y0 + vy * t + 0.5 * GRAVITY * t * t };
      if (p.y > this.groundY || p.x < 0 || p.x > this.arena.width) break;
      pts.push(p);
    }
    this.dots.points = pts;
    const deg = Math.round((Math.atan2(-vy, vx) * 180) / Math.PI);
    this.readout.text = `力度 ${Math.round((dist / MAX_PULL) * 100)}% · 角度 ${deg}°`;
  }

  private release(a: AimInfo): void {
    const ball = this.loaded;
    this.pouchX.target = 0;
    this.pouchY.target = 0;
    this.dots.points = [];
    if (!ball || a.distance < 20) return;
    this.loaded = null;
    ball.id = '';
    ball.tags.add('shot');
    this.shots.push({ ball, vx: -a.dx * POWER, vy: -a.dy * POWER, cooldown: new Map() });
    squashSpring(ball, -0.8, { axis: Math.abs(a.dx) > Math.abs(a.dy) ? 'x' : 'y' });
    playSound('shoot');
    while (this.shots.length > 6) this.shots.shift()!.ball.destroy();
    after(0.35, () => this.reload(), { owner: this });
  }

  private simulate(dt: number): void {
    const aw = this.arena.width;
    const floor = this.groundY - BALL_R;
    for (const s of this.shots.slice()) {
      const b = s.ball;
      if (b.destroyed) {
        this.shots.splice(this.shots.indexOf(s), 1);
        continue;
      }
      s.vy += GRAVITY * dt;
      let x = b.x + s.vx * dt;
      let y = b.y + s.vy * dt;
      if (x < BALL_R || x > aw - BALL_R) {
        x = clamp(x, BALL_R, aw - BALL_R);
        squashSpring(b, Math.min(1.4, Math.abs(s.vx) / 1200), { axis: 'x' });
        s.vx *= -0.6;
      }
      if (y > floor) {
        y = floor;
        const impact = s.vy;
        if (impact > 140) {
          squashSpring(b, Math.min(1.6, impact / 900));
          if (impact > 600) spawnParticles(this.arena, 'dust', { x, y: this.groundY });
          playSound('hit', { volume: Math.min(1, impact / 1500) });
          s.vy = -impact * 0.45;
          s.vx *= 0.82;
        } else {
          s.vy = 0;
          s.vx *= Math.max(0, 1 - 4 * dt);
        }
      }
      for (const t of this.targets) {
        const cd = s.cooldown.get(t) ?? 0;
        if (cd > 0) s.cooldown.set(t, cd - dt);
        const half = TARGET / 2;
        const cx = clamp(x, t.x - half, t.x + half);
        const cy = clamp(y, t.y - half, t.y + half);
        let nx = x - cx;
        let ny = y - cy;
        const d = Math.hypot(nx, ny);
        if (d >= BALL_R) continue;
        if (d < 1e-6) {
          nx = 0;
          ny = -1;
        } else {
          nx /= d;
          ny /= d;
        }
        x = cx + nx * BALL_R;
        y = cy + ny * BALL_R;
        const vn = s.vx * nx + s.vy * ny;
        if (vn >= 0) continue;
        s.vx -= 1.7 * vn * nx;
        s.vy -= 1.7 * vn * ny;
        if (cd <= 0 && -vn > 160) {
          s.cooldown.set(t, 0.2);
          this.hit(t, -vn, nx, ny, cx, cy);
        }
      }
      b.x = x;
      b.y = y;
      if (y >= floor - 0.5 && s.vy === 0 && Math.abs(s.vx) < 15) {
        this.shots.splice(this.shots.indexOf(s), 1);
        fadeOut(b, 0.5, { destroy: true });
      }
    }
  }

  private hit(t: Box, speed: number, nx: number, ny: number, x: number, y: number): void {
    const label = t.find<Text>('Text')!;
    label.text = String(Number(label.text) + 1);
    squashSpring(t, Math.min(1.5, speed / 700), { axis: Math.abs(nx) > Math.abs(ny) ? 'x' : 'y' });
    wobble(t, (nx >= 0 ? -1 : 1) * Math.min(1.2, speed / 900));
    spawnParticles(this.arena, 'hitSpark', { x, y });
    const plus = this.arena.add(new Text('+1', { fontSize: 36, fontWeight: 'bold', color: '#fde047', stroke: { color: '#0b0d12', width: 6 } }, { x: t.x, y: t.y - TARGET / 2 - 20, anchor: 0.5 }));
    floatUp(plus, 90, 0.7);
    this.score++;
    this.scoreLabel.text = `命中 ${this.score}`;
    punch(this.scoreLabel, 1.2, 0.25);
    playSound('coin', { pitchJitter: 1 });
    if (speed > 900) shake(this.arena, 8, 0.2);
  }

  override update(): void {
    const b = this.loaded;
    if (!b) return;
    b.x = this.sling.x + this.sling.pouchX;
    b.y = this.sling.y + this.sling.pouchY;
  }
}

// ---------------------------------------------------------------- helpers-spring

const RATIOS: [number, string][] = [
  [0.15, '#f472b6'],
  [0.45, '#22d3ee'],
  [1, '#a3e635'],
];

/** Crosshair marking the followers' target. */
class TargetMark extends Node {
  override get kind(): string {
    return 'TargetMark';
  }

  override draw(ctx: Ctx2D): void {
    ctx.strokeStyle = '#e6e9f2';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.moveTo(-28, 0);
    ctx.lineTo(28, 0);
    ctx.moveTo(0, -28);
    ctx.lineTo(0, 28);
    ctx.stroke();
  }
}

/** Step responses of createSpring (0 → 1) for each damping ratio. */
class SpringGraph extends Node {
  curves: { color: string; values: number[] }[] = [];

  override get kind(): string {
    return 'SpringGraph';
  }

  override draw(ctx: Ctx2D): void {
    const { width: w, height: h } = this;
    const pad = 24;
    let lo = 0;
    let hi = 1;
    for (const c of this.curves) {
      for (const v of c.values) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    const y0 = h - pad;
    const vy = (v: number) => y0 - ((v - lo) / (hi - lo)) * (h - 2 * pad);
    ctx.strokeStyle = '#2b3140';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pad, vy(0));
    ctx.lineTo(w - pad, vy(0));
    ctx.moveTo(pad, pad);
    ctx.lineTo(pad, y0);
    ctx.stroke();
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = '#4b5568';
    ctx.beginPath();
    ctx.moveTo(pad, vy(1));
    ctx.lineTo(w - pad, vy(1));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    for (const c of this.curves) {
      const n = c.values.length;
      ctx.strokeStyle = c.color;
      ctx.beginPath();
      c.values.forEach((v, i) => {
        const x = pad + ((w - 2 * pad) * i) / (n - 1);
        if (i === 0) ctx.moveTo(x, vy(v));
        else ctx.lineTo(x, vy(v));
      });
      ctx.stroke();
    }
  }
}

/** Jelly buttons (squashSpring / wobble), spring followers with three damping ratios, spring step-response graph. */
class SpringDemo extends DemoScene {
  readonly title = 'Helpers · Springs';

  protected build(): void {
    ensureAudio(this.game);
    const { y, w, h } = this.content;
    this.add(new Text('squashSpring / wobble：连点会叠加', { fontSize: 24, color: MUTED }, { x: 24, y: y + 20 }));
    const gap = 24;
    const bw = (w - 48 - gap * 2) / 3;
    const bh = 110;
    const by = y + 64 + bh / 2;
    const kinds: [string, string, string, (b: Box) => void][] = [
      ['squash', '挤压', '#2563eb', (b) => void squashSpring(b, 1)],
      ['wobble', '摇摆', '#7c3aed', (b) => void wobble(b, 1)],
      ['jelly', '都要', '#c2410c', (b) => {
        squashSpring(b, 0.7);
        wobble(b, -0.6);
      }],
    ];
    kinds.forEach(([id, label, fill, fx], i) => {
      button(this, `spring-${id}`, label, 24 + bw / 2 + i * (bw + gap), by, bw, bh, fill, (b) => {
        fx(b);
        playSound('pop', { pitchJitter: 2 });
      });
    });

    const ty = by + bh / 2 + 24;
    this.add(new Text('springProp 跟随：在框内拖动', { fontSize: 24, color: MUTED }, { x: 24, y: ty }));
    const ay = ty + 42;
    const aw = w - 48;
    const ah = Math.max(380, Math.round((y + h - ay) * 0.55));
    const arena = this.add(
      new Box(aw, ah, { fill: ARENA, stroke: '#2b3140', lineWidth: 2, radius: 20 }, { id: 'follow-arena', x: 24, y: ay, clip: true, tags: ['lint-surface'] }),
    );
    const mark = arena.add(new TargetMark({ id: 'follow-target', x: aw * 0.62, y: ah * 0.42 }));
    const springs: SpringProp[] = [];
    RATIOS.forEach(([ratio, color], i) => {
      arena.add(new Text(`ζ ${ratio}`, { fontSize: 24, fontWeight: 'bold', color }, { x: 20 + i * 130, y: 16 }));
      const dot = arena.add(new Box(44, 44, { fill: color, radius: 22 }, { id: `follower-${i}`, x: aw * 0.3, y: ah * 0.62, anchor: 0.5 }));
      springs.push(
        springProp(dot, 'x', { frequency: 1.4, dampingRatio: ratio }),
        springProp(dot, 'y', { frequency: 1.4, dampingRatio: ratio }),
      );
    });
    const setTarget = (x: number, y: number) => {
      mark.x = clamp(x, 30, aw - 30);
      mark.y = clamp(y, 70, ah - 30);
      for (let i = 0; i < springs.length; i += 2) {
        springs[i]!.target = mark.x;
        springs[i + 1]!.target = mark.y;
      }
    };
    setTarget(mark.x, mark.y);
    let aiming = false;
    onAim(
      arena,
      {
        start: (a) => {
          aiming = true;
          setTarget(a.x, a.y);
        },
        move: (a) => setTarget(a.x, a.y),
        release: () => void (aiming = false),
        cancel: () => void (aiming = false),
      },
      { space: arena },
    );
    every(1.6, () => void (aiming || setTarget(rng.float(aw * 0.25, aw * 0.75), rng.float(ah * 0.3, ah * 0.75))), { owner: arena });

    const gy = ay + ah + 24;
    this.add(new Text('createSpring：阶跃响应 0 → 1（1.2 秒）', { fontSize: 24, color: MUTED }, { x: 24, y: gy }));
    const graphY = gy + 42;
    const graph = this.add(
      new SpringGraph({ id: 'spring-graph', x: 24, y: graphY, width: aw, height: Math.max(160, y + h - graphY - 16) }),
    );
    graph.curves = RATIOS.map(([ratio, color]) => {
      const s = createSpring({ frequency: 2, dampingRatio: ratio, value: 0, target: 1 });
      const values = [0];
      for (let i = 0; i < 72; i++) values.push(s.step(1 / 60));
      return { color, values };
    });
  }
}

export const scenes: Record<string, SceneFactory> = {
  'helpers-aim': () => new AimDemo(),
  'helpers-spring': () => new SpringDemo(),
};
