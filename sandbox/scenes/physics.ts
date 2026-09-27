import {
  Box,
  Node,
  RigidDebugView,
  rigidBox,
  rigidCircle,
  rigidPolygon,
  RigidWorld,
  Rng,
  TAU,
  Text,
  World,
  type Ctx2D,
  type NodeOptions,
  type RigidBody,
  type SceneFactory,
} from '@engine';
import { DemoScene } from '../common';

/** A node that draws with a callback. */
class Paint extends Node {
  private readonly paint: (ctx: Ctx2D) => void;

  constructor(paint: (ctx: Ctx2D) => void, opts?: NodeOptions) {
    super(opts);
    this.paint = paint;
  }

  override draw(ctx: Ctx2D): void {
    this.paint(ctx);
  }
}

interface Look {
  color: string;
  edge: string;
}

const COLORS: Look[] = [
  { color: '#f59e0b', edge: '#b45309' },
  { color: '#ef4444', edge: '#991b1b' },
  { color: '#22c55e', edge: '#15803d' },
  { color: '#3b82f6', edge: '#1d4ed8' },
  { color: '#a855f7', edge: '#6b21a8' },
  { color: '#ec4899', edge: '#9d174d' },
  { color: '#14b8a6', edge: '#0f766e' },
];
const STATIC_LOOK: Look = { color: '#475569', edge: '#334155' };

/** Fills every body with the colours in its userData (interpolated pose); sleeping bodies are drawn faded. */
function paintBodies(ctx: Ctx2D, world: RigidWorld): void {
  const t = world.interpolate ? world.alpha : 1;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  for (const b of world.bodies) {
    if (b.sensor) continue;
    const look = (b.userData as Look | null) ?? STATIC_LOOK;
    const x = b.prevX + (b.x - b.prevX) * t;
    const y = b.prevY + (b.y - b.prevY) * t;
    const a = b.prevAngle + (b.angle - b.prevAngle) * t;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const sh = b.shape;
    ctx.globalAlpha = b.sleeping ? 0.6 : 1;
    ctx.beginPath();
    if (sh.type === 'circle') {
      ctx.arc(x, y, sh.radius, 0, TAU);
    } else {
      const v = sh.vertices;
      for (let i = 0; i < sh.count; i++) {
        const lx = v[i * 2]!;
        const ly = v[i * 2 + 1]!;
        if (i === 0) ctx.moveTo(x + c * lx - s * ly, y + s * lx + c * ly);
        else ctx.lineTo(x + c * lx - s * ly, y + s * lx + c * ly);
      }
      ctx.closePath();
    }
    ctx.fillStyle = look.color;
    ctx.fill();
    ctx.strokeStyle = look.edge;
    ctx.stroke();
    if (sh.type === 'circle' && b.type === 'dynamic') {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(x + c * sh.radius * 0.55, y + s * sh.radius * 0.55, Math.max(2.5, sh.radius * 0.18), 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

abstract class RigidDemo extends DemoScene {
  protected hud!: Text;
  protected view!: World;
  protected physics!: RigidWorld;
  protected debug!: RigidDebugView;
  /** Average milliseconds per update() over the last frames. */
  protected ms = 0;

  /** World (lint-ignored) showing physics space 1:1: (0, 0) is the top-left of the content area. */
  protected addView(): World {
    const { x, y, w, h } = this.content;
    const view = (this.view = this.addAt(new World({ id: 'world', x, y, width: w, height: h }), 1));
    view.camera.lookAt(w / 2, h / 2);
    return view;
  }

  protected addHud(): void {
    const { x, y, w } = this.content;
    const panel = this.add(new Box(w - 32, 60, { fill: 'rgba(12,14,20,0.78)', radius: 18 }, { id: 'hud-panel', x: x + 16, y: y + 16 }));
    this.hud = panel.add(new Text('', { fontSize: 23, color: '#e6e9f2' }, { id: 'hud', x: 20, y: 30, anchor: [0, 0.5] }));
  }

  protected addButton(id: string, label: string, right: number, onTap: () => void): void {
    const { x, y, w } = this.content;
    const btn = this.add(
      new Box(120, 64, { fill: '#2d3345', radius: 16 }, { id, x: x + w - 16 - right - 120, y: y + 92, hitPadding: 12 }),
    );
    btn.add(new Text(label, { fontSize: 26, color: '#e6e9f2' }, { x: 60, y: 32, anchor: 0.5 }));
    btn.onTap(onTap);
  }

  /** Steps the physics from the frame loop and keeps a smoothed cost per frame. */
  protected runPhysics(dt: number): void {
    const t0 = this.game.platform.now();
    this.physics.update(dt);
    this.ms += (this.game.platform.now() - t0 - this.ms) * 0.1;
  }

  protected sleepingCount(): number {
    let n = 0;
    for (const b of this.physics.bodies) if (b.sleeping) n++;
    return n;
  }
}

// ---------------------------------------------------------------- stack

/**
 * Box tower, box pyramid and falling circles on a static floor. Tap a body to poke it (applyImpulse at the tap
 * point), tap empty space to spawn a random box / circle / polygon. A ray sweeps from the top-left and marks the
 * first hit with its surface normal. 调试 toggles the debug view (outlines, sleeping grey, contact normals).
 */
class RigidStackScene extends RigidDemo {
  readonly title = 'Physics · Rigid stack';
  private readonly rand = new Rng(21);
  private time = 0;
  private ray: { x0: number; y0: number; x1: number; y1: number; hit: boolean; nx: number; ny: number } = {
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 0,
    hit: false,
    nx: 0,
    ny: 0,
  };
  private spawned: RigidBody[] = [];

  protected build(): void {
    const view = this.addView();
    this.physics = new RigidWorld({ gravity: 1600, interpolate: true });
    view.add(new Paint((ctx) => paintBodies(ctx, this.physics), { id: 'bodies' }));
    view.add(new Paint((ctx) => this.drawRay(ctx), { id: 'ray' }));
    this.debug = view.add(new RigidDebugView(this.physics, { fill: false, lineWidth: 2 }, { id: 'debug', visible: false }));
    this.addHud();
    this.addButton('btn-reset', '重置', 0, () => this.reset());
    this.addButton('btn-debug', '调试', 136, () => (this.debug.visible = !this.debug.visible));
    view.onTap((e) => {
      const p = view.stageToWorld(e.x, e.y);
      this.tapAt(p.x, p.y);
    });
    this.reset();
    this.onUpdate((dt) => this.think(dt));
  }

  private reset(): void {
    const { w, h } = this.content;
    const P = this.physics;
    P.clear();
    this.spawned = [];
    const gy = h - 70;
    P.add({ name: 'floor', type: 'static', shape: rigidBox(w + 400, 200), x: w / 2, y: gy + 100 });
    P.add({ name: 'wall-left', type: 'static', shape: rigidBox(200, h * 3), x: -100, y: h / 2 });
    P.add({ name: 'wall-right', type: 'static', shape: rigidBox(200, h * 3), x: w + 100, y: h / 2 });

    const tx = Math.max(110, w * 0.2);
    for (let i = 0; i < 10; i++) {
      P.add({ shape: rigidBox(84, 40), x: tx, y: gy - 20 - i * 40, friction: 0.6, userData: COLORS[i % 2 === 0 ? 0 : 6] });
    }
    const size = 46;
    const rows = 7;
    const px = w * 0.62;
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < rows - r; i++) {
        const x = px + (i - (rows - r - 1) / 2) * (size + 1);
        P.add({ shape: rigidBox(size, size), x, y: gy - size / 2 - r * size, friction: 0.6, userData: COLORS[3 + (r % 2)] });
      }
    }
    for (let i = 0; i < 5; i++) {
      const x = w * 0.43 + (i % 2) * 14 - 7;
      P.add({ shape: rigidCircle(20), x, y: gy - 300 - i * 70, friction: 0.5, restitution: 0.3, userData: COLORS[1] });
    }
    for (let i = 0; i < 4; i++) {
      P.add({ shape: rigidCircle(26 + i * 4), x: px - 20 + i * 60, y: h * 0.2 - i * 60, friction: 0.4, restitution: 0.2, userData: COLORS[5] });
    }
  }

  private tapAt(x: number, y: number): void {
    const hit = this.physics.queryPoint(x, y).find((b) => b.type === 'dynamic');
    if (hit) {
      hit.applyImpulse(this.rand.float(-200, 200) * hit.mass, -900 * hit.mass, x, y);
      return;
    }
    const kind = this.rand.int(0, 3);
    const look = COLORS[this.rand.int(0, COLORS.length - 1)]!;
    const shape =
      kind === 0
        ? rigidBox(this.rand.float(36, 80), this.rand.float(30, 60))
        : kind === 1
          ? rigidCircle(this.rand.float(16, 34))
          : kind === 2
            ? rigidPolygon([0, -30, 28, 20, -28, 20])
            : rigidPolygon(Array.from({ length: 5 }, (_, i) => ({ x: Math.cos((i * TAU) / 5) * 28, y: Math.sin((i * TAU) / 5) * 28 })));
    const b = this.physics.add({ shape, x, y, angle: this.rand.float(0, TAU), friction: 0.5, restitution: 0.1, userData: look });
    this.spawned.push(b);
    if (this.spawned.length > 60) this.physics.remove(this.spawned.shift()!);
  }

  private think(dt: number): void {
    this.time += dt;
    this.runPhysics(dt);
    const { w, h } = this.content;
    const r = this.ray;
    const ang = 0.45 + 0.35 * Math.sin(this.time * 0.8);
    r.x0 = 12;
    r.y0 = 110;
    const len = Math.hypot(w, h);
    const hit = this.physics.raycast(r.x0, r.y0, r.x0 + Math.cos(ang) * len, r.y0 + Math.sin(ang) * len);
    r.hit = hit !== null;
    r.x1 = hit ? hit.x : r.x0 + Math.cos(ang) * len;
    r.y1 = hit ? hit.y : r.y0 + Math.sin(ang) * len;
    r.nx = hit ? hit.nx : 0;
    r.ny = hit ? hit.ny : 0;
    const P = this.physics;
    this.hud.text = `刚体 ${P.bodies.length}  ·  休眠 ${this.sleepingCount()}  ·  接触 ${P.touches.length}  ·  ${this.ms.toFixed(2)} ms  ·  点击`;
  }

  private drawRay(ctx: Ctx2D): void {
    const r = this.ray;
    ctx.strokeStyle = 'rgba(248,113,113,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(r.x0, r.y0);
    ctx.lineTo(r.x1, r.y1);
    ctx.stroke();
    if (!r.hit) return;
    ctx.fillStyle = '#f87171';
    ctx.beginPath();
    ctx.arc(r.x1, r.y1, 6, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(r.x1, r.y1);
    ctx.lineTo(r.x1 + r.nx * 36, r.y1 + r.ny * 36);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------- plinko

interface Bin {
  count: number;
  label: Text;
}

/**
 * Plinko: balls drop through staggered pegs and two kinematic spinners into bins. Each bin has a sensor at the
 * bottom; its contactBegin counts the ball and removes it inside the callback (the world defers the removal).
 * Tap to drop a ball at that x.
 */
class RigidPlinkoScene extends RigidDemo {
  readonly title = 'Physics · Plinko';
  private readonly rand = new Rng(8);
  private bins: Bin[] = [];
  private balls = 0;
  private landed = 0;
  private timer = 0;

  protected build(): void {
    const view = this.addView();
    const { w, h } = this.content;
    const P = (this.physics = new RigidWorld({ gravity: 1400, interpolate: true }));
    view.add(new Paint((ctx) => this.drawBins(ctx), { id: 'bins' }));
    view.add(new Paint((ctx) => paintBodies(ctx, P), { id: 'bodies' }));
    this.debug = view.add(new RigidDebugView(P, { fill: false, lineWidth: 2 }, { id: 'debug', visible: false }));

    P.add({ name: 'floor', type: 'static', shape: rigidBox(w + 400, 200), x: w / 2, y: h + 80 });
    P.add({ name: 'wall-left', type: 'static', shape: rigidBox(200, h * 3), x: -100, y: h / 2 });
    P.add({ name: 'wall-right', type: 'static', shape: rigidBox(200, h * 3), x: w + 100, y: h / 2 });
    const peg: Look = { color: '#cbd5e1', edge: '#64748b' };
    const top = 330;
    const binH = 170;
    const dx = 68;
    const dy = 60;
    const x0 = w / 2 - Math.floor(w / 2 / dx) * dx;
    for (let row = 0, y = top; y < h - binH - 60; row++, y += dy) {
      const off = row % 2 === 0 ? 0 : dx / 2;
      for (let x = x0 + off; x < w - 24; x += dx) {
        if (x < 24) continue;
        P.add({ type: 'static', shape: rigidCircle(8), x, y, restitution: 0.4, userData: peg });
      }
    }
    const spin: Look = { color: '#38bdf8', edge: '#0369a1' };
    P.add({ name: 'spinner-left', type: 'kinematic', shape: rigidBox(170, 16), x: w * 0.3, y: 220, av: 2.4, userData: spin });
    P.add({ name: 'spinner-right', type: 'kinematic', shape: rigidBox(170, 16), x: w * 0.7, y: 220, av: -2.4, userData: spin });

    const n = Math.max(5, Math.floor(w / 100));
    const bw = w / n;
    const divider: Look = { color: '#64748b', edge: '#334155' };
    for (let i = 0; i < n; i++) {
      if (i > 0) P.add({ type: 'static', shape: rigidBox(10, binH), x: i * bw, y: h - 20 - binH / 2, userData: divider });
      P.add({ type: 'static', shape: rigidBox(bw - 16, 24), x: (i + 0.5) * bw, y: h - 34, sensor: true, userData: { bin: i } });
      const label = view.add(new Text('0', { fontSize: 30, fontWeight: 'bold', color: '#e2e8f0' }, { x: (i + 0.5) * bw, y: h - 100, anchor: 0.5 }));
      this.bins.push({ count: 0, label });
    }

    P.on('contactBegin', (e) => {
      if (!e.sensor) return;
      const sensor = e.a.sensor ? e.a : e.b;
      const ball = e.a.sensor ? e.b : e.a;
      const bin = (sensor.userData as { bin: number }).bin;
      if (ball.world === null) return;
      P.remove(ball);
      this.balls--;
      this.landed++;
      this.bins[bin]!.count++;
    });

    this.addHud();
    this.addButton('btn-debug', '调试', 0, () => (this.debug.visible = !this.debug.visible));
    view.onTap((e) => {
      const p = view.stageToWorld(e.x, e.y);
      this.drop(p.x);
    });
    for (let i = 0; i < 360; i++) this.advance(1 / 60);
    this.onUpdate((dt) => this.advance(dt));
  }

  private drop(x: number): void {
    if (this.balls >= 120) return;
    const { w } = this.content;
    this.physics.add({
      shape: rigidCircle(14),
      x: Math.min(w - 20, Math.max(20, x)),
      y: 120,
      vx: this.rand.float(-40, 40),
      friction: 0.1,
      restitution: 0.35,
      userData: COLORS[this.rand.int(0, COLORS.length - 1)],
    });
    this.balls++;
  }

  private advance(dt: number): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer += 0.28;
      this.drop(this.content.w / 2 + this.rand.float(-90, 90));
    }
    this.runPhysics(dt);
    for (const b of this.bins) b.label.text = String(b.count);
    this.hud.text = `球 ${this.balls}  ·  落袋 ${this.landed}  ·  接触 ${this.physics.touches.length}  ·  ${this.ms.toFixed(2)} ms  ·  点击投球`;
  }

  private drawBins(ctx: Ctx2D): void {
    for (const b of this.physics.bodies) {
      if (!b.sensor) continue;
      ctx.fillStyle = 'rgba(52,211,153,0.18)';
      ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    }
  }
}

export const scenes: Record<string, SceneFactory> = {
  'rigid-stack': () => new RigidStackScene(),
  'rigid-plinko': () => new RigidPlinkoScene(),
};
