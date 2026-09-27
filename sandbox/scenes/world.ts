import {
  approach,
  ArcadeBody,
  bakeTexture,
  Box,
  clamp,
  DepthSortLayer,
  gridDistanceField,
  GroundObject,
  IsoMap,
  IsoObject,
  Node,
  ParallaxLayer,
  PathFollower,
  PerspectiveRoad,
  PhysicsWorld,
  Rng,
  roundRectPath,
  TAU,
  Text,
  TileMap,
  World,
  type Ctx2D,
  type IsoLegendEntry,
  type NodeOptions,
  type RoadObject,
  type RoadSprite,
  type SceneFactory,
  type Texture,
  type TileDrawFn,
  type TileLegend,
  type Vec2,
} from '@engine';
import { DemoScene } from '../common';

// ---------------------------------------------------------------- shared helpers

/** Deterministic hash of integer coords → [0, 1), for procedural decoration. */
function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

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

function circle(ctx: Ctx2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function poly(ctx: Ctx2D, color: string, pts: number[]): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
  ctx.closePath();
  ctx.fill();
}

abstract class WorldDemo extends DemoScene {
  protected hud!: Text;

  /** A World filling the content area, inserted below the title bar so taps on the bar never reach it. */
  protected addWorld(index = 1): World {
    const { x, y, w, h } = this.content;
    return this.addAt(new World({ id: 'world', x, y, width: w, height: h }), index);
  }

  protected addHud(text: string): Text {
    const { x, y, w } = this.content;
    const panel = this.add(new Box(w - 32, 60, { fill: 'rgba(12,14,20,0.72)', radius: 18 }, { id: 'hud-panel', x: x + 16, y: y + 16 }));
    this.hud = panel.add(new Text(text, { fontSize: 23, color: '#e6e9f2' }, { id: 'hud', x: 20, y: 30, anchor: [0, 0.5] }));
    return this.hud;
  }
}

// ---------------------------------------------------------------- top-down

const TD_TILE = 64;

const TOPDOWN_MAP = [
  '##############################',
  '#..T...............~~~.,,,...#',
  '#...........T......~~~.c.,...#',
  '#...............:::===::::::.#',
  '#......####.....:...~~~....:.#',
  '#......#..#.....:...~~~....:.#',
  '#.T....#c.......:...~~~.T..:.#',
  '#......#..#..T..:b..~~~..c.:.#',
  '#......##.#.....:....~~~..T:.#',
  '#.c..T......r...:...T~~~...:.#',
  '#...............:.T..~~~...:.#',
  '#..,,,.......T..:....~~~...:.#',
  '#..,c,..T.......::::::===:::.#',
  '#...,...........:..c..~~~....#',
  '#...........b...:.....~~~....#',
  '#.T.......:::::::.....~~~..T.#',
  '#.........:............~~~...#',
  '#.~~~.T...:...........~~~~...#',
  '#.~~~.....:...T......~~~~~~..#',
  '#..~......:.........~~~~~~~~.#',
  '#..#.r....:.,,.....~~~~~~~~~~#',
  '#..#c.....:.,c,....~~~~~~~~~~#',
  '#..#....T.:..,....r~~~~~~~~~~#',
  '#..####...:........~~~~~~~~~~#',
  '#.........:..T.....~~~~~~~~~~#',
  '#.........:........~~~~~~~~~~#',
  '#.T.......P::::::...~~~~~~~~.#',
  '#......r......c......~~~~~~..#',
  '#.....T............T.........#',
  '##############################',
];

const isWater = (id: number) => id === 4 || id === 6;
const isWalkway = (id: number) => id === 5 || id === 6;

function grassBlades(ctx: Ctx2D, x: number, y: number, w: number, h: number, tx: number, ty: number, n: number): void {
  ctx.strokeStyle = '#4b8735';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const bx = x + 12 + hash2(tx, ty, i * 2 + 1) * (w - 24);
    const by = y + 14 + hash2(tx, ty, i * 2 + 2) * (h - 24);
    ctx.moveTo(bx - 5, by + 5);
    ctx.lineTo(bx - 3, by - 3);
    ctx.moveTo(bx, by + 5);
    ctx.lineTo(bx + 1, by - 6);
    ctx.moveTo(bx + 5, by + 5);
    ctx.lineTo(bx + 5, by - 2);
  }
  ctx.stroke();
}

const tdGrass: TileDrawFn = (ctx, x, y, w, h, { tx, ty }) => {
  ctx.fillStyle = hash2(tx, ty, 9) < 0.5 ? '#5f9e45' : '#61a046';
  ctx.fillRect(x, y, w, h);
  grassBlades(ctx, x, y, w, h, tx, ty, hash2(tx, ty, 3) < 0.5 ? 1 : 2);
};

const FLOWER_COLORS = ['#fef08a', '#fda4af', '#f8fafc', '#c4b5fd'];

const tdFlowers: TileDrawFn = (ctx, x, y, w, h, info) => {
  ctx.fillStyle = '#579a3e';
  ctx.fillRect(x, y, w, h);
  grassBlades(ctx, x, y, w, h, info.tx, info.ty, 3);
  for (let i = 0; i < 5; i++) {
    const fx = x + 8 + hash2(info.tx, info.ty, 20 + i) * (w - 16);
    const fy = y + 8 + hash2(info.tx, info.ty, 30 + i) * (h - 16);
    circle(ctx, fx, fy, 4.5, FLOWER_COLORS[i % FLOWER_COLORS.length]!);
    circle(ctx, fx, fy, 1.8, '#f59e0b');
  }
};

const tdPath: TileDrawFn = (ctx, x, y, w, h, { tx, ty, map }) => {
  ctx.fillStyle = '#d7b77c';
  ctx.fillRect(x, y, w, h);
  const m = map.mask4(tx, ty, isWalkway);
  ctx.fillStyle = '#c09a5c';
  if (!(m & 1)) ctx.fillRect(x, y, w, 5);
  if (!(m & 2)) ctx.fillRect(x + w - 5, y, 5, h);
  if (!(m & 4)) ctx.fillRect(x, y + h - 5, w, 5);
  if (!(m & 8)) ctx.fillRect(x, y, 5, h);
  ctx.fillStyle = '#b8935a';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.ellipse(x + 10 + hash2(tx, ty, 40 + i) * (w - 20), y + 10 + hash2(tx, ty, 50 + i) * (h - 20), 3.5, 2.5, 0, 0, TAU);
    ctx.fill();
  }
};

const tdWater: TileDrawFn = (ctx, x, y, w, h, { tx, ty, map }) => {
  ctx.fillStyle = '#3f8fd4';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#6cb0e8';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (let i = 0; i < 2; i++) {
    const cx = x + 14 + hash2(tx, ty, 60 + i) * (w - 28);
    const cy = y + 14 + hash2(tx, ty, 70 + i) * (h - 28);
    ctx.beginPath();
    ctx.arc(cx, cy, 9, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  }
  const m = map.mask4(tx, ty, isWater);
  const sides: [number, number, number, number, number][] = [
    [1, x, y, w, 0],
    [2, x + w, y, 0, h],
    [4, x, y + h, w, 0],
    [8, x, y, 0, h],
  ];
  for (const [bit, sx, sy, sw, sh] of sides) {
    if (m & bit) continue;
    const nx = sw === 0 ? (bit === 2 ? -1 : 1) : 0;
    const ny = sh === 0 ? (bit === 4 ? -1 : 1) : 0;
    ctx.fillStyle = '#e2c98f';
    ctx.fillRect(nx < 0 ? sx - 7 : sx, ny < 0 ? sy - 7 : sy, sw || 7, sh || 7);
    ctx.fillStyle = 'rgba(220,240,252,0.85)';
    ctx.fillRect(nx < 0 ? sx - 11 : nx > 0 ? sx + 7 : sx, ny < 0 ? sy - 11 : ny > 0 ? sy + 7 : sy, sw || 4, sh || 4);
  }
};

const tdBridge: TileDrawFn = (ctx, x, y, w, h, info) => {
  tdWater(ctx, x, y, w, h, info);
  const m = info.map.mask4(info.tx, info.ty, (id) => id === 4);
  const across = (m & 1) !== 0 || (m & 4) !== 0;
  ctx.save();
  if (!across) {
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(Math.PI / 2);
    ctx.translate(-(x + w / 2), -(y + h / 2));
  }
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(x, y + 12, w, h - 16);
  ctx.fillStyle = '#b07a43';
  ctx.fillRect(x, y + 8, w, h - 16);
  ctx.fillStyle = '#8c5b2d';
  for (let px = x + 10; px < x + w; px += 12) ctx.fillRect(px, y + 8, 2, h - 16);
  ctx.fillStyle = '#6b4423';
  ctx.fillRect(x, y + 6, w, 5);
  ctx.fillRect(x, y + h - 11, w, 5);
  ctx.restore();
};

const tdWall: TileDrawFn = (ctx, x, y, w, h, { tx, ty, map }) => {
  const face = map.getTile(tx, ty + 1) === 1 ? 0 : 20;
  ctx.fillStyle = '#868c97';
  ctx.fillRect(x, y, w, h - face);
  ctx.fillStyle = '#9aa1ac';
  ctx.fillRect(x + 4, y + 4, w - 8, h - face - 8);
  ctx.fillStyle = '#7b818c';
  ctx.fillRect(x + 4, y + (h - face) / 2 - 1, w - 8, 2);
  ctx.fillRect(x + (hash2(tx, ty, 5) < 0.5 ? w / 3 : (2 * w) / 3), y + 4, 2, (h - face) / 2 - 4);
  if (face) {
    ctx.fillStyle = '#5c616c';
    ctx.fillRect(x, y + h - face, w, face);
    ctx.fillStyle = '#4a4e58';
    ctx.fillRect(x + w / 2 - 1, y + h - face, 2, face);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x, y + h - 4, w, 4);
  }
};

const tdRock: TileDrawFn = (ctx, x, y, w, h, info) => {
  tdGrass(ctx, x, y, w, h, info);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(x + w / 2 + 3, y + h * 0.7, w * 0.36, h * 0.16, 0, 0, TAU);
  ctx.fill();
  poly(ctx, '#80848d', [x + 12, y + 44, x + 18, y + 22, x + 34, y + 14, x + 50, y + 22, x + 54, y + 42, x + 40, y + 50, x + 22, y + 50]);
  poly(ctx, '#a9adb6', [x + 18, y + 24, x + 34, y + 16, x + 46, y + 23, x + 34, y + 30, x + 22, y + 32]);
};

const TD_LEGEND: TileLegend = {
  '#': { id: 1, name: 'wall', solid: true, draw: tdWall },
  '.': { id: 2, name: 'grass', cost: 2, draw: tdGrass },
  ',': { id: 3, name: 'flowers', cost: 3, draw: tdFlowers },
  '~': { id: 4, name: 'water', solid: true, draw: tdWater },
  ':': { id: 5, name: 'path', cost: 1, draw: tdPath },
  '=': { id: 6, name: 'bridge', cost: 1, draw: tdBridge },
  T: { id: 7, name: 'tree', solid: true, draw: tdGrass, marker: 'tree' },
  r: { id: 8, name: 'rock', solid: true, draw: tdRock },
  P: { id: 5, marker: 'player' },
  c: { id: 2, marker: 'coin' },
  b: { id: 2, marker: 'barrel' },
};

const TD_MINIMAP: Record<number, string> = { 1: '#6b7280', 2: '#5e9d44', 3: '#6aa84f', 4: '#3f8fd4', 5: '#d7b77c', 6: '#b07a43', 7: '#2f6e2c', 8: '#8a8f99' };

class TopTree extends GroundObject {
  private readonly variant: number;

  constructor(x: number, y: number, variant: number) {
    super({ x, y, width: 108, height: 140, anchor: [0.5, 1], shadowRadius: 38, shadowAlpha: 0.3 });
    this.variant = variant;
  }

  override draw(ctx: Ctx2D): void {
    const w = this.width;
    const h = this.height;
    ctx.fillStyle = '#6f4426';
    ctx.fillRect(w / 2 - 8, h - 46, 16, 44);
    ctx.fillStyle = '#5a361d';
    ctx.fillRect(w / 2 + 2, h - 46, 6, 44);
    const [dark, mid, light] = this.variant === 0 ? ['#2f7437', '#3c8c3f', '#57a94f'] : ['#2a6a43', '#357f50', '#4f9d66'];
    circle(ctx, w / 2, 64, 44, dark);
    circle(ctx, w / 2 - 24, 74, 28, dark);
    circle(ctx, w / 2 + 24, 72, 28, dark);
    circle(ctx, w / 2 - 6, 56, 36, mid);
    circle(ctx, w / 2 + 16, 62, 26, mid);
    circle(ctx, w / 2 - 14, 44, 20, light);
    circle(ctx, w / 2 + 8, 36, 12, light);
  }
}

class TopCoin extends GroundObject {
  collected = false;
  private t: number;

  constructor(x: number, y: number, phase: number) {
    super({ x, y, width: 30, height: 30, anchor: [0.5, 1], z: 18, gravity: 0, shadowRadius: 11, shadowAlpha: 0.25 });
    this.t = phase;
  }

  override update(dt: number): void {
    this.t += dt;
    if (this.collected) {
      this.z += 320 * dt;
      this.alpha = Math.max(0, this.alpha - dt * 2.5);
      if (this.alpha <= 0) this.visible = false;
      return;
    }
    this.z = 18 + Math.sin(this.t * 3) * 5;
  }

  override draw(ctx: Ctx2D): void {
    const sx = Math.abs(Math.cos(this.t * 2.2)) * 0.8 + 0.2;
    ctx.save();
    ctx.translate(15, 15);
    ctx.scale(sx, 1);
    circle(ctx, 0, 0, 14, '#d48b0b');
    circle(ctx, 0, 0, 10.5, '#fcd34d');
    ctx.fillStyle = '#fff4c2';
    ctx.fillRect(-2, -7, 4, 14);
    ctx.restore();
  }
}

class TopBarrel extends GroundObject {
  constructor(x: number, y: number) {
    super({ x, y, width: 44, height: 54, anchor: [0.5, 0.88], shadowRadius: 24 });
  }

  override draw(ctx: Ctx2D): void {
    ctx.fillStyle = '#8b5a2b';
    ctx.beginPath();
    roundRectPath(ctx, 2, 8, 40, 42, 10);
    ctx.fill();
    ctx.fillStyle = '#a86f38';
    ctx.fillRect(8, 10, 8, 38);
    ctx.fillStyle = '#4b5563';
    ctx.fillRect(2, 18, 40, 4);
    ctx.fillRect(2, 38, 40, 4);
    ctx.fillStyle = '#b98246';
    ctx.beginPath();
    ctx.ellipse(22, 9, 19, 7, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#6b4423';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

/** Little walking character drawn with its feet at the bottom center. */
class Walker extends GroundObject {
  facing = 1;
  phase = 0;
  moving = false;
  private readonly shirt: string;

  constructor(shirt: string, opts: NodeOptions & { shadowRadius?: number } = {}) {
    super({ width: 48, height: 72, anchor: [0.5, 1], shadowRadius: 18, gravity: 1500, ...opts });
    this.shirt = shirt;
  }

  override draw(ctx: Ctx2D): void {
    const cx = this.width / 2;
    const swing = this.moving && this.z <= 0 ? Math.sin(this.phase) * 6 : 0;
    const bob = this.moving ? Math.abs(Math.sin(this.phase)) * 2.5 : 0;
    ctx.fillStyle = '#334155';
    ctx.fillRect(cx - 9 + swing * 0.5, 54 - bob, 7, 16);
    ctx.fillRect(cx + 2 - swing * 0.5, 54 - bob, 7, 16);
    ctx.fillStyle = this.shirt;
    ctx.beginPath();
    roundRectPath(ctx, cx - 14, 32 - bob, 28, 26, 9);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(cx - 14, 50 - bob, 28, 4);
    circle(ctx, cx, 20 - bob, 15, '#fcd9b6');
    ctx.fillStyle = '#3f2a1d';
    ctx.beginPath();
    ctx.arc(cx, 17 - bob, 15, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    circle(ctx, cx + this.facing * 4 - 5, 22 - bob, 2.2, '#1f2937');
    circle(ctx, cx + this.facing * 4 + 5, 22 - bob, 2.2, '#1f2937');
  }
}

/**
 * Top-down 2.5D: ASCII tile map (chunk-prerendered), camera follow with deadzone/look-ahead/bounds, depth-sorted
 * trees/coins/barrels, circle bodies vs tiles, distance-field + A* auto-walk, tap to walk, minimap.
 */
class TopDownScene extends WorldDemo {
  readonly title = 'World · Top-down';
  private world!: World;
  private map!: TileMap;
  private actors!: DepthSortLayer;
  private physics!: PhysicsWorld;
  private hero!: ArcadeBody;
  private heroNode!: Walker;
  private coins: TopCoin[] = [];
  private route: Vec2[] = [];
  private goal: Vec2 | null = null;
  private idle = 0;
  private stuck = 0;
  private hop = 1.5;
  private collected = 0;
  private time = 0;
  private readonly rand = new Rng(11);

  protected build(): void {
    const world = (this.world = this.addWorld());
    const map = (this.map = TileMap.fromAscii(TOPDOWN_MAP, TD_LEGEND, TD_TILE, { id: 'map' }));
    world.add(map);
    const physics = (this.physics = new PhysicsWorld());
    physics.attach(this.game, this);
    physics.addTileMap(map);

    world.add(new Paint((ctx) => this.drawRoute(ctx), { id: 'route' }));
    const actors = (this.actors = world.add(new DepthSortLayer({ id: 'actors' })));
    map.markers('tree').forEach((t, i) => {
      const p = map.tileToWorld(t.x, t.y);
      actors.add(new TopTree(p.x, p.y + 20, i % 2));
    });
    map.markers('coin').forEach((c, i) => {
      const p = map.tileToWorld(c.x, c.y);
      const coin = actors.add(new TopCoin(p.x, p.y, i * 0.7));
      this.coins.push(coin);
      physics.add({ x: p.x, y: p.y - 8, radius: 18, sensor: true, immovable: true, collideTiles: false, data: { coin } });
    });
    for (const b of map.markers('barrel')) {
      const p = map.tileToWorld(b.x, b.y);
      physics.add({ x: p.x, y: p.y, radius: 20, mass: 0.6, drag: 6, node: actors.add(new TopBarrel(p.x, p.y)) });
    }
    const spawn = map.markerWorld('player');
    this.heroNode = actors.add(new Walker('#2563eb', { id: 'player' }));
    this.hero = physics.add({ id: 'hero', x: spawn.x, y: spawn.y, radius: 16, node: this.heroNode });
    this.hero.onOverlap = (other) => {
      const coin = other.data.coin;
      if (coin instanceof TopCoin && !coin.collected) this.collect(coin, other);
    };

    const cam = world.camera;
    cam.zoom = 1.1;
    cam.bounds = { x: 0, y: 0, w: map.width, h: map.height };
    cam.follow(this.hero, { lerp: 5, deadzoneWidth: 90, deadzoneHeight: 140, lookAhead: 0.35, maxLookAhead: 140, snap: true });

    world.onTap((e) => {
      const p = world.stageToWorld(e.x, e.y);
      this.goTo(p.x, p.y);
    });

    this.addHud('');
    this.addMinimap();
    this.onUpdate((dt) => this.think(dt));
    this.planNext();
  }

  private collect(coin: TopCoin, body: ArcadeBody): void {
    coin.collected = true;
    this.physics.remove(body);
    this.collected++;
    this.world.camera.shake(0.28);
    this.heroNode.jump(460);
  }

  private goTo(wx: number, wy: number): void {
    const hero = this.hero;
    const path = this.map.findWorldPath(hero.x, hero.y, wx, wy, { diagonal: true, nearest: true });
    this.route = path ? path.slice(1) : [];
    this.goal = path ? path[path.length - 1]! : null;
    this.idle = 0;
    this.stuck = 0;
  }

  /** Walks to the closest remaining coin by walking cost (Dijkstra field from the hero's tile). */
  private planNext(): void {
    const left = this.coins.filter((c) => !c.collected);
    if (left.length === 0) {
      const p = this.map.markerWorld('player');
      this.goTo(p.x, p.y);
      return;
    }
    const map = this.map;
    const start = map.worldToTile(this.hero.x, this.hero.y);
    const field = gridDistanceField(map, [start], { diagonal: true });
    let best: TopCoin | null = null;
    let bestD = Infinity;
    for (const c of left) {
      const t = map.worldToTile(c.x, c.y);
      const d = field[t.y * map.cols + t.x]!;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best) this.goTo(best.x, best.y);
  }

  private think(dt: number): void {
    this.time += dt;
    const hero = this.hero;
    const node = this.heroNode;
    if (this.route.length === 0) {
      hero.vx = approach(hero.vx, 0, 1400 * dt);
      hero.vy = approach(hero.vy, 0, 1400 * dt);
      this.idle += dt;
      if (this.idle > 0.7) this.planNext();
    } else {
      const wp = this.route[0]!;
      const dx = wp.x - hero.x;
      const dy = wp.y - hero.y;
      const d = Math.hypot(dx, dy);
      if (d < (this.route.length === 1 ? 6 : 24)) {
        this.route.shift();
      } else {
        const k = Math.min(1, dt * 10);
        hero.vx += ((dx / d) * 240 - hero.vx) * k;
        hero.vy += ((dy / d) * 240 - hero.vy) * k;
      }
      if (hero.speed < 40) {
        this.stuck += dt;
        if (this.stuck > 0.8 && this.goal) this.goTo(this.goal.x, this.goal.y);
      } else {
        this.stuck = 0;
      }
    }
    node.moving = hero.speed > 20;
    if (Math.abs(hero.vx) > 12) node.facing = Math.sign(hero.vx);
    node.phase += dt * hero.speed * 0.06;
    this.hop -= dt;
    if (this.hop <= 0) {
      node.jump(420);
      this.hop = 2.5 + this.rand.float(0, 2.5);
    }
    if (this.coins.every((c) => c.collected) && this.route.length === 0 && this.idle > 2) {
      for (const c of this.coins) {
        c.collected = false;
        c.alpha = 1;
        c.visible = true;
        this.physics.add({ x: c.x, y: c.y - 8, radius: 18, sensor: true, immovable: true, collideTiles: false, data: { coin: c } });
      }
    }
    const map = this.map;
    this.hud.text = `金币 ${this.collected}  ·  点击地图行走  ·  区块 ${map.drawnChunks}/${map.bakedChunks}  ·  剔除 ${this.world.culledCount + this.actors.culledCount}`;
  }

  private drawRoute(ctx: Ctx2D): void {
    if (this.route.length === 0) return;
    let px = this.hero.x;
    let py = this.hero.y;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (const p of this.route) {
      const d = Math.hypot(p.x - px, p.y - py);
      const n = Math.max(1, Math.floor(d / 18));
      for (let i = 1; i <= n; i++) {
        ctx.beginPath();
        ctx.arc(px + ((p.x - px) * i) / n, py + ((p.y - py) * i) / n, 3.5, 0, TAU);
        ctx.fill();
      }
      px = p.x;
      py = p.y;
    }
    const r = 16 + Math.sin(this.time * 6) * 3;
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(px, py, r, r * 0.6, 0, 0, TAU);
    ctx.stroke();
  }

  private addMinimap(): void {
    const map = this.map;
    const k = 5;
    const mw = map.cols * k;
    const mh = map.rows * k;
    const tex: Texture = bakeTexture(mw, mh, (ctx) => {
      for (let ty = 0; ty < map.rows; ty++) {
        for (let tx = 0; tx < map.cols; tx++) {
          ctx.fillStyle = TD_MINIMAP[map.getTile(tx, ty)] ?? '#000000';
          ctx.fillRect(tx * k, ty * k, k, k);
        }
      }
    });
    const { x, y, w } = this.content;
    const cam = this.world.camera;
    this.add(
      new Paint(
        (ctx) => {
          ctx.fillStyle = 'rgba(12,14,20,0.72)';
          ctx.beginPath();
          roundRectPath(ctx, -8, -8, mw + 16, mh + 16, 12);
          ctx.fill();
          tex.draw(ctx, 0, 0, mw, mh);
          const sx = mw / map.width;
          const sy = mh / map.height;
          for (const c of this.coins) if (!c.collected) circle(ctx, c.x * sx, c.y * sy, 2.5, '#fcd34d');
          circle(ctx, this.hero.x * sx, this.hero.y * sy, 4, '#ffffff');
          const v = cam.visibleRect();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(v.x * sx, v.y * sy, v.w * sx, v.h * sy);
        },
        { id: 'minimap', x: x + w - mw - 28, y: y + 100, width: mw, height: mh },
      ),
    );
  }
}

// ---------------------------------------------------------------- isometric

const ISO_HEIGHTS = [
  '0000000000000000',
  '0000111111100000',
  '0001112222111000',
  '0011222333221100',
  '0112223344322110',
  '0112233455432110',
  '0122334566543210',
  '0122334567654210',
  '0112233456543210',
  '0112223344432110',
  '0011222333322100',
  '0001122222221000',
  '0000111122211000',
  '0000011111110000',
  '0000000011000000',
  '0000000000000000',
];

/** Terrain char per height level: water, sand, grass ×2, forest, rock ×2, snow. */
const ISO_TERRAIN = ISO_HEIGHTS.map((row) => row.replace(/[0-9]/g, (c) => 'wsggdrrn'[+c]!));

class IsoTree extends IsoObject {
  private readonly pine: boolean;

  constructor(tx: number, ty: number, pine: boolean) {
    super({ tx, ty, width: 64, height: 116, anchor: [0.5, 1], shadowRadius: 22, shadowRatio: 0.5, shadowAlpha: 0.28 });
    this.pine = pine;
  }

  override draw(ctx: Ctx2D): void {
    const cx = 32;
    const h = this.height;
    ctx.fillStyle = '#6d4526';
    ctx.fillRect(cx - 4, h - 24, 8, 22);
    if (this.pine) {
      poly(ctx, '#2c6e45', [cx - 30, h - 20, cx + 30, h - 20, cx, h - 70]);
      poly(ctx, '#358556', [cx - 24, h - 46, cx + 24, h - 46, cx, h - 92]);
      poly(ctx, '#43a067', [cx - 16, h - 70, cx + 16, h - 70, cx, h - 112]);
      poly(ctx, 'rgba(0,0,0,0.14)', [cx, h - 20, cx + 30, h - 20, cx, h - 70]);
    } else {
      circle(ctx, cx, h - 52, 28, '#3d8b3d');
      circle(ctx, cx - 14, h - 44, 18, '#3d8b3d');
      circle(ctx, cx - 5, h - 62, 20, '#52a84a');
      circle(ctx, cx - 10, h - 70, 9, '#6cc261');
    }
  }
}

class IsoHut extends IsoObject {
  constructor(tx: number, ty: number) {
    super({ tx, ty, width: 100, height: 130, anchor: [0.5, 1], shadow: false });
  }

  override draw(ctx: Ctx2D): void {
    const cx = 50;
    const g = this.height;
    const hw = 38;
    const hh = 19;
    const H = 46;
    poly(ctx, '#e7d3b0', [cx - hw, g, cx, g + hh, cx, g + hh - H, cx - hw, g - H]);
    poly(ctx, '#c9b089', [cx, g + hh, cx + hw, g, cx + hw, g - H, cx, g + hh - H]);
    poly(ctx, '#6b4423', [cx + 12, g + hh - 6 - 6, cx + 24, g + hh - 12 - 6, cx + 24, g - 28 + 2, cx + 12, g + hh - 34]);
    poly(ctx, '#7dd3fc', [cx - 28, g - 12, cx - 14, g - 5, cx - 14, g - 22, cx - 28, g - 29]);
    const apex = g - H - 44;
    poly(ctx, '#b4432f', [cx - hw - 8, g - H + 2, cx, g + hh - H + 6, cx, apex]);
    poly(ctx, '#8f3322', [cx, g + hh - H + 6, cx + hw + 8, g - H + 2, cx, apex]);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, g + hh - H + 6);
    ctx.lineTo(cx, apex);
    ctx.stroke();
  }
}

class IsoBall extends IsoObject {
  private wait = 0.3;

  constructor(tx: number, ty: number) {
    super({ tx, ty, width: 30, height: 30, anchor: [0.5, 1], bounce: 0.62, gravity: 1500, shadowRadius: 14 });
  }

  override update(dt: number): void {
    if (!this.grounded) return;
    this.wait -= dt;
    if (this.wait <= 0) {
      this.vz = 640;
      this.wait = 0.8;
    }
  }

  override draw(ctx: Ctx2D): void {
    circle(ctx, 15, 15, 14, '#f8fafc');
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(15, 15);
    ctx.arc(15, 15, 14, -0.4, 0.9);
    ctx.fill();
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.moveTo(15, 15);
    ctx.arc(15, 15, 14, 1.7, 3.0);
    ctx.fill();
    circle(ctx, 10, 9, 3.5, 'rgba(255,255,255,0.9)');
  }
}

class IsoWalker extends IsoObject {
  facing = 1;
  phase = 0;
  moving = false;

  constructor(tx: number, ty: number) {
    super({ tx, ty, width: 40, height: 64, anchor: [0.5, 1], shadowRadius: 15, gravity: 1500 });
  }

  override draw(ctx: Ctx2D): void {
    const cx = 20;
    const swing = this.moving ? Math.sin(this.phase) * 5 : 0;
    const bob = this.moving ? Math.abs(Math.sin(this.phase)) * 2 : 0;
    ctx.fillStyle = '#374151';
    ctx.fillRect(cx - 8 + swing * 0.5, 48 - bob, 6, 15);
    ctx.fillRect(cx + 2 - swing * 0.5, 48 - bob, 6, 15);
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    roundRectPath(ctx, cx - 12, 28 - bob, 24, 23, 8);
    ctx.fill();
    circle(ctx, cx, 17 - bob, 13, '#fcd9b6');
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.ellipse(cx, 8 - bob, 16, 5, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, 8 - bob, 10, Math.PI, 0);
    ctx.fill();
    circle(ctx, cx + this.facing * 4 - 4, 19 - bob, 2, '#1f2937');
    circle(ctx, cx + this.facing * 4 + 4, 19 - bob, 2, '#1f2937');
  }
}

/**
 * Isometric diorama: ASCII heights + terrain, procedural shaded blocks, trees/hut/ball depth-sorted with the
 * tiles, height-aware tap picking, A* limited to one level per step, path highlight + selection.
 */
class IsoScene extends WorldDemo {
  readonly title = 'World · Isometric';
  private iso!: IsoMap;
  private hero!: IsoWalker;
  private follower: PathFollower | null = null;
  private idle = 0;
  private time = 0;
  private readonly rand = new Rng(7);

  protected build(): void {
    const { x, y, w, h } = this.content;
    this.addAt(
      new Paint(
        (ctx) => {
          const g = ctx.createLinearGradient(0, y, 0, y + h);
          g.addColorStop(0, '#0d3b66');
          g.addColorStop(1, '#1b6ca8');
          ctx.fillStyle = g;
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = 'rgba(255,255,255,0.08)';
          ctx.lineWidth = 3;
          for (let i = 0; i < 26; i++) {
            const wx = x + hash2(i, 1, 3) * w;
            const wy = y + hash2(i, 2, 3) * h;
            const s = Math.sin(this.time * 1.5 + i) * 6;
            ctx.beginPath();
            ctx.moveTo(wx - 18 + s, wy);
            ctx.quadraticCurveTo(wx + s, wy - 6, wx + 18 + s, wy);
            ctx.stroke();
          }
        },
        { id: 'ocean' },
      ),
      1,
    );
    const world = this.addWorld(2);
    const legend: Record<string, IsoLegendEntry> = {
      w: { name: 'water', color: '#3a9ad9', walkable: false, decorate: (ctx, cx, cy, t) => this.ripple(ctx, cx, cy, t.tx, t.ty) },
      s: { name: 'sand', color: '#e5cb8a', decorate: (ctx, cx, cy, t) => this.dots(ctx, cx, cy, t.tx, t.ty, '#cdb070') },
      g: { name: 'grass', color: '#7dbb4c', decorate: (ctx, cx, cy, t) => this.tufts(ctx, cx, cy, t.tx, t.ty, '#5f9a37') },
      d: { name: 'forest', color: '#5b9c3d', decorate: (ctx, cx, cy, t) => this.tufts(ctx, cx, cy, t.tx, t.ty, '#467f2c') },
      r: { name: 'rock', color: '#9b948b', decorate: (ctx, cx, cy, t) => this.dots(ctx, cx, cy, t.tx, t.ty, '#827a70') },
      n: { name: 'snow', color: '#eef3f8' },
    };
    const iso = (this.iso = IsoMap.fromAscii({ id: 'iso', heights: ISO_HEIGHTS, terrain: ISO_TERRAIN, legend, tileWidth: 96, heightStep: 32 }));
    world.add(iso);
    const trees: [number, number, boolean][] = [
      [3, 5, false], [2, 7, true], [4, 9, false], [10, 3, true], [12, 5, true], [11, 10, false],
      [6, 11, true], [9, 12, false], [13, 8, true], [3, 6, true], [12, 9, true], [8, 2, false],
    ];
    for (const [tx, ty, pine] of trees) {
      iso.addObject(new IsoTree(tx, ty, pine), tx, ty);
      iso.setBlocked(tx, ty);
    }
    iso.addObject(new IsoHut(5, 10), 5, 10);
    iso.setBlocked(5, 10);
    iso.addObject(new IsoBall(7, 11), 7, 11);
    this.hero = iso.addObject(new IsoWalker(6, 9), 6, 9);
    this.hero.id = 'player';

    const cam = world.camera;
    cam.zoom = clamp(h / (iso.height + 250), 0.8, 1.2);
    cam.bounds = { x: -40, y: -80, w: iso.width + 80, h: iso.height + 120 };
    cam.follow(this.hero, { lerp: 3.5, deadzoneWidth: 80, deadzoneHeight: 120, snap: true });

    iso.onTileTap((pick) => this.walkTo(pick.tx, pick.ty));
    this.addHud('');
    this.onUpdate((dt) => this.think(dt));
    this.walkTo(9, 7);
  }

  private walkTo(tx: number, ty: number): void {
    const iso = this.iso;
    const hero = this.hero;
    const path = iso.findPath(hero.tileX, hero.tileY, tx, ty, { diagonal: false, nearest: true });
    iso.clearHighlights();
    if (!path || path.length < 2) {
      iso.select(tx, ty);
      return;
    }
    for (const p of path.slice(1, -1)) iso.highlight(p.x, p.y, 'rgba(255,255,255,0.38)');
    const end = path[path.length - 1]!;
    iso.select(end.x, end.y);
    const pts = path.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));
    pts[0] = { x: hero.ix, y: hero.iy };
    this.follower = new PathFollower(pts, 2.8);
    this.idle = 0;
  }

  private think(dt: number): void {
    this.time += dt;
    const hero = this.hero;
    const f = this.follower;
    if (f && !f.done) {
      const px = hero.ix;
      const py = hero.iy;
      f.update(dt);
      hero.ix = f.x;
      hero.iy = f.y;
      const sdx = hero.ix - px - (hero.iy - py);
      if (Math.abs(sdx) > 1e-4) hero.facing = Math.sign(sdx);
      hero.moving = true;
      hero.phase += dt * 14;
      this.iso.unhighlight(hero.tileX, hero.tileY);
      if (f.done) {
        this.iso.clearHighlights();
        hero.jump(380);
      }
    } else {
      hero.moving = false;
      this.idle += dt;
      if (this.idle > 1.4) this.wander();
    }
    const t = this.iso.selected;
    const h = t ? this.iso.heightAt(t.x, t.y) : 0;
    this.hud.text = `点击方块移动  ·  目标 ${t ? `${t.x},${t.y}  高度 ${h}` : '-'}  ·  剩余 ${f && !f.done ? f.remaining.toFixed(1) : 0} 格`;
  }

  /** Picks a random walkable tile that is reachable (A* never climbs more than one level per step). */
  private wander(): void {
    const iso = this.iso;
    for (let i = 0; i < 20; i++) {
      const tx = this.rand.int(1, iso.cols - 2);
      const ty = this.rand.int(1, iso.rows - 2);
      if (!iso.passable(tx, ty) || (tx === this.hero.tileX && ty === this.hero.tileY)) continue;
      if (iso.findPath(this.hero.tileX, this.hero.tileY, tx, ty)) {
        this.walkTo(tx, ty);
        return;
      }
    }
    this.idle = 0;
  }

  private ripple(ctx: Ctx2D, cx: number, cy: number, tx: number, ty: number): void {
    const s = Math.sin(this.time * 2 + tx * 1.3 + ty * 0.7) * 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 14 + s, cy);
    ctx.quadraticCurveTo(cx + s, cy - 4, cx + 14 + s, cy);
    ctx.stroke();
  }

  private dots(ctx: Ctx2D, cx: number, cy: number, tx: number, ty: number, color: string): void {
    ctx.fillStyle = color;
    for (let i = 0; i < 3; i++) {
      const dx = (hash2(tx, ty, i) - 0.5) * 40;
      const dy = (hash2(tx, ty, i + 5) - 0.5) * 18;
      ctx.fillRect(cx + dx - 1.5, cy + dy - 1.5, 3, 3);
    }
  }

  private tufts(ctx: Ctx2D, cx: number, cy: number, tx: number, ty: number, color: string): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 2; i++) {
      const dx = (hash2(tx, ty, i) - 0.5) * 44;
      const dy = (hash2(tx, ty, i + 5) - 0.5) * 18;
      ctx.moveTo(cx + dx - 3, cy + dy + 2);
      ctx.lineTo(cx + dx - 2, cy + dy - 4);
      ctx.moveTo(cx + dx + 2, cy + dy + 2);
      ctx.lineTo(cx + dx + 3, cy + dy - 5);
    }
    ctx.stroke();
  }
}

// ---------------------------------------------------------------- platformer

const PF_TILE = 64;

const PLATFORM_MAP = [
  '........................................................................',
  '........................................................................',
  '........................................................................',
  '........................................................................',
  '........................................................................',
  '........................................................................',
  '........................................................................',
  '........................................................................',
  '........................................................................',
  '.....ooooo.....o............ooooo..........ooooo.......oooo.............',
  '.....-----....o.o.....o.o.o.-----.o........-----.....o.----.............',
  '......................#####.............==........................=.....',
  '...P................#######...C......C..==................C.###...=.F...',
  '##############...################...################...#################',
  '##############...################...################...#################',
  '##############...################...################...#################',
];

const pfSolidAbove = (id: number) => id === 1 || id === 2;

const pfGround: TileDrawFn = (ctx, x, y, w, h, { tx, ty, map }) => {
  ctx.fillStyle = '#8a5a2e';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#74491f';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.ellipse(x + 8 + hash2(tx, ty, i) * (w - 16), y + 10 + hash2(tx, ty, i + 9) * (h - 20), 5, 3.5, 0, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = '#a0703f';
  ctx.fillRect(x + 6 + hash2(tx, ty, 20) * (w - 18), y + 12 + hash2(tx, ty, 21) * (h - 24), 6, 4);
  if (pfSolidAbove(map.getTile(tx, ty - 1)) || ty === 0) return;
  ctx.fillStyle = '#4ea52f';
  ctx.fillRect(x, y, w, 16);
  ctx.beginPath();
  for (let i = 0; i < 4; i++) ctx.arc(x + 8 + i * 16, y + 16, 8, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = '#7ccf52';
  ctx.fillRect(x, y, w, 5);
};

const pfBrick: TileDrawFn = (ctx, x, y, w, h, { ty }) => {
  ctx.fillStyle = '#8e3b24';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#c45a37';
  const bh = h / 2;
  for (let r = 0; r < 2; r++) {
    const off = (r + ty) % 2 === 0 ? 0 : w / 4;
    for (let bx = -1; bx < 3; bx++) {
      const x0 = Math.max(x, x + off + bx * (w / 2) + 2);
      const x1 = Math.min(x + w, x + off + (bx + 1) * (w / 2) - 2);
      if (x1 > x0) ctx.fillRect(x0, y + r * bh + 2, x1 - x0, bh - 4);
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(x, y, w, 3);
};

const pfPlank: TileDrawFn = (ctx, x, y, w, _h, { tx, ty, map }) => {
  ctx.fillStyle = '#6b4423';
  if (map.getTile(tx - 1, ty) !== 3) ctx.fillRect(x + 6, y + 14, 8, 26);
  if (map.getTile(tx + 1, ty) !== 3) ctx.fillRect(x + w - 14, y + 14, 8, 26);
  ctx.fillStyle = '#c0843f';
  ctx.fillRect(x, y, w, 18);
  ctx.fillStyle = '#9c6530';
  ctx.fillRect(x, y + 14, w, 4);
  ctx.fillRect(x + w / 2 - 1, y, 2, 14);
  ctx.fillStyle = '#e0a55e';
  ctx.fillRect(x, y, w, 3);
};

const PF_LEGEND: TileLegend = {
  '.': 0,
  '#': { id: 1, name: 'ground', solid: true, draw: pfGround },
  '=': { id: 2, name: 'brick', solid: true, draw: pfBrick },
  '-': { id: 3, name: 'plank', oneWay: true, draw: pfPlank },
  P: { id: 0, marker: 'player' },
  o: { id: 0, marker: 'coin' },
  C: { id: 0, marker: 'crate' },
  F: { id: 0, marker: 'flag' },
};

class PlatHero extends Node {
  dir = 1;
  squash = 0;
  private blink = 0;

  constructor() {
    super({ id: 'player', width: 48, height: 60, anchor: [0.5, 1] });
  }

  override update(dt: number): void {
    this.squash = approach(this.squash, 0, dt * 4);
    this.blink += dt;
    const s = Math.sin(this.squash * Math.PI) * 0.25;
    this.scaleX = 1 + s;
    this.scaleY = 1 - s;
  }

  override draw(ctx: Ctx2D): void {
    const w = this.width;
    const d = this.dir;
    ctx.fillStyle = '#c2410c';
    ctx.fillRect(8, 52, 12, 8);
    ctx.fillRect(28, 52, 12, 8);
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    roundRectPath(ctx, 2, 4, w - 4, 52, 18);
    ctx.fill();
    ctx.fillStyle = '#fdba74';
    ctx.beginPath();
    ctx.ellipse(w / 2 + d * 3, 38, 13, 11, 0, 0, TAU);
    ctx.fill();
    const closed = this.blink % 3 < 0.12;
    for (const ex of [w / 2 + d * 6 - 8, w / 2 + d * 6 + 8]) {
      if (closed) {
        ctx.fillStyle = '#1f2937';
        ctx.fillRect(ex - 5, 21, 10, 2.5);
      } else {
        circle(ctx, ex, 21, 6, '#ffffff');
        circle(ctx, ex + d * 2, 22, 3, '#1f2937');
      }
    }
  }
}

class PlatCoin extends Node {
  taken = false;
  private t: number;

  constructor(x: number, y: number, phase: number) {
    super({ x, y, width: 32, height: 32, anchor: 0.5 });
    this.t = phase;
  }

  override update(dt: number): void {
    this.t += dt;
    if (!this.taken) return;
    this.y -= 260 * dt;
    this.alpha = Math.max(0, this.alpha - dt * 3);
    if (this.alpha === 0) this.visible = false;
  }

  override draw(ctx: Ctx2D): void {
    const sx = Math.abs(Math.cos(this.t * 2.6)) * 0.85 + 0.15;
    ctx.save();
    ctx.translate(16, 16);
    ctx.scale(sx, 1);
    circle(ctx, 0, 0, 15, '#d48b0b');
    circle(ctx, 0, 0, 11, '#fcd34d');
    ctx.fillStyle = '#fff4c2';
    ctx.fillRect(-2, -7, 4, 14);
    ctx.restore();
  }
}

class Crate extends Node {
  constructor(x: number, y: number) {
    super({ x, y, width: 52, height: 52, anchor: 0.5 });
  }

  override draw(ctx: Ctx2D): void {
    ctx.fillStyle = '#9a6331';
    ctx.fillRect(0, 0, 52, 52);
    ctx.fillStyle = '#c28447';
    ctx.fillRect(4, 4, 44, 44);
    ctx.strokeStyle = '#9a6331';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(6, 6);
    ctx.lineTo(46, 46);
    ctx.moveTo(46, 6);
    ctx.lineTo(6, 46);
    ctx.stroke();
    ctx.strokeStyle = '#6b4423';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 50, 50);
  }
}

/**
 * Platformer: parallax sky layers, ASCII tile map with solid + one-way tiles, gravity bodies with per-axis tile
 * collision, pushable crates, coin sensors, camera look-ahead, shake on hard landings. The hero runs by itself
 * (jumps walls, gaps and coins it sees with physics queries); tap anywhere to jump.
 */
class PlatformerScene extends WorldDemo {
  readonly title = 'World · Platformer';
  private world!: World;
  private map!: TileMap;
  private physics!: PhysicsWorld;
  private hero!: ArcadeBody;
  private heroNode!: PlatHero;
  private dir = 1;
  private fall = 0;
  private coins = 0;
  private safe: Vec2 = { x: 0, y: 0 };
  private safeTimer = 0;
  private flagX = 0;
  private spawnX = 0;
  private jumpQueued = false;

  protected build(): void {
    const { x, y, w, h } = this.content;
    this.addAt(
      new Paint(
        (ctx) => {
          const g = ctx.createLinearGradient(0, y, 0, y + h);
          g.addColorStop(0, '#5ab3ec');
          g.addColorStop(0.7, '#bfe6fb');
          g.addColorStop(1, '#e6f6ff');
          ctx.fillStyle = g;
          ctx.fillRect(x, y, w, h);
        },
        { id: 'sky' },
      ),
      1,
    );
    const world = (this.world = this.addWorld(2));
    const map = (this.map = TileMap.fromAscii(PLATFORM_MAP, PF_LEGEND, PF_TILE, { id: 'map', solidOutside: true }));
    const ground = 13 * PF_TILE;
    world.add(new ParallaxLayer(0.12, 1, { id: 'clouds', repeatWidth: 1600 })).add(new Paint((ctx) => drawClouds(ctx)));
    world.add(new ParallaxLayer(0.2, 1, { id: 'mountains', repeatWidth: 1400 })).add(new Paint((ctx) => drawMountains(ctx, ground)));
    world.add(new ParallaxLayer(0.45, 1, { id: 'hills', repeatWidth: 1000 })).add(new Paint((ctx) => drawHills(ctx, ground)));
    world.add(map);

    const physics = (this.physics = new PhysicsWorld({ gravity: 2300 }));
    physics.attach(this.game, this);
    physics.addTileMap(map);
    map.markers('coin').forEach((c, i) => {
      const p = map.tileToWorld(c.x, c.y);
      const node = world.add(new PlatCoin(p.x, p.y, i * 0.4));
      physics.add({ x: p.x, y: p.y, radius: 16, sensor: true, immovable: true, collideTiles: false, data: { coin: node } });
    });
    for (const c of map.markers('crate')) {
      const p = map.tileToWorld(c.x, c.y);
      const node = world.add(new Crate(p.x, p.y + 6));
      physics.add({ x: p.x, y: p.y + 6, width: 52, height: 52, mass: 2.5, dragX: 5, node, data: { crate: true, home: p } });
    }
    const flag = map.markerWorld('flag');
    this.flagX = flag.x;
    world.add(new Paint((ctx) => this.drawFlag(ctx), { x: flag.x, y: flag.y + PF_TILE / 2 }));
    const spawn = map.markerWorld('player');
    this.spawnX = spawn.x;
    this.safe = { x: spawn.x, y: spawn.y };
    this.heroNode = world.add(new PlatHero());
    this.hero = physics.add({ id: 'hero', x: spawn.x, y: spawn.y, width: 40, height: 56, maxVelocityY: 1600, node: this.heroNode, offsetY: 28 });
    this.hero.onOverlap = (other) => {
      const coin = other.data.coin;
      if (!(coin instanceof PlatCoin) || coin.taken) return;
      coin.taken = true;
      physics.remove(other);
      this.coins++;
      world.camera.shake(0.15);
    };

    const cam = world.camera;
    cam.zoom = h / map.height;
    cam.bounds = { x: 0, y: 0, w: map.width, h: map.height };
    cam.follow(this.hero, { lerp: 7, lookAhead: 0.3, maxLookAhead: 170, deadzoneWidth: 30, deadzoneHeight: 400, snap: true });
    world.onTap(() => (this.jumpQueued = true));

    this.addHud('');
    this.onUpdate((dt) => this.think(dt));
  }

  private groundAt(wx: number, wy: number): boolean {
    const t = this.map.worldToTile(wx, wy);
    return this.map.inBounds(t.x, t.y) && this.map.tileFlags(t.x, t.y) !== 0;
  }

  /** No ground within three tiles below (a pit, not a ledge to drop from). */
  private pitAt(wx: number, wy: number): boolean {
    for (let k = 0; k <= 3; k++) if (this.groundAt(wx, wy + k * PF_TILE)) return false;
    return true;
  }

  private think(dt: number): void {
    const b = this.hero;
    const map = this.map;
    const node = this.heroNode;
    if (b.justLanded) {
      node.squash = 1;
      if (this.fall > 1150) this.world.camera.shake(0.4);
      this.fall = 0;
    }
    if (!b.onGround) this.fall = Math.max(this.fall, b.vy);
    const dir = this.dir;
    b.vx = approach(b.vx, dir * 330, 2600 * dt);
    if (b.onGround) {
      const front = b.x + dir * (b.halfWidth + 10);
      const wall = map.solidAt(front, b.bottom - 10) || (dir > 0 ? b.touching.right : b.touching.left);
      const tall = map.solidAt(front, b.bottom - 10 - 3 * PF_TILE);
      const gap = this.pitAt(front + dir * 14, b.bottom + 6);
      const probe = { x: dir > 0 ? b.x : b.x - 220, y: b.top - 250, w: 220, h: 240 };
      const coinAhead = this.physics
        .queryRect(probe)
        .some((o) => o.data.coin instanceof PlatCoin && o.y < b.top && this.groundAt(o.x, o.y + PF_TILE));
      if (wall && tall) this.dir = -dir;
      else if (wall || gap || coinAhead || this.jumpQueued) b.vy = -980;
      this.jumpQueued = false;
      this.safeTimer += dt;
      if (this.safeTimer > 0.5 && !gap) {
        this.safe = { x: b.x, y: b.y };
        this.safeTimer = 0;
      }
    }
    if (dir > 0 && b.x > this.flagX) {
      this.dir = -1;
      this.world.camera.shake(0.5);
      if (b.onGround) b.vy = -700;
    } else if (dir < 0 && b.x < this.spawnX) {
      this.dir = 1;
    }
    if (b.top > map.height - PF_TILE * 1.5) {
      b.setPosition(this.safe.x, this.safe.y - PF_TILE);
      b.setVelocity(0, 0);
      this.world.camera.shake(0.6);
    }
    for (const c of this.physics.bodies) {
      const home = c.data.home as Vec2 | undefined;
      if (home && c.top > map.height - PF_TILE * 1.2) c.setPosition(home.x, home.y - 200).setVelocity(0, 0);
    }
    node.dir = this.dir;
    this.hud.text = `金币 ${this.coins}  ·  点击跳跃  ·  ${b.onGround ? '地面' : '空中'}  ·  vx ${Math.round(b.vx)}  vy ${Math.round(b.vy)}`;
  }

  private flagT = 0;

  private drawFlag(ctx: Ctx2D): void {
    this.flagT += 1 / 60;
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(-4, -190, 8, 190);
    circle(ctx, 0, -194, 8, '#facc15');
    const wv = Math.sin(this.flagT * 5) * 8;
    poly(ctx, '#ef4444', [4, -186, 84, -160 + wv * 0.5, 4, -128]);
    ctx.fillStyle = '#9ca3af';
    ctx.fillRect(-14, -8, 28, 8);
  }
}

function drawClouds(ctx: Ctx2D): void {
  for (let i = 0; i < 6; i++) {
    const cx = 120 + i * 260 + hash2(i, 0, 1) * 80;
    const cy = 90 + hash2(i, 1, 1) * 280;
    const s = 0.7 + hash2(i, 2, 1) * 0.6;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.arc(cx, cy, 34 * s, 0, TAU);
    ctx.arc(cx + 38 * s, cy + 8 * s, 28 * s, 0, TAU);
    ctx.arc(cx - 38 * s, cy + 10 * s, 24 * s, 0, TAU);
    ctx.arc(cx + 10 * s, cy + 18 * s, 30 * s, 0, TAU);
    ctx.fill();
  }
}

function drawMountains(ctx: Ctx2D, base: number): void {
  const peaks = [
    [0, 380], [180, 250], [360, 400], [520, 210], [720, 360], [900, 270], [1080, 420], [1240, 230], [1400, 380],
  ];
  ctx.fillStyle = '#9db4d6';
  ctx.beginPath();
  ctx.moveTo(0, base);
  for (const [px, py] of peaks) ctx.lineTo(px!, base - py!);
  ctx.lineTo(1400, base);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#eef4fb';
  for (const [px, py] of peaks) {
    if (py! < 300) continue;
    ctx.beginPath();
    ctx.moveTo(px! - 44, base - py! + 44);
    ctx.lineTo(px!, base - py!);
    ctx.lineTo(px! + 44, base - py! + 44);
    ctx.lineTo(px! + 18, base - py! + 34);
    ctx.lineTo(px!, base - py! + 48);
    ctx.lineTo(px! - 18, base - py! + 34);
    ctx.closePath();
    ctx.fill();
  }
}

function drawHills(ctx: Ctx2D, base: number): void {
  const layers: [string, number, number, number][] = [
    ['#79b866', 170, 50, 0],
    ['#5f9f50', 100, 36, 1.7],
  ];
  for (const [color, top, amp, phase] of layers) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, base + 10);
    for (let x = 0; x <= 1000; x += 25) {
      const k = (x / 1000) * TAU;
      ctx.lineTo(x, base - top - Math.sin(k + phase) * amp - Math.sin(k * 3 + phase) * amp * 0.35);
    }
    ctx.lineTo(1000, base + 10);
    ctx.closePath();
    ctx.fill();
  }
}

// ---------------------------------------------------------------- pseudo-3D road

interface RoadCar extends RoadObject {
  speed: number;
  color: string;
}

const ROAD_FOG = '#d6e7f3';

function drawRoadTree(ctx: Ctx2D, x: number, y: number, scale: number, pine: boolean): void {
  const h = 820 * scale;
  if (h < 3) return;
  const w = 500 * scale;
  ctx.fillStyle = '#6d4526';
  ctx.fillRect(x - w * 0.06, y - h * 0.3, w * 0.12, h * 0.3);
  if (pine) {
    poly(ctx, '#2c6e45', [x - w / 2, y - h * 0.22, x + w / 2, y - h * 0.22, x, y - h]);
    poly(ctx, '#3b8a58', [x - w * 0.3, y - h * 0.5, x, y - h * 0.5, x, y - h]);
  } else {
    circle(ctx, x, y - h * 0.62, w * 0.45, '#3f8a3a');
    circle(ctx, x - w * 0.12, y - h * 0.7, w * 0.26, '#58a84c');
  }
}

function drawPole(ctx: Ctx2D, x: number, y: number, scale: number, side: number): void {
  const h = 1150 * scale;
  if (h < 3) return;
  const w = Math.max(1, 32 * scale);
  ctx.fillStyle = '#9ca3af';
  ctx.fillRect(x - w / 2, y - h, w, h);
  ctx.fillRect(x - (side > 0 ? 260 * scale : 0), y - h, 260 * scale, w);
  circle(ctx, x - side * 250 * scale, y - h + w * 1.5, Math.max(1, 36 * scale), '#fef3c7');
}

function drawBillboard(ctx: Ctx2D, x: number, y: number, scale: number): void {
  const w = 1250 * scale;
  const h = 680 * scale;
  if (w < 4) return;
  ctx.fillStyle = '#4b5563';
  ctx.fillRect(x - w * 0.3, y - h, w * 0.05, h);
  ctx.fillRect(x + w * 0.25, y - h, w * 0.05, h);
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(x - w / 2, y - h - h * 0.9, w, h * 0.9);
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(x - w / 2 + w * 0.05, y - h - h * 0.8, w * 0.9, h * 0.7);
  ctx.fillStyle = '#fde68a';
  ctx.fillRect(x - w * 0.35, y - h - h * 0.55, w * 0.7, h * 0.2);
}

function drawCar(ctx: Ctx2D, x: number, y: number, scale: number, color: string): void {
  const w = 230 * scale;
  const h = 125 * scale;
  if (w < 3) return;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(x, y, w * 0.56, h * 0.12, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#111827';
  ctx.fillRect(x - w * 0.46, y - h * 0.28, w * 0.18, h * 0.28);
  ctx.fillRect(x + w * 0.28, y - h * 0.28, w * 0.18, h * 0.28);
  ctx.fillStyle = color;
  ctx.beginPath();
  roundRectPath(ctx, x - w / 2, y - h * 0.72, w, h * 0.52, h * 0.12);
  ctx.fill();
  ctx.beginPath();
  roundRectPath(ctx, x - w * 0.34, y - h, w * 0.68, h * 0.36, h * 0.12);
  ctx.fill();
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(x - w * 0.28, y - h * 0.92, w * 0.56, h * 0.24);
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(x - w * 0.46, y - h * 0.58, w * 0.14, h * 0.1);
  ctx.fillRect(x + w * 0.32, y - h * 0.58, w * 0.14, h * 0.1);
}

const ROAD_TREES: RoadSprite[][] = [];
for (let i = 0; i < 8; i++) {
  const side = i % 2 === 0 ? -1 : 1;
  const pine = i % 4 < 2;
  const offset = side * (1.6 + (i >> 1) * 0.45);
  ROAD_TREES.push([{ offset, draw: (ctx, x, y, s) => drawRoadTree(ctx, x, y, s, pine) }]);
}
const ROAD_POLES: RoadSprite[] = [
  { offset: -1.25, draw: (ctx, x, y, s) => drawPole(ctx, x, y, s, -1) },
  { offset: 1.25, draw: (ctx, x, y, s) => drawPole(ctx, x, y, s, 1) },
];
const ROAD_BILLBOARD: RoadSprite[] = [{ offset: 2.6, draw: drawBillboard }];

/** Pseudo-3D road (projected segments with curves, hills, rumble strips, lane stripes, fog and roadside sprites). */
class RoadScene extends WorldDemo {
  readonly title = 'World · Road';
  private road!: PerspectiveRoad;
  private cars: RoadCar[] = [];
  private speed = 0;
  private skyX = 0;
  private laneTarget = 0;
  private steer = 0;
  private readonly rand = new Rng(5);

  protected build(): void {
    const { x, y, w, h } = this.content;
    const road = (this.road = new PerspectiveRoad({
      id: 'road',
      x,
      y,
      width: w,
      height: h,
      horizon: h * 0.42,
      roadWidth: 520,
      segmentLength: 200,
      lanes: 3,
      drawDistance: 170,
      cameraHeight: 1300,
      curve: (seg) => 4.2 * Math.sin(seg * 0.012) ** 3,
      hill: (z) => 1400 * Math.sin(z / 16000) + 500 * Math.sin(z / 5200 + 1),
      fog: ROAD_FOG,
    }));
    this.addAt(new Paint((ctx) => this.drawSky(ctx), { id: 'sky' }), 1);
    this.addAt(road, 2);
    road.roadside = (seg) => {
      if (seg % 150 === 40) return ROAD_BILLBOARD;
      if (seg % 16 === 0) return ROAD_POLES;
      if (seg % 3 !== 0) return null;
      return ROAD_TREES[Math.floor(hash2(seg, 0, 77) * ROAD_TREES.length)]!;
    };
    const colors = ['#3b82f6', '#eab308', '#10b981', '#a855f7', '#f43f5e', '#f8fafc'];
    for (let i = 0; i < 6; i++) {
      const car: RoadCar = {
        z: 2500 + i * 3200,
        offset: [-0.66, 0, 0.66][i % 3]!,
        speed: 2600 + this.rand.float(0, 1800),
        color: colors[i]!,
        draw: (ctx, cx, cy, s) => drawCar(ctx, cx, cy, s, car.color),
      };
      this.cars.push(car);
      road.objects.push(car);
    }
    this.add(new Paint((ctx) => this.drawPlayer(ctx), { id: 'player', x: x + w / 2, y: y + h - 70 }));
    this.addHud('');
    this.onUpdate((dt) => this.think(dt));
  }

  private think(dt: number): void {
    const road = this.road;
    this.speed = approach(this.speed, 6800, 2600 * dt);
    road.position += this.speed * dt;
    const pos = road.position;
    const span = road.drawDistance * road.segmentLength;
    for (const c of this.cars) {
      c.z += c.speed * dt;
      if (c.z < pos - 400) {
        c.z = pos + span * (0.6 + this.rand.float(0, 0.35));
        c.offset = [-0.66, 0, 0.66][this.rand.int(0, 2)]!;
      }
    }
    const lane = (o: number) => Math.round(o / 0.66);
    const me = road.playerX / road.roadWidth;
    const blocked = (l: number) => this.cars.some((c) => lane(c.offset) === l && c.z > pos && c.z - pos < 5200);
    if (blocked(this.laneTarget)) {
      const options = [-1, 0, 1].filter((l) => !blocked(l)).sort((a, b) => Math.abs(a - lane(me)) - Math.abs(b - lane(me)));
      if (options.length) this.laneTarget = options[0]!;
    }
    const target = this.laneTarget * 0.66 * road.roadWidth;
    const before = road.playerX;
    road.playerX += (target - road.playerX) * Math.min(1, dt * 2.2);
    road.playerX -= road.curvature * (this.speed / 6800) * dt * 90;
    this.steer = approach(this.steer, clamp((road.playerX - before) / Math.max(dt, 1e-3) / 1200, -1, 1), dt * 4);
    this.skyX += road.curvature * this.speed * dt * 0.004;
    this.hud.text = `速度 ${Math.round(this.speed / 38)} km/h  ·  距离 ${(pos / 10000).toFixed(2)} km  ·  段 ${road.segmentsDrawn}`;
  }

  private drawSky(ctx: Ctx2D): void {
    const { x, y, w } = this.content;
    const hz = y + this.road.projector.horizon;
    const g = ctx.createLinearGradient(0, y, 0, hz);
    g.addColorStop(0, '#3d8fd8');
    g.addColorStop(1, ROAD_FOG);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, hz - y + 2);
    circle(ctx, x + w * 0.72, y + (hz - y) * 0.35, 46, 'rgba(255,244,200,0.35)');
    circle(ctx, x + w * 0.72, y + (hz - y) * 0.35, 30, '#fff4c8');
    const layers: [string, number, number, number][] = [
      ['#a9bfd9', 0.3, 170, 11],
      ['#7f9bbd', 0.6, 110, 23],
    ];
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, hz - y + 2);
    ctx.clip();
    for (const [color, k, amp, seed] of layers) {
      const off = ((this.skyX * k) % 400) - 400;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, hz + 2);
      for (let px = off; px <= w + 400; px += 100) {
        const i = Math.floor((px - off) / 100) + Math.floor((this.skyX * k) / 400) * 4;
        ctx.lineTo(x + px, hz - 20 - hash2(i, 0, seed) * amp);
      }
      ctx.lineTo(x + w, hz + 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPlayer(ctx: Ctx2D): void {
    const s = this.steer;
    ctx.save();
    ctx.scale(0.62, 0.62);
    ctx.rotate(s * 0.05);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 20, 170, 26, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#111827';
    ctx.fillRect(-150, -24, 56, 44);
    ctx.fillRect(94, -24, 56, 44);
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    roundRectPath(ctx, -160, -90, 320, 84, 22);
    ctx.fill();
    ctx.fillStyle = '#b91c1c';
    ctx.beginPath();
    roundRectPath(ctx, -104 + s * 8, -150, 208, 70, 26);
    ctx.fill();
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    roundRectPath(ctx, -86 + s * 8, -140, 172, 46, 14);
    ctx.fill();
    ctx.fillStyle = '#fca5a5';
    ctx.fillRect(-150, -74, 50, 16);
    ctx.fillRect(100, -74, 50, 16);
    ctx.fillStyle = '#374151';
    ctx.fillRect(-60, -40, 120, 20);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(-150, -6, 300, 6);
    ctx.restore();
  }
}

export const scenes: Record<string, SceneFactory> = {
  'world-topdown': () => new TopDownScene(),
  'world-iso': () => new IsoScene(),
  'world-platformer': () => new PlatformerScene(),
  'world-road': () => new RoadScene(),
};
