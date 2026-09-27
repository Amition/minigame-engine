import {
  bakeTexture,
  Box,
  debugDraw,
  getDebugOverlay,
  hideDebugOverlay,
  Node,
  ParticleEmitter,
  particlePresets,
  Rng,
  roundRectPath,
  showDebugOverlay,
  spawnParticles,
  Sprite,
  TAU,
  Text,
  type DebugDrawOptions,
  type SceneFactory,
} from '@engine';
import { DemoScene } from '../common';

type Toggle = 'stats' | 'bounds' | 'hits' | 'draw';

interface Ball {
  n: Sprite;
  vx: number;
  vy: number;
}

const BALL_COLORS = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#38bdf8', '#a78bfa', '#f472b6'];

/**
 * Debug overlay: stats panel, node bounds, hit areas and one-frame debugDraw requests over 160 moving nodes and two
 * particle emitters. The toggles switch overlay parts; tap targets spawn sparks and leave a 1 s debugDraw marker.
 */
class DebugOverlayScene extends DemoScene {
  readonly title = 'Debug · Overlay';

  protected build(): void {
    const g = this.game;
    const { y: y0, w, h } = this.content;
    showDebugOverlay(g, { stats: true, bounds: true, hits: true, draw: true, corner: 'bottom-left' });

    const toggles: Toggle[] = ['stats', 'bounds', 'hits', 'draw'];
    const bw = 160;
    const gap = 16;
    const bx0 = (w - (toggles.length * bw + (toggles.length - 1) * gap)) / 2;
    toggles.forEach((name, i) => {
      const btn = this.add(new Box(bw, 88, {}, { id: `toggle-${name}`, x: bx0 + i * (bw + gap), y: y0 + 16 }));
      const label = btn.add(new Text('', { fontSize: 26, fontWeight: 'bold' }, { x: bw / 2, y: 44, anchor: 0.5 }));
      const paint = () => {
        const on = getDebugOverlay(g)?.options[name] ?? false;
        btn.setStyle({ fill: on ? '#2563eb' : '#2d3345', radius: 18 });
        label.text = name;
        label.setStyle({ color: on ? '#ffffff' : '#cbd5e1' });
      };
      paint();
      btn.onTap(() => {
        const on = getDebugOverlay(g)?.options[name] ?? false;
        showDebugOverlay(g, { [name]: !on });
        paint();
      });
    });

    const ax = 24;
    const ay = y0 + 128;
    const aw = w - 48;
    const ah = h - 144;
    const arena = this.add(new Node({ id: 'arena', tags: ['lint-ignore'], x: ax, y: ay, width: aw, height: ah }));
    arena.add(new Box(aw, ah, { fill: '#1b1f2a', stroke: '#2a3040', lineWidth: 2, radius: 16 }, { id: 'arena-bg' }));

    // One texture per colour at the screen's resolution ('auto'): the panel's texture line counts them.
    const ballTextures = BALL_COLORS.map((color, i) =>
      bakeTexture(
        34,
        34,
        (ctx, tw, th) => {
          roundRectPath(ctx, 1, 1, tw - 2, th - 2, 10);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.fillRect(7, 6, tw - 14, 5);
        },
        { resolution: 'auto', key: `debug-ball-${i}` },
      ),
    );
    const rng = new Rng(7);
    const balls: Ball[] = [];
    for (let i = 0; i < 160; i++) {
      const size = rng.float(18, 34);
      const n = arena.add(
        new Sprite(ballTextures[i % ballTextures.length]!, {
          width: size,
          height: size,
          x: rng.float(size, aw - size),
          y: rng.float(size, ah - size),
          anchor: 0.5,
          rotation: rng.float(0, TAU),
          alpha: 0.85,
        }),
      );
      const a = rng.float(0, TAU);
      const speed = rng.float(60, 220);
      balls.push({ n, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed });
    }

    const spinner = arena.add(
      new Box(140, 140, { fill: '#334155', stroke: '#94a3b8', lineWidth: 3, radius: 20 }, { id: 'spinner', x: aw / 2, y: ah * 0.4, anchor: 0.5 }),
    );
    spinner.onUpdate((dt) => (spinner.rotation += dt * 0.8));

    const fire = arena.add(new ParticleEmitter(particlePresets.fire({ seed: 3 }), { id: 'fx-fire', x: aw * 0.3, y: ah * 0.72, preset: 'fire' }));
    const sparkle = arena.add(
      new ParticleEmitter(particlePresets.sparkle({ seed: 4 }), { id: 'fx-sparkle', x: aw * 0.72, y: ah * 0.62, preset: 'sparkle' }),
    );

    const targets = [
      { id: 'target-a', x: aw * 0.15, y: ah * 0.12 },
      { id: 'target-b', x: aw * 0.62, y: ah * 0.1 },
      { id: 'target-c', x: aw * 0.8, y: ah * 0.86 },
    ];
    const markerStyle: DebugDrawOptions = { color: '#f472b6', width: 3, duration: 1, space: arena };
    for (const t of targets) {
      const box = arena.add(
        new Box(120, 72, { fill: '#0f766e', radius: 14 }, { id: t.id, x: t.x, y: t.y, anchor: 0.5, hitPadding: 12, zIndex: 5 }),
      );
      box.add(new Text('tap', { fontSize: 24, color: '#ffffff', fontWeight: 'bold' }, { x: 60, y: 36, anchor: 0.5 }));
      box.onTap(() => {
        spawnParticles(arena, 'hitSpark', { x: box.x, y: box.y, zIndex: 10 });
        debugDraw.circle(box.x, box.y, 90, markerStyle);
        debugDraw.text('tapped', box.x - 40, box.y + 50, markerStyle);
      });
    }

    // Styles are created once: per-frame debugDraw calls then allocate nothing.
    const velocity: DebugDrawOptions = { color: '#4ade80', width: 3, space: arena };
    const ring: DebugDrawOptions = { color: '#fbbf24', width: 2, space: arena };
    const label: DebugDrawOptions = { color: '#fde68a', size: 22, space: arena };
    const edge: DebugDrawOptions = { color: 'rgba(250,204,21,0.6)', width: 2, space: arena };
    const outline: DebugDrawOptions = { color: '#38bdf8', width: 2, space: arena };
    const pivot: DebugDrawOptions = { color: '#38bdf8', size: 14, space: arena };
    const hex: number[] = new Array<number>(12).fill(0);
    arena.onUpdate((dt) => {
      for (const b of balls) {
        const n = b.n;
        const r = n.width / 2;
        n.x += b.vx * dt;
        n.y += b.vy * dt;
        n.rotation += dt;
        if (n.x < r || n.x > aw - r) {
          b.vx = -b.vx;
          n.x = Math.min(aw - r, Math.max(r, n.x));
        }
        if (n.y < r || n.y > ah - r) {
          b.vy = -b.vy;
          n.y = Math.min(ah - r, Math.max(r, n.y));
        }
      }
      if (!debugDraw.enabled) return;
      for (let i = 0; i < 12; i++) {
        const b = balls[i]!;
        debugDraw.arrow(b.n.x, b.n.y, b.n.x + b.vx * 0.3, b.n.y + b.vy * 0.3, velocity);
      }
      debugDraw.circle(fire.x, fire.y, 80, ring);
      debugDraw.text(`fire ${fire.particleCount}`, fire.x + 88, fire.y - 12, label);
      debugDraw.circle(sparkle.x, sparkle.y, 80, ring);
      debugDraw.text(`sparkle ${sparkle.particleCount}`, sparkle.x - 60, sparkle.y - 118, label);
      for (let i = 0; i < 6; i++) {
        const a = spinner.rotation + (i * TAU) / 6;
        hex[i * 2] = spinner.x + Math.cos(a) * 118;
        hex[i * 2 + 1] = spinner.y + Math.sin(a) * 118;
      }
      debugDraw.polygon(hex, outline);
      debugDraw.point(spinner.x, spinner.y, pivot);
      debugDraw.rect(6, 6, aw - 12, ah - 12, edge);
    });

    this.add(
      new Text('arrows: velocity · rings: emitters · hexagon: spinner', { fontSize: 22, color: '#9aa3b8' }, {
        id: 'hint',
        x: w / 2,
        y: ay + 18,
        anchor: [0.5, 0],
        zIndex: 20,
      }),
    );
  }

  override onExit(): void {
    hideDebugOverlay(this.game);
  }
}

export const scenes: Record<string, SceneFactory> = {
  'debug-overlay': () => new DebugOverlayScene(),
};
