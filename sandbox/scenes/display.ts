import {
  AnimatedSprite,
  ArcProgress,
  bakeTexture,
  Box,
  CacheContainer,
  DashedLine,
  Graphics,
  MaskContainer,
  NineSlice,
  Node,
  ParticleEmitter,
  particlePresets,
  Rng,
  roundRectPath,
  ShadowBlob,
  spawnParticles,
  Sprite,
  TAU,
  Text,
  TilingSprite,
  Trail,
  type ParticleConfig,
  type ParticlePresetName,
  type SceneFactory,
  type SpriteFit,
  type Texture,
} from '@engine';
import { DemoScene } from '../common';

const label = (text: string, x: number, y: number, size = 22) =>
  new Text(text, { fontSize: size, color: '#9aa3b8' }, { x, y, anchor: [0.5, 0] });

/** Graphics: shapes, gradients, strokes (caps, joins, dashes), shadows, curves, even-odd holes, bake(). */
class DisplayGraphicsScene extends DemoScene {
  readonly title = 'Display · Graphics';

  protected build(): void {
    const { x: cx0, y: cy0, w } = this.content;
    const cols = 3;
    const cellW = w / cols;
    const cellH = 290;
    const cell = (i: number, name: string, make: (g: Graphics) => void, showBounds = true) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = cx0 + col * cellW + cellW / 2;
      const y = cy0 + 24 + row * cellH + 120;
      const id = name.replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '');
      const g = this.add(new Graphics({ id: `g-${id}`, x, y }));
      make(g);
      if (showBounds) {
        const b = g.bounds;
        this.add(
          new Graphics({ x, y }).rect(b.x, b.y, b.w, b.h).stroke('rgba(255,255,255,0.25)', 1, { dash: [4, 4] }),
        );
      }
      this.add(label(name, x, y + 132));
      return g;
    };

    cell(0, 'rect / roundRect', (g) =>
      g
        .rect(-90, -80, 80, 70)
        .fill('#3b82f6')
        .stroke('#bfdbfe', 4)
        .roundRect(0, -30, 90, 110, [30, 8, 30, 8])
        .fill('#f59e0b')
        .stroke('#fff7ed', 3, { join: 'round' }),
    );
    cell(1, 'circle / ellipse', (g) =>
      g
        .circle(-35, -20, 55)
        .fill('#10b981')
        .ellipse(40, 45, 60, 30, -0.4)
        .fill('rgba(236,72,153,0.85)')
        .stroke('#fff', 3),
    );
    cell(2, 'polygon / hexagon', (g) =>
      g
        .polygon([-95, 60, -45, -80, 5, 60])
        .fill('#8b5cf6')
        .regularPolygon(50, 0, 50, 6)
        .fill('#22d3ee')
        .stroke('#0e7490', 5, { join: 'round' }),
    );
    cell(3, 'star + linear', (g) =>
      g
        .star(0, 0, 5, 100, 42)
        .fill({ type: 'linear', x0: 0, y0: -100, x1: 0, y1: 90, stops: [[0, '#fde047'], [1, '#f97316']] })
        .stroke('#7c2d12', 4, { join: 'round' }),
    );
    cell(4, 'button + shadow', (g) =>
      g
        .roundRect(-100, -45, 200, 90, 45)
        .fill(
          { type: 'linear', x0: 0, y0: -45, x1: 0, y1: 45, stops: [[0, '#4ade80'], [1, '#15803d']] },
          { shadow: { color: 'rgba(0,0,0,0.6)', blur: 18, y: 10 } },
        )
        .roundRect(-88, -38, 176, 36, 18)
        .fill('rgba(255,255,255,0.25)'),
    );
    cell(5, 'radial orb', (g) =>
      g
        .circle(0, 0, 90)
        .fill({
          type: 'radial',
          x: 0,
          y: 0,
          r: 90,
          fx: -30,
          fy: -35,
          r0: 4,
          stops: [[0, '#ffffff'], [0.25, '#93c5fd'], [1, '#1e3a8a']],
        })
        .circle(0, 0, 90)
        .stroke('rgba(255,255,255,0.5)', 2),
    );
    cell(6, 'line caps', (g) => {
      const caps: CanvasLineCap[] = ['butt', 'round', 'square'];
      caps.forEach((cap, i) => {
        const y = -60 + i * 60;
        g.line(-80, y, 80, y).stroke('#f472b6', 22, { cap });
        g.line(-80, y, 80, y).stroke('#1f2937', 2);
      });
    });
    cell(7, 'line joins', (g) => {
      const joins: CanvasLineJoin[] = ['miter', 'round', 'bevel'];
      joins.forEach((join, i) => {
        const x = -70 + i * 70;
        g.polyline([x - 25, 60, x, -50, x + 25, 60]).stroke('#facc15', 16, { join });
      });
    });
    cell(8, 'dashes', (g) =>
      g
        .roundRect(-95, -85, 190, 80, 16)
        .stroke('#60a5fa', 5, { dash: [18, 10], cap: 'round' })
        .circle(0, 50, 45)
        .stroke('#f87171', 6, { dash: [4, 10], cap: 'round' })
        .line(-95, 115, 95, 115)
        .stroke('#a3e635', 4, { dash: [24, 8, 4, 8] }),
    );
    cell(9, 'quad / bezier', (g) =>
      g
        .moveTo(-95, -40)
        .quadTo(-50, -120, 0, -40)
        .quadTo(50, 40, 95, -40)
        .stroke('#38bdf8', 6, { cap: 'round' })
        .moveTo(0, 105)
        .bezierTo(-110, 30, -50, -35, 0, 20)
        .bezierTo(50, -35, 110, 30, 0, 105)
        .fill('#fb7185'),
    );
    cell(10, 'arc / pie', (g) =>
      g
        .moveTo(-45, 0)
        .arc(-45, 0, 55, 0.6, TAU - 0.6)
        .closePath()
        .fill('#fde047')
        .circle(-40, -28, 7)
        .fill('#111827')
        .arc(60, 0, 40, -Math.PI / 2, Math.PI * 0.75)
        .stroke('#34d399', 10, { cap: 'round' }),
    );
    const donut = cell(11, 'evenodd + bake()', (g) =>
      g
        .circle(-50, 0, 46)
        .circle(-50, 0, 22)
        .fill('#a78bfa', { rule: 'evenodd' })
        .stroke('#ede9fe', 3),
    );
    const tex = donut.bake(2);
    const b = donut.bounds;
    this.add(
      new Sprite(tex, { id: 'baked', x: donut.x + 55, y: donut.y, anchor: 0.5, scale: 0.8, rotation: 0.3, alpha: 0.9 }),
    );
    this.add(
      new Text(`bounds ${Math.round(b.w)}×${Math.round(b.h)}`, { fontSize: 18, color: '#6b7280' }, {
        x: donut.x,
        y: donut.y + 70,
        anchor: [0.5, 0],
      }),
    );
  }
}

/** Every particle preset in a grid; tap anywhere for bursts. */
class DisplayParticlesScene extends DemoScene {
  readonly title = 'Display · Particles';
  private tapCount = 0;

  protected build(): void {
    const { x: x0, y: y0, w, h } = this.content;
    const tapLayer = this.add(new Node({ id: 'tap-layer', x: 0, y: y0, width: this.width, height: h, interactive: true }));
    const tapEffects: ParticlePresetName[] = ['explosion', 'confetti', 'coinBurst', 'hitSpark'];
    tapLayer.onTap((e) => {
      const p = e.local();
      const name = tapEffects[this.tapCount++ % tapEffects.length]!;
      spawnParticles(this, name, { x: p.x, y: p.y + y0, zIndex: 10 });
    });

    const names: ParticlePresetName[] = [
      'explosion',
      'confetti',
      'coinBurst',
      'hitSpark',
      'sparkle',
      'magic',
      'fire',
      'smoke',
      'dust',
      'rain',
      'snow',
      'trail',
    ];
    const cols = 3;
    const pad = 12;
    const cellW = (w - pad * (cols + 1)) / cols;
    const cellH = Math.min(300, (h - 60 - pad * 5) / 4);
    // One-shot presets re-fire every 1.6s; phases are staggered so a snapshot shows most of them mid-effect.
    const oneShot: Partial<Record<ParticlePresetName, number>> = {
      explosion: 0.55,
      confetti: 0.1,
      coinBurst: 0.35,
      hitSpark: 0.9,
      dust: 0.65,
    };
    names.forEach((name, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cell = this.add(
        new Box(cellW, cellH, { fill: '#1b1f2a', stroke: '#2a3040', lineWidth: 2, radius: 16 }, {
          id: `cell-${name}`,
          x: x0 + pad + col * (cellW + pad),
          y: y0 + pad + row * (cellH + pad),
          clip: true,
        }),
      );
      cell.add(new Text(name, { fontSize: 22, color: '#7c8599' }, { x: 12, y: 8 }));
      const overrides: Partial<ParticleConfig> = { seed: i + 1 };
      const ex = cellW / 2;
      let ey = cellH * 0.6;
      if (name === 'rain' || name === 'snow') {
        ey = -10;
        overrides.spawn = { type: 'line', length: cellW };
        overrides.lifetime = name === 'rain' ? 0.32 : [2.5, 3.5];
        overrides.rate = name === 'rain' ? 40 : 12;
        overrides.prewarm = name === 'rain' ? 0.5 : 3;
        if (name === 'snow') overrides.speed = [50, 90];
      } else if (name === 'fire' || name === 'smoke') {
        ey = cellH * 0.85;
      } else if (name === 'confetti') {
        ey = cellH * 0.75;
        overrides.speed = [250, 480];
        overrides.gravity = 420;
      } else if (name === 'coinBurst') {
        ey = cellH * 0.9;
        overrides.speed = [300, 520];
      } else if (name === 'dust') {
        ey = cellH * 0.8;
      }
      const emitter = cell.add(new ParticleEmitter(particlePresets[name](overrides), { id: `fx-${name}`, x: ex, y: ey, preset: name }));
      const phase = oneShot[name];
      if (phase !== undefined) {
        let t = 0;
        let next = phase;
        emitter.onUpdate((dt) => {
          t += dt;
          if (t >= next) {
            next += 1.6;
            emitter.start();
          }
        });
      }
      if (name === 'trail') {
        let a = 0;
        const r = Math.min(cellW, cellH) * 0.3;
        const cx = cellW / 2;
        const cy = cellH / 2 + 14;
        emitter.spaceNode = cell;
        emitter.onUpdate((dt) => {
          a += dt * 3;
          emitter.setPosition(cx + Math.cos(a) * r * 1.3, cy + Math.sin(a * 2) * r * 0.7);
        });
      }
    });
    this.add(
      new Text('点击任意位置: explosion / confetti / coinBurst / hitSpark', { fontSize: 22, color: '#6b7280' }, {
        id: 'hint',
        x: this.width / 2,
        y: y0 + h - 40,
        anchor: [0.5, 0],
      }),
    );
  }
}

/** AnimatedSprite (baked frames), NineSlice, TilingSprite, masks, trail, arc progress, fit modes, cache. */
class DisplaySpritesScene extends DemoScene {
  readonly title = 'Display · Sprites';

  protected build(): void {
    const { x: x0, y: y0, w } = this.content;
    const left = x0 + Math.max(0, Math.round((w - 750) / 2));
    let y = y0;

    // --- Parallax TilingSprite band with animated characters
    const bandH = 230;
    this.add(new TilingSprite(skyTile(), w, bandH, { id: 'sky', x: x0, y, scrollX: -20 }));
    this.add(new TilingSprite(groundTile(), w, 64, { id: 'ground', x: x0, y: y + bandH - 64, scrollX: -90 }));
    const slime = this.add(
      new AnimatedSprite(
        { idle: { frames: slimeFrames(), fps: 8 }, hop: { frames: slimeFrames(true), fps: 14, loop: false, next: 'idle' } },
        { id: 'slime', x: left + 200, y: y + bandH - 58, anchor: [0.5, 1] },
      ),
    );
    this.addAt(new ShadowBlob(96, 22, { x: left + 200, y: y + bandH - 60 }), this.children.indexOf(slime));
    slime.onTap(() => slime.play('hop', true));
    this.add(new AnimatedSprite(coinFrames(), { id: 'coin', fps: 12, x: left + 520, y: y + 100, anchor: 0.5 }));
    this.add(new ShadowBlob(60, 16, { x: left + 520, y: y + bandH - 60, opacity: 0.25 }));
    y += bandH + 24;

    // --- NineSlice panels at several sizes
    const panel = panelTexture();
    const sizes: [number, number][] = [
      [140, 90],
      [230, 150],
      [320, 190],
    ];
    let px = left + 24;
    for (const [pw, ph] of sizes) {
      const ns = this.add(new NineSlice(panel, 18, pw, ph, { id: `panel-${pw}`, x: px, y }));
      ns.add(new Text(`${pw}×${ph}`, { fontSize: 24, color: '#dbe4ff' }, { x: pw / 2, y: ph / 2, anchor: 0.5 }));
      px += pw + 18;
    }
    y += 190 + 28;

    // --- Masks: circle avatar, rounded card, hexagon
    const maskSize = 170;
    const avatar = this.add(
      new MaskContainer({ type: 'circle' }, {
        id: 'mask-circle',
        x: left + 40,
        y,
        width: maskSize,
        height: maskSize,
        outline: { color: '#fbbf24', width: 6 },
      }),
    );
    avatar.add(new TilingSprite(checkerTile(), maskSize, maskSize, { scrollX: 40, scrollY: 25 }));
    avatar.add(new Graphics().circle(85, 70, 38).fill('#fde68a').ellipse(85, 170, 70, 55).fill('#fde68a'));
    const card = this.add(
      new MaskContainer({ type: 'roundRect', radius: 28 }, { id: 'mask-round', x: left + 280, y, width: maskSize, height: maskSize }),
    );
    card.add(new Box(maskSize, maskSize, { fill: '#1e40af' }));
    const stripe = card.add(new Box(60, 260, { fill: 'rgba(255,255,255,0.35)' }, { x: -60, y: -40, rotation: 0.4 }));
    stripe.onUpdate((dt) => {
      stripe.x += dt * 160;
      if (stripe.x > maskSize + 80) stripe.x = -120;
    });
    card.add(new Text('SHINE', { fontSize: 36, fontWeight: 'bold', color: '#ffffff' }, { x: 85, y: 85, anchor: 0.5 }));
    const hex = this.add(
      new MaskContainer(
        { type: 'polygon', points: hexPoints(85, 85, 85) },
        { id: 'mask-hex', x: left + 520, y, width: maskSize, height: maskSize, outline: { color: '#34d399', width: 5 } },
      ),
    );
    const photo = orbTexture();
    hex.add(new Sprite(photo, { width: maskSize, height: maskSize, fit: 'cover' }));
    y += maskSize + 36;

    // --- Trail, marching-ants dashed line, arc progress
    const rowH = 230;
    const rowY = y;
    const orbitC = { x: left + 150, y: rowY + rowH / 2 };
    const ball = new Graphics({ id: 'ball' }).circle(0, 0, 14).fill('#e0f2fe');
    this.add(new Trail({ id: 'trail', target: ball, thickness: 26, color: '#38bdf8', lifetime: 0.45 }));
    this.add(ball);
    const aim = this.add(new DashedLine([0, 0, 1, 1], { color: '#f472b6', thickness: 4, dashSpeed: 60, arrow: 22 }, { id: 'aim' }));
    const target = this.add(new Graphics({ id: 'aim-target', x: left + 330, y: rowY + rowH / 2 }).circle(0, 0, 12).stroke('#f472b6', 4));
    let t = 0;
    ball.onUpdate((dt) => {
      t += dt;
      ball.setPosition(orbitC.x + Math.cos(t * 2.2) * 110, orbitC.y + Math.sin(t * 4.4) * 70);
      aim.setEnds(ball.x, ball.y, target.x - 16, target.y);
    });
    const arcY = rowY + rowH / 2 - 56;
    const ring = this.add(new ArcProgress({ id: 'cooldown', radius: 56, thickness: 14, x: left + 380, y: arcY, color: '#22c55e' }));
    const pie = this.add(
      new ArcProgress({
        id: 'pie',
        radius: 56,
        mode: 'pie',
        x: left + 505,
        y: arcY,
        color: 'rgba(15,23,42,0.75)',
        trackColor: '#f59e0b',
      }),
    );
    const grad = this.add(
      new ArcProgress({
        id: 'grad-ring',
        radius: 56,
        thickness: 20,
        x: left + 630 - 8,
        y: arcY,
        startAngle: 180,
        clockwise: false,
        color: { type: 'linear', x0: 0, y0: 0, x1: 112, y1: 112, stops: [[0, '#f472b6'], [1, '#818cf8']] },
      }),
    );
    this.add(label('ring / pie / gradient', left + 562, arcY + 124, 20));
    let ct = 0;
    ring.onUpdate((dt) => {
      ct = (ct + dt / 3) % 1;
      ring.value = ct;
      pie.value = 1 - ct;
      grad.value = (ct * 1.7) % 1;
    });
    y += rowH + 20;

    // --- Sprite fit modes + CacheContainer
    const fits: SpriteFit[] = ['stretch', 'contain', 'cover', 'none'];
    fits.forEach((fit, i) => {
      const fx = left + 24 + i * 120;
      const frame = this.add(new Box(100, 70, { fill: '#0f172a', stroke: '#334155', lineWidth: 2 }, { x: fx, y, clip: true }));
      frame.add(new Sprite(photo, { id: `fit-${fit}`, width: 100, height: 70, fit }));
      this.add(label(fit, fx + 50, y + 76, 20));
    });
    const cache = this.add(new CacheContainer(210, 110, { id: 'cache', x: left + 512, y: y - 10 }));
    cache.add(new Box(210, 110, { fill: '#111827', radius: 14 }));
    const rng = new Rng(7);
    const stars = new Graphics();
    for (let i = 0; i < 60; i++) {
      stars.star(rng.float(12, 198), rng.float(12, 98), 5, rng.float(4, 10)).fill(rng.pick(['#fde047', '#f9a8d4', '#93c5fd', '#ffffff']));
    }
    cache.add(stars);
    cache.add(new Text('cached', { fontSize: 20, color: '#e5e7eb' }, { x: 105, y: 55, anchor: 0.5 }));
  }
}

// ------------------------------------------------------------------ baked demo art

function slimeFrames(hop = false): Texture[] {
  const n = hop ? 8 : 6;
  const out: Texture[] = [];
  for (let i = 0; i < n; i++) {
    out.push(
      bakeTexture(
        130,
        150,
        (ctx, w, h) => {
          const t = i / n;
          const lift = hop ? Math.sin(t * Math.PI) * 50 : 0;
          const squash = hop ? 1 + 0.25 * Math.cos(t * TAU) : 1 + 0.12 * Math.sin(t * TAU);
          const bw = 100 * squash;
          const bh = 80 / squash;
          const cx = w / 2;
          const by = h - 4 - lift;
          const g = ctx.createLinearGradient(0, by - bh, 0, by);
          g.addColorStop(0, '#86efac');
          g.addColorStop(1, '#16a34a');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(cx - bw / 2, by);
          ctx.bezierCurveTo(cx - bw / 2, by - bh * 1.2, cx + bw / 2, by - bh * 1.2, cx + bw / 2, by);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.45)';
          ctx.beginPath();
          ctx.ellipse(cx - bw * 0.2, by - bh * 0.7, bw * 0.12, bh * 0.08, -0.5, 0, TAU);
          ctx.fill();
          ctx.fillStyle = '#052e16';
          for (const dx of [-16, 16]) {
            ctx.beginPath();
            ctx.ellipse(cx + dx * squash, by - bh * 0.45, 6, 9 / squash, 0, 0, TAU);
            ctx.fill();
          }
        },
        { resolution: 2, key: `demo-slime-${hop ? 'hop' : 'idle'}#${i}` },
      ),
    );
  }
  return out;
}

function coinFrames(): Texture[] {
  const out: Texture[] = [];
  for (let i = 0; i < 8; i++) {
    out.push(
      bakeTexture(
        90,
        90,
        (ctx, w, h) => {
          const sx = Math.max(0.1, Math.abs(Math.cos((i / 8) * Math.PI)));
          ctx.translate(w / 2, h / 2);
          ctx.scale(sx, 1);
          ctx.fillStyle = '#b45309';
          ctx.beginPath();
          ctx.arc(0, 0, 40, 0, TAU);
          ctx.fill();
          const g = ctx.createRadialGradient(-12, -14, 4, 0, 0, 36);
          g.addColorStop(0, '#fff7c2');
          g.addColorStop(0.5, '#fbbf24');
          g.addColorStop(1, '#d97706');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(0, 0, 34, 0, TAU);
          ctx.fill();
          ctx.fillStyle = '#b45309';
          ctx.font = 'bold 40px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('$', 0, 2);
        },
        { resolution: 2, key: `demo-coin#${i}` },
      ),
    );
  }
  return out;
}

function panelTexture(): Texture {
  return bakeTexture(
    60,
    60,
    (ctx) => {
      ctx.fillStyle = '#7aa2ff';
      ctx.beginPath();
      roundRectPath(ctx, 1, 1, 58, 58, 16);
      ctx.fill();
      const g = ctx.createLinearGradient(0, 4, 0, 56);
      g.addColorStop(0, '#34406a');
      g.addColorStop(1, '#1e2542');
      ctx.fillStyle = g;
      ctx.beginPath();
      roundRectPath(ctx, 5, 5, 50, 50, 12);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(16, 8, 28, 3);
    },
    { resolution: 2, key: 'demo-panel' },
  );
}

function skyTile(): Texture {
  return bakeTexture(
    300,
    230,
    (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#1e3a8a');
      g.addColorStop(1, '#60a5fa');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (const [cx, cy, s] of [
        [70, 60, 1],
        [220, 110, 0.7],
      ] as const) {
        ctx.beginPath();
        ctx.arc(cx, cy, 26 * s, 0, TAU);
        ctx.arc(cx + 30 * s, cy - 10 * s, 30 * s, 0, TAU);
        ctx.arc(cx + 62 * s, cy, 24 * s, 0, TAU);
        ctx.fill();
      }
    },
    { key: 'demo-sky' },
  );
}

function groundTile(): Texture {
  return bakeTexture(
    64,
    64,
    (ctx, w, h) => {
      ctx.fillStyle = '#7c4a1e';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(0, 0, w, 14);
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(0, 14, w, 4);
      ctx.fillStyle = '#5b3413';
      ctx.fillRect(8, 30, 14, 8);
      ctx.fillRect(38, 46, 16, 8);
    },
    { resolution: 2, key: 'demo-ground' },
  );
}

function checkerTile(): Texture {
  return bakeTexture(
    40,
    40,
    (ctx) => {
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(0, 0, 40, 40);
      ctx.fillStyle = '#a78bfa';
      ctx.fillRect(0, 0, 20, 20);
      ctx.fillRect(20, 20, 20, 20);
    },
    { key: 'demo-checker' },
  );
}

function orbTexture(): Texture {
  const g = new Graphics()
    .rect(0, 0, 200, 120)
    .fill({ type: 'linear', x0: 0, y0: 0, x1: 200, y1: 120, stops: [[0, '#0ea5e9'], [1, '#6366f1']] })
    .circle(100, 60, 44)
    .fill({ type: 'radial', x: 100, y: 60, r: 44, fx: 86, fy: 44, stops: [[0, '#ffffff'], [1, '#f59e0b']] })
    .star(100, 60, 5, 20)
    .fill('#b45309');
  return g.bake(2, { padding: 0 });
}

function hexPoints(cx: number, cy: number, r: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * TAU) / 6;
    out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return out;
}

export const scenes: Record<string, SceneFactory> = {
  'display-graphics': () => new DisplayGraphicsScene(),
  'display-particles': () => new DisplayParticlesScene(),
  'display-sprites': () => new DisplaySpritesScene(),
};
