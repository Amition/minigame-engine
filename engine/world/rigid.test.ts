import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { Node } from '../scene/node';
import {
  bindRigidNode,
  rigidBox,
  rigidCircle,
  rigidPolygon,
  RigidWorld,
  type RigidBody,
  type RigidContactEvent,
  type RigidWorldOptions,
} from './rigid';

const H = 1 / 60;
const run = (w: RigidWorld, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) w.step(H);
};

/** World with a static ground whose top is at y = 1000. */
function ground(opts: RigidWorldOptions = {}): { world: RigidWorld; floor: RigidBody } {
  const world = new RigidWorld(opts);
  const floor = world.add({ type: 'static', name: 'floor', shape: rigidBox(2000, 100), x: 500, y: 1050 });
  return { world, floor };
}

function maxCircleOverlap(bodies: RigidBody[]): number {
  let worst = 0;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]!;
      const b = bodies[j]!;
      if (a.shape.type !== 'circle' || b.shape.type !== 'circle') continue;
      worst = Math.max(worst, a.shape.radius + b.shape.radius - Math.hypot(b.x - a.x, b.y - a.y));
    }
  }
  return worst;
}

describe('RigidWorld stacking', () => {
  it('keeps a 10-box tower standing for 5 s and puts it to sleep', () => {
    const { world } = ground();
    const boxes: RigidBody[] = [];
    for (let i = 0; i < 10; i++) {
      boxes.push(world.add({ name: `box${i}`, shape: rigidBox(40, 40), x: 500, y: 1000 - 20 - i * 40, friction: 0.6 }));
    }
    let maxDrift = 0;
    for (let s = 0; s < 300; s++) {
      world.step(H);
      for (const b of boxes) maxDrift = Math.max(maxDrift, Math.abs(b.x - 500));
    }
    const top = boxes[9]!;
    expect(maxDrift).toBeLessThan(1);
    expect(Math.abs(top.angle)).toBeLessThan(0.01);
    expect(top.y).toBeGreaterThan(1000 - 400 + 20 - 3);
    expect(boxes.every((b) => b.sleeping)).toBe(true);
    expect(world.dump()).toContain('sleeping=10');
  });

  it('settles a walled circle pyramid without overlaps and sleeps', () => {
    const { world } = ground();
    const r = 20;
    const rows = 8;
    const left = 500 - rows * r;
    world.add({ type: 'static', shape: rigidBox(100, 600), x: left - 50, y: 700 });
    world.add({ type: 'static', shape: rigidBox(100, 600), x: left + rows * 2 * r + 50, y: 700 });
    const circles: RigidBody[] = [];
    for (let row = 0; row < rows; row++) {
      for (let i = 0; i < rows - row; i++) {
        const x = left + r + row * r + i * 2 * r;
        const y = 1000 - r - row * r * Math.sqrt(3);
        circles.push(world.add({ shape: rigidCircle(r), x, y, friction: 0.5 }));
      }
    }
    const apex = circles[circles.length - 1]!;
    const apexY = apex.y;
    run(world, 5);
    expect(Math.abs(apex.y - apexY)).toBeLessThan(3);
    expect(maxCircleOverlap(circles)).toBeLessThan(1);
    expect(circles.every((b) => b.sleeping)).toBe(true);
  });

  it('bounces with restitution to about e² of the drop height', () => {
    const { world } = ground();
    const e = 0.8;
    const r = 20;
    const drop = 400;
    const ball = world.add({ shape: rigidCircle(r), x: 500, y: 1000 - r - drop, restitution: e });
    let landed = false;
    let peak = Infinity;
    for (let i = 0; i < 180; i++) {
      world.step(H);
      if (!landed && ball.vy < 0) landed = true;
      if (landed) {
        peak = Math.min(peak, ball.y);
        if (ball.vy > 0) break;
      }
    }
    const height = 1000 - r - peak;
    expect(height).toBeGreaterThan(drop * e * e * 0.85);
    expect(height).toBeLessThan(drop * e * e * 1.15);
  });

  it('holds a box on a slope by friction while a circle rolls down', () => {
    const world = new RigidWorld();
    const slope = 0.35;
    world.add({ type: 'static', shape: rigidBox(1600, 40), x: 800, y: 800, angle: slope });
    const c = Math.cos(slope);
    const s = Math.sin(slope);
    // A point on the slope surface at signed distance d from the slope centre, lifted by h along the normal.
    const onSlope = (d: number, h: number) => ({ x: 800 + c * d + s * (20 + h), y: 800 + s * d - c * (20 + h) });
    const bp = onSlope(-300, 20);
    const box = world.add({ shape: rigidBox(40, 40), x: bp.x, y: bp.y, angle: slope, friction: 0.6 });
    const cp = onSlope(-150, 20);
    const ball = world.add({ shape: rigidCircle(20), x: cp.x, y: cp.y, friction: 0.6 });
    run(world, 2);
    expect(Math.hypot(box.x - bp.x, box.y - bp.y)).toBeLessThan(3);
    expect(box.sleeping).toBe(true);
    const travelled = Math.hypot(ball.x - cp.x, ball.y - cp.y);
    expect(travelled).toBeGreaterThan(300);
    expect(ball.av).toBeGreaterThan(0);
    expect(ball.av * 20).toBeCloseTo(ball.speed, -1);
  });
});

describe('RigidWorld contacts', () => {
  it('emits contactBegin/contactEnd with approach speed and impulse', () => {
    const { world, floor } = ground();
    const ball = world.add({ shape: rigidCircle(20), x: 500, y: 700, restitution: 0.5 });
    const begins: RigidContactEvent[] = [];
    const ends: RigidContactEvent[] = [];
    world.on('contactBegin', (e) => begins.push(e));
    world.on('contactEnd', (e) => ends.push(e));
    run(world, 1);
    expect(begins.length).toBeGreaterThanOrEqual(1);
    const first = begins[0]!;
    expect(new Set([first.a, first.b])).toEqual(new Set([ball, floor]));
    expect(first.approachSpeed).toBeGreaterThan(400);
    expect(first.impulse).toBeGreaterThan(0);
    expect(Math.abs(first.ny)).toBeCloseTo(1, 3);
    expect(Math.abs(first.y - 1000)).toBeLessThan(10);
    expect(ends.length).toBeGreaterThanOrEqual(1);
    run(world, 2);
    expect(world.touches.some((c) => c.other(floor) === ball)).toBe(true);
  });

  it('counts exactly touching bodies as touching', () => {
    const world = new RigidWorld({ gravity: 0 });
    const a = world.add({ shape: rigidCircle(26), x: 300, y: 300 });
    const b = world.add({ shape: rigidCircle(26), x: 352, y: 300 });
    world.add({ shape: rigidCircle(38), x: 500, y: 300 });
    let began = 0;
    world.on('contactBegin', () => began++);
    world.step(H);
    expect(began).toBe(1);
    expect(world.touches).toHaveLength(1);
    expect(new Set([world.touches[0]!.a, world.touches[0]!.b])).toEqual(new Set([a, b]));
  });

  it('records a touch that begins and ends inside one step', () => {
    const world = new RigidWorld({ gravity: 0, substeps: 4 });
    const a = world.add({ shape: rigidCircle(20), x: 300, y: 300, vx: 600, restitution: 1 });
    // 7 units apart closing 5 per substep: the touch starts in substep 3 and the bounce ends it in substep 4.
    const b = world.add({ shape: rigidCircle(20), x: 347, y: 300, vx: -600, restitution: 1 });
    let brief = false;
    for (let i = 0; i < 10 && !brief; i++) {
      let began = false;
      let ended = false;
      const offB = world.on('contactBegin', () => (began = true));
      const offE = world.on('contactEnd', () => (ended = true));
      world.step(H);
      offB();
      offE();
      if (began && ended) {
        brief = true;
        expect(world.touches.map((c) => [c.a, c.b])).toEqual([[a, b]]);
        expect(world.contacts.every((c) => !c.touching)).toBe(true);
      }
    }
    expect(brief).toBe(true);
    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
  });

  it('reports sensor overlaps without pushing', () => {
    const { world } = ground();
    const zone = world.add({ type: 'static', sensor: true, shape: rigidBox(400, 100), x: 500, y: 600 });
    const ball = world.add({ shape: rigidCircle(20), x: 500, y: 300 });
    const log: string[] = [];
    world.on('contactBegin', (e) => log.push(`begin ${e.sensor} ${e.contact.other(zone) === ball}`));
    world.on('contactEnd', (e) => log.push(`end ${e.sensor}`));
    let vyAtExit = 0;
    for (let i = 0; i < 60 && log.length < 2; i++) {
      world.step(H);
      vyAtExit = ball.vy;
    }
    expect(log).toEqual(['begin true true', 'end true']);
    expect(vyAtExit).toBeCloseTo(1600 * world.time, -1);
  });

  it('filters by category and mask', () => {
    const { world } = ground();
    const ghost = world.add({ shape: rigidCircle(20), x: 400, y: 900, category: 2, mask: ~1 });
    const solid = world.add({ shape: rigidCircle(20), x: 600, y: 900 });
    const ghostFriend = world.add({ shape: rigidCircle(20), x: 400, y: 840, category: 2, mask: 2 });
    run(world, 1);
    expect(ghost.y).toBeGreaterThan(1100);
    expect(ghostFriend.y).toBeGreaterThan(1100);
    expect(Math.abs(ghostFriend.y - ghost.y)).toBeGreaterThan(39);
    expect(solid.y).toBeCloseTo(980, 0);
  });
});

describe('RigidWorld queries', () => {
  it('raycasts to the closest hit with a normal and queries points', () => {
    const world = new RigidWorld({ gravity: 0 });
    const box = world.add({ shape: rigidBox(100, 100), x: 400, y: 300, angle: Math.PI / 4 });
    const ball = world.add({ shape: rigidCircle(30), x: 700, y: 300 });
    world.add({ shape: rigidCircle(30), x: 900, y: 300, sensor: true });
    const hit = world.raycast(0, 300, 1000, 300)!;
    expect(hit.body).toBe(box);
    expect(hit.x).toBeCloseTo(400 - 50 * Math.SQRT2, 3);
    expect(hit.nx).toBeCloseTo(-Math.SQRT1_2, 3);
    expect(Math.abs(hit.ny)).toBeCloseTo(Math.SQRT1_2, 3);
    expect(hit.distance).toBeCloseTo(hit.x, 3);
    const behind = world.raycast(500, 300, 1000, 300)!;
    expect(behind.body).toBe(ball);
    expect(behind.x).toBeCloseTo(670, 3);
    expect(behind.nx).toBeCloseTo(-1, 3);
    expect(world.raycast(400, 300, 1000, 300)!.body).toBe(ball);
    expect(world.raycast(0, 300, 1000, 300, { ignore: box })!.body).toBe(ball);
    expect(world.raycast(0, 100, 1000, 100)).toBeNull();
    expect(world.queryPoint(400, 300 - 65)).toEqual([box]);
    expect(world.queryPoint(400 - 60, 300 - 60)).toEqual([]);
    expect(world.queryPoint(710, 310)).toEqual([ball]);
    expect(world.queryPoint(900, 300)).toEqual([]);
    expect(world.queryPoint(900, 300, { sensors: true })).toHaveLength(1);
    expect(world.queryAABB({ x: 600, y: 250, w: 400, h: 100 })).toEqual([ball]);
  });

  it('makes polygons from points around their centroid', () => {
    const tri = rigidPolygon([
      { x: 0, y: 0 },
      { x: 90, y: 0 },
      { x: 0, y: 90 },
      { x: 30, y: 30 },
    ]);
    expect(tri.count).toBe(3);
    expect(tri.centroidX).toBeCloseTo(30, 6);
    expect(tri.centroidY).toBeCloseTo(30, 6);
    const world = new RigidWorld({ gravity: 0 });
    const body = world.add({ type: 'static', shape: tri, x: tri.centroidX, y: tri.centroidY });
    expect(world.queryPoint(10, 10)).toEqual([body]);
    expect(world.queryPoint(60, 60)).toEqual([]);
  });
});

describe('RigidWorld behaviour', () => {
  function scene(seed: number): RigidWorld {
    const { world } = ground();
    world.add({ type: 'static', shape: rigidBox(40, 800), x: 180, y: 600 });
    world.add({ type: 'static', shape: rigidBox(40, 800), x: 820, y: 600 });
    const rng = new Rng(seed);
    for (let i = 0; i < 40; i++) {
      const x = rng.float(260, 740);
      const y = 900 - i * 30;
      if (i % 2) world.add({ shape: rigidCircle(rng.float(10, 30)), x, y, restitution: 0.2 });
      else world.add({ shape: rigidBox(rng.float(20, 60), rng.float(20, 60)), x, y, angle: rng.float(0, 3) });
    }
    return world;
  }

  it('is deterministic', () => {
    const a = scene(7);
    const b = scene(7);
    run(a, 3);
    run(b, 3);
    const snap = (w: RigidWorld) => w.bodies.map((o) => `${o.x},${o.y},${o.angle},${o.sleeping}`).join(';');
    expect(snap(a)).toBe(snap(b));
    expect(a.dump(200)).toBe(b.dump(200));
  });

  it('finds every overlapping pair whichever axis the broadphase sweeps', () => {
    const world = new RigidWorld({ substeps: 1 });
    world.add({ type: 'static', shape: rigidBox(4000, 100), x: 500, y: 1050 });
    const walls = [
      world.add({ type: 'static', shape: rigidBox(40, 3000), x: 440, y: -500 }),
      world.add({ type: 'static', shape: rigidBox(40, 3000), x: 560, y: -500 }),
    ];
    const rng = new Rng(4);
    for (let i = 0; i < 40; i++) {
      const o = { x: 500 + rng.float(-8, 8), y: 960 - i * 60, angle: rng.float(0, 3) };
      world.add(i % 2 ? { shape: rigidCircle(rng.float(14, 28)), ...o } : { shape: rigidBox(rng.float(20, 50), rng.float(20, 50)), ...o });
    }
    const sweepY = () => (world as unknown as { sweepY: boolean }).sweepY;
    const key = (a: RigidBody, b: RigidBody) => (a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`);
    const axes = new Set<boolean>();
    for (let s = 0; s < 300; s++) {
      if (s === 60) for (const w of walls) world.remove(w);
      // With one substep the broadphase runs once, on the AABBs as they are before the step.
      const expected: string[] = [];
      const bodies = world.bodies;
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i]!;
          const b = bodies[j]!;
          if ((a.type !== 'dynamic' || a.sleeping) && (b.type !== 'dynamic' || b.sleeping)) continue;
          if (a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY) continue;
          expected.push(key(a, b));
        }
      }
      world.step(H);
      axes.add(sweepY());
      const found = world.contacts.map((c) => key(c.a, c.b));
      expect(new Set(found).size).toBe(found.length);
      const have = new Set(found);
      expect(expected.filter((k) => !have.has(k))).toEqual([]);
    }
    expect(axes).toEqual(new Set([true, false]));
  });

  it('replays identically after clear(), whatever sweep axis the previous scene left', () => {
    const scene = (w: RigidWorld) => {
      w.add({ type: 'static', shape: rigidBox(700, 40), x: 300, y: -20 });
      w.add({ type: 'static', shape: rigidBox(700, 40), x: 300, y: 620 });
      w.add({ type: 'static', shape: rigidBox(40, 700), x: -20, y: 300 });
      w.add({ type: 'static', shape: rigidBox(40, 700), x: 620, y: 300 });
      const rng = new Rng(2);
      for (let i = 0; i < 100; i++) {
        w.add({ shape: rigidCircle(rng.float(10, 20)), x: 30 + (i % 10) * 60, y: 30 + Math.floor(i / 10) * 60, vx: rng.float(-300, 300), vy: rng.float(-300, 300), restitution: 0.5 });
      }
    };
    const fresh = new RigidWorld({ gravity: 0 });
    scene(fresh);
    run(fresh, 2);
    const reused = new RigidWorld({ gravity: 0 });
    for (let i = 0; i < 30; i++) reused.add({ shape: rigidCircle(10), x: 0, y: i * 30 });
    reused.step(H);
    reused.clear();
    scene(reused);
    run(reused, 2);
    const snap = (w: RigidWorld) => w.bodies.map((o) => `${o.x},${o.y},${o.vx},${o.vy}`).join(';');
    expect(snap(reused)).toBe(snap(fresh));
  });

  it('keeps resting contacts in touches while the whole world sleeps', () => {
    const { world } = ground();
    const boxes = [0, 1, 2].map((i) => world.add({ shape: rigidBox(40, 40), x: 500, y: 980 - i * 40 }));
    run(world, 2);
    expect(boxes.every((b) => b.sleeping)).toBe(true);
    const key = (a: RigidBody, b: RigidBody) => [a.name || a.id, b.name || b.id].sort().join('-');
    const pairs = () => world.touches.map((c) => key(c.a, c.b)).sort();
    const resting = pairs();
    expect(resting).toHaveLength(3);
    const where = boxes.map((b) => `${b.x},${b.y},${b.angle}`);
    let events = 0;
    world.on('contactBegin', () => events++);
    world.on('contactEnd', () => events++);
    run(world, 1);
    expect(pairs()).toEqual(resting);
    expect(boxes.map((b) => `${b.x},${b.y},${b.angle}`)).toEqual(where);
    expect(events).toBe(0);
  });

  it('defers adds and removes made inside contact callbacks', () => {
    const { world, floor } = ground();
    const ball = world.add({ shape: rigidCircle(20), x: 500, y: 900 });
    const log: string[] = [];
    let spawned: RigidBody | null = null;
    world.on('contactBegin', (e) => {
      if (e.contact.other(floor) !== ball) return;
      world.remove(ball);
      spawned = world.add({ shape: rigidCircle(10), x: 100, y: 100 });
      log.push(`begin world=${ball.world === null ? 'null' : 'set'} bodies=${world.bodies.length}`);
    });
    world.on('contactEnd', (e) => log.push(`end ${e.a === ball || e.b === ball}`));
    world.on('step', () => {
      if (spawned) log.push(`step bodies=${world.bodies.length}`);
    });
    for (let i = 0; i < 60 && !spawned; i++) world.step(H);
    expect(log).toEqual(['begin world=null bodies=2', 'end true', 'step bodies=2']);
    expect(world.bodies).not.toContain(ball);
    expect(world.bodies).toContain(spawned);
    expect(world.contacts.some((c) => c.a === ball || c.b === ball)).toBe(false);
  });

  it('merges same-level touching circles from the step event (skill doc example)', () => {
    const { world } = ground();
    const RADIUS = [26, 38];
    world.add({ shape: rigidCircle(26), x: 470, y: 900, userData: { level: 0 } });
    world.add({ shape: rigidCircle(26), x: 490, y: 800, userData: { level: 0 } });
    world.on('step', () => {
      const used = new Set<RigidBody>();
      for (const c of world.touches) {
        const fa = c.a.userData as { level: number } | null;
        const fb = c.b.userData as { level: number } | null;
        if (c.sensor || !fa || !fb || fa.level !== fb.level || used.has(c.a) || used.has(c.b)) continue;
        used.add(c.a);
        used.add(c.b);
        const x = (c.a.x + c.b.x) / 2;
        const y = (c.a.y + c.b.y) / 2;
        world.remove(c.a);
        world.remove(c.b);
        world.add({ shape: rigidCircle(RADIUS[fa.level + 1]!), x, y, userData: { level: fa.level + 1 } });
      }
    });
    run(world, 2);
    const fruits = world.bodies.filter((b) => b.type === 'dynamic');
    expect(fruits.map((b) => (b.userData as { level: number }).level)).toEqual([1]);
    expect(fruits[0]!.y).toBeCloseTo(1000 - 38, 0);
  });

  it('wakes sleeping bodies on impulse, teleport, removal of support and contact', () => {
    const { world } = ground();
    const lower = world.add({ shape: rigidBox(40, 40), x: 500, y: 980 });
    const upper = world.add({ shape: rigidBox(40, 40), x: 500, y: 940 });
    const side = world.add({ shape: rigidBox(40, 40), x: 700, y: 980 });
    run(world, 1.5);
    expect([lower.sleeping, upper.sleeping, side.sleeping]).toEqual([true, true, true]);
    side.applyImpulse(0, -side.mass * 300);
    expect(side.sleeping).toBe(false);
    run(world, 1.5);
    expect(side.sleeping).toBe(true);
    world.remove(lower);
    expect(upper.sleeping).toBe(false);
    run(world, 1.5);
    expect(upper.y).toBeCloseTo(980, 0);
    expect(upper.sleeping).toBe(true);
    side.setPosition(500, 900);
    expect(side.sleeping).toBe(false);
    run(world, 0.5);
    expect(upper.sleeping).toBe(false);
  });

  it('lets a kinematic paddle push dynamic bodies', () => {
    const { world } = ground();
    const paddle = world.add({ type: 'kinematic', shape: rigidBox(20, 80), x: 300, y: 960, vx: 200 });
    const crate = world.add({ shape: rigidBox(40, 40), x: 400, y: 980 });
    run(world, 1);
    expect(paddle.x).toBeCloseTo(500, 3);
    expect(crate.x).toBeGreaterThan(paddle.x + 25);
  });

  it('syncs bound nodes with optional interpolation', () => {
    const world = new RigidWorld({ gravity: 0, interpolate: true });
    const body = world.add({ shape: rigidBox(40, 40), x: 0, y: 0, vx: 60, av: 1 });
    const node = new Node();
    bindRigidNode(node, body, { offsetX: 10 });
    expect(node.x).toBe(10);
    const alpha = world.update(1.5 / 60);
    expect(alpha).toBeCloseTo(0.5, 6);
    expect(body.x).toBeCloseTo(1, 6);
    const a = 0.5 / 60;
    expect(node.x).toBeCloseTo(0.5 + 10 * Math.cos(a), 6);
    expect(node.rotation).toBeCloseTo(a, 6);
    node.destroy();
    expect(body.node).toBeNull();
  });

  it('steps 200 mixed bodies at 60 Hz quickly (perf smoke)', () => {
    const world = new RigidWorld();
    world.add({ type: 'static', shape: rigidBox(1400, 100), x: 500, y: 1050 });
    world.add({ type: 'static', shape: rigidBox(100, 1400), x: -50, y: 400 });
    world.add({ type: 'static', shape: rigidBox(100, 1400), x: 1050, y: 400 });
    const rng = new Rng(3);
    for (let i = 0; i < 200; i++) {
      const x = 40 + (i % 20) * 46 + rng.float(-3, 3);
      const y = 950 - Math.floor(i / 20) * 50;
      if (i % 2) world.add({ shape: rigidCircle(rng.float(14, 22)), x, y });
      else world.add({ shape: rigidBox(rng.float(26, 40), rng.float(26, 40)), x, y });
    }
    run(world, 0.5);
    const t0 = performance.now();
    const steps = 120;
    for (let i = 0; i < steps; i++) world.step(H);
    const ms = (performance.now() - t0) / steps;
    let touching = 0;
    for (const c of world.contacts) if (c.touching) touching++;
    console.log(`rigid perf: 200 bodies, ${touching} touching contacts, ${ms.toFixed(3)} ms/step`);
    expect(ms).toBeLessThan(25);
  });
});
