import { describe, expect, it } from 'vitest';
import {
  createRigidChain,
  createRigidRagdoll,
  rigidBox,
  rigidCircle,
  RigidRevoluteJoint,
  RigidWorld,
  type RigidBody,
  type RigidJoint,
  type RigidWorldOptions,
} from './rigid';

const H = 1 / 60;
const run = (w: RigidWorld, seconds: number, each?: () => void) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    w.step(H);
    each?.();
  }
};

/** World with a static ground whose top is at y = 1000. */
function ground(opts: RigidWorldOptions = {}): { world: RigidWorld; floor: RigidBody } {
  const world = new RigidWorld(opts);
  const floor = world.add({ type: 'static', name: 'floor', shape: rigidBox(4000, 100), x: 1000, y: 1050 });
  return { world, floor };
}

const separation = (j: RigidJoint) => {
  const a = j.anchorWorldA();
  const b = j.anchorWorldB();
  return Math.hypot(b.x - a.x, b.y - a.y);
};

const maxSeparation = (joints: readonly RigidJoint[]) => Math.max(0, ...joints.map(separation));

describe('RigidWorld distance joint', () => {
  it('keeps a pendulum at its length while it swings', () => {
    const world = new RigidWorld({ gravity: 1600 });
    const pivot = world.add({ type: 'static', name: 'pivot', shape: rigidCircle(4), x: 400, y: 200 });
    const bob = world.add({ name: 'bob', shape: rigidCircle(16), x: 550, y: 200 });
    const rod = world.addJoint({ type: 'distance', a: pivot, b: bob });
    expect(rod.length).toBeCloseTo(150, 6);
    let worst = 0;
    let lowest = 0;
    let leftmost = Infinity;
    run(world, 4, () => {
      worst = Math.max(worst, Math.abs(Math.hypot(bob.x - 400, bob.y - 200) - 150));
      lowest = Math.max(lowest, bob.y);
      leftmost = Math.min(leftmost, bob.x);
    });
    expect(worst / 150).toBeLessThan(0.01);
    expect(lowest).toBeGreaterThan(345);
    expect(leftmost).toBeLessThan(270);
    expect(rod.reactionForce()).toBeGreaterThan(0);
  });

  it('acts as a rope with minLength 0: slack below maxLength, taut at it', () => {
    const world = new RigidWorld({ gravity: 1600 });
    const hook = world.add({ type: 'static', shape: rigidCircle(4), x: 400, y: 200 });
    const crate = world.add({ shape: rigidBox(40, 40), x: 400, y: 260 });
    const rope = world.addJoint({ type: 'distance', a: hook, b: crate, length: 150, minLength: 0 });
    expect(rope.minLength).toBe(0);
    expect(rope.maxLength).toBe(150);
    world.step(H);
    // Slack: falls freely at first.
    expect(crate.vy).toBeCloseTo(1600 * H, 3);
    let longest = 0;
    run(world, 3, () => (longest = Math.max(longest, crate.y - 200)));
    expect(longest).toBeLessThan(150 * 1.01);
    expect(crate.y - 200).toBeCloseTo(150, 0);
    // Pushed up it goes slack again (rope never pushes).
    crate.setVelocity(0, -300);
    world.step(H);
    expect(crate.y - 200).toBeLessThan(150);
  });

  it('springs toward its rest length', () => {
    const world = new RigidWorld({ gravity: 0 });
    const anchor = world.add({ type: 'static', shape: rigidCircle(4), x: 0, y: 0 });
    const ball = world.add({ shape: rigidCircle(10), x: 200, y: 0 });
    const spring = world.addJoint({ type: 'distance', a: anchor, b: ball, length: 100, springHz: 2, dampingRatio: 0.2 });
    let minX = Infinity;
    run(world, 0.6, () => (minX = Math.min(minX, ball.x)));
    expect(minX).toBeLessThan(90);
    run(world, 6);
    expect(ball.x).toBeCloseTo(100, 0);
    expect(spring.describe()).toContain('spring=2Hz');
  });
});

describe('RigidWorld revolute joint', () => {
  it('honours angle limits under load', () => {
    const { world } = ground();
    const post = world.add({ type: 'static', shape: rigidBox(20, 20), x: 300, y: 500 });
    const plank = world.add({ shape: rigidBox(240, 16), x: 420, y: 500 });
    const hinge = world.addJoint({ type: 'revolute', a: post, b: plank, anchor: { x: 300, y: 500 }, lowerAngle: -0.3, upperAngle: 0.3 });
    world.add({ shape: rigidBox(50, 50), x: 500, y: 460, density: 0.004 });
    let maxAngle = -Infinity;
    let maxSep = 0;
    run(world, 3, () => {
      maxAngle = Math.max(maxAngle, hinge.angle());
      maxSep = Math.max(maxSep, separation(hinge));
    });
    expect(maxAngle).toBeLessThan(0.3 + 0.06);
    expect(hinge.angle()).toBeGreaterThan(0.25);
    expect(maxSep).toBeLessThan(1);
    expect(hinge.reactionTorque()).toBeLessThan(0);
    expect(world.dump()).toMatch(/joint revolute id\d+-id\d+ @300,500 angle=\d+(\.\d)?° limits=-17.2..17.2/);
  });

  it('drives a motor to its speed and limits its torque', () => {
    const world = new RigidWorld({ gravity: 1600 });
    const base = world.add({ type: 'static', shape: rigidCircle(5), x: 300, y: 300 });
    const wheel = world.add({ shape: rigidCircle(50), x: 300, y: 300 });
    const motor = world.addJoint({ type: 'revolute', a: base, b: wheel, motorSpeed: 3, maxMotorTorque: 1e7 });
    run(world, 0.5);
    expect(wheel.av).toBeCloseTo(3, 3);
    expect(motor.speed()).toBeCloseTo(3, 3);
    // A weak motor accelerates at torque / inertia.
    motor.setMotor(-3, wheel.inertia * 2);
    run(world, 0.5);
    expect(wheel.av).toBeCloseTo(3 - 2 * 0.5, 1);
    expect(Math.abs(motor.motorTorque())).toBeCloseTo(wheel.inertia * 2, 0);
  });

  it('springs back to targetAngle after a hit', () => {
    const world = new RigidWorld({ gravity: 0 });
    const base = world.add({ type: 'static', shape: rigidCircle(5), x: 300, y: 300 });
    const bar = world.add({ shape: rigidBox(120, 12), x: 360, y: 300 });
    const j = world.addJoint({ type: 'revolute', a: base, b: bar, anchor: { x: 300, y: 300 }, targetAngle: 0.8, springHz: 3, dampingRatio: 1 });
    run(world, 2);
    expect(j.angle()).toBeCloseTo(0.8, 2);
    const end = j.anchorWorldA();
    bar.applyImpulse(0, -bar.mass * 600, end.x + Math.cos(bar.angle) * 120, end.y + Math.sin(bar.angle) * 120);
    world.step(H);
    expect(j.angle()).toBeLessThan(0.75);
    run(world, 2);
    expect(j.angle()).toBeCloseTo(0.8, 2);
    j.setTarget(-0.5);
    run(world, 2);
    expect(j.angle()).toBeCloseTo(-0.5, 2);
  });

  it('keeps a pinned wheel on its axle while rolling on the ground', () => {
    const { world } = ground();
    const cart = world.add({ shape: rigidBox(160, 30), x: 400, y: 900 });
    const wheelA = world.add({ shape: rigidCircle(30), x: 340, y: 930, friction: 0.9 });
    const wheelB = world.add({ shape: rigidCircle(30), x: 460, y: 930, friction: 0.9 });
    const axleA = world.addJoint({ type: 'revolute', a: cart, b: wheelA, motorSpeed: 8, maxMotorTorque: 5e6 });
    const axleB = world.addJoint({ type: 'revolute', a: cart, b: wheelB });
    let maxSep = 0;
    run(world, 2, () => (maxSep = Math.max(maxSep, separation(axleA), separation(axleB))));
    expect(maxSep).toBeLessThan(1);
    expect(cart.x).toBeGreaterThan(600);
  });
});

describe('RigidWorld weld and mouse joints', () => {
  it('holds two welded boxes as one body through a fall', () => {
    const { world } = ground();
    const a = world.add({ shape: rigidBox(60, 30), x: 400, y: 700, angle: 0.4 });
    const bx = 400 + Math.cos(0.4) * 60;
    const by = 700 + Math.sin(0.4) * 60;
    const b = world.add({ shape: rigidBox(60, 30), x: bx, y: by, angle: 0.4 });
    const weld = world.addJoint({ type: 'weld', a, b, anchor: { x: (400 + bx) / 2, y: (700 + by) / 2 } });
    let worstD = 0;
    let worstA = 0;
    run(world, 3, () => {
      worstD = Math.max(worstD, Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 60));
      worstA = Math.max(worstA, Math.abs(weld.angle()));
    });
    expect(worstD).toBeLessThan(1);
    expect(worstA).toBeLessThan(0.03);
    expect(Math.max(a.maxY, b.maxY)).toBeGreaterThan(995);
    expect(a.sleeping && b.sleeping).toBe(true);
  });

  it('drags a body to the mouse target', () => {
    const { world } = ground();
    const crate = world.add({ shape: rigidBox(50, 50), x: 400, y: 975 });
    run(world, 1);
    expect(crate.sleeping).toBe(true);
    const mouse = world.addJoint({ type: 'mouse', body: crate, target: { x: 410, y: 965 } });
    expect(crate.sleeping).toBe(false);
    expect(mouse.a).toBe(crate);
    mouse.setTarget(600, 700);
    run(world, 2);
    expect(Math.hypot(crate.x + 10 - 600, crate.y + 10 - 700)).toBeLessThan(40);
    const p = mouse.anchorWorldB();
    expect(Math.hypot(p.x - 600, p.y - 700)).toBeLessThan(5);
    world.removeJoint(mouse);
    expect(world.joints.length).toBe(0);
    run(world, 2);
    expect(crate.y).toBeGreaterThan(970);
  });
});

describe('RigidWorld joint lifecycle', () => {
  it('breaks a joint above breakForce and emits jointBreak', () => {
    const world = new RigidWorld({ gravity: 1600 });
    const hook = world.add({ type: 'static', shape: rigidCircle(4), x: 400, y: 200 });
    const light = world.add({ shape: rigidBox(40, 40), x: 300, y: 300 });
    const heavy = world.add({ shape: rigidBox(40, 40), x: 500, y: 300, density: 0.01 });
    const weight = heavy.mass * 1600;
    const strong = world.addJoint({ type: 'distance', a: hook, b: light, breakForce: weight * 0.8 });
    const weak = world.addJoint({ type: 'distance', a: hook, b: heavy, breakForce: weight * 0.8, name: 'weak' });
    const broken: RigidJoint[] = [];
    world.on('jointBreak', (j) => {
      expect(world.joints.includes(j)).toBe(false);
      broken.push(j);
    });
    run(world, 1);
    expect(broken).toEqual([weak]);
    expect(weak.broken).toBe(true);
    expect(weak.world).toBe(null);
    expect(strong.broken).toBe(false);
    expect(world.joints).toEqual([strong]);
    expect(heavy.joints.length).toBe(0);
    expect(heavy.y).toBeGreaterThan(600);
  });

  it('removes the joints of a removed body and wakes the partner', () => {
    const { world } = ground();
    const a = world.add({ shape: rigidBox(40, 40), x: 400, y: 980 });
    const b = world.add({ shape: rigidBox(40, 40), x: 460, y: 980 });
    const j = world.addJoint({ type: 'distance', a, b });
    run(world, 1.5);
    expect(a.sleeping && b.sleeping).toBe(true);
    world.remove(a);
    expect(world.joints.length).toBe(0);
    expect(j.world).toBe(null);
    expect(b.joints.length).toBe(0);
    expect(b.sleeping).toBe(false);
  });

  it('shares a sleep island across joints and wakes jointed bodies together', () => {
    const { world } = ground();
    const a = world.add({ shape: rigidBox(40, 40), x: 400, y: 980 });
    const b = world.add({ shape: rigidBox(40, 40), x: 600, y: 980 });
    world.addJoint({ type: 'distance', a, b, minLength: 0 });
    run(world, 1.5);
    expect(a.sleeping && b.sleeping).toBe(true);
    b.applyImpulse(0, -10 * b.mass);
    expect(a.sleeping).toBe(false);
    run(world, 2);
    expect(a.sleeping && b.sleeping).toBe(true);
    b.setPosition(620, 980);
    expect(a.sleeping).toBe(false);
    run(world, 2);
    expect(a.sleeping && b.sleeping).toBe(true);
    // A body kept awake keeps its jointed partner awake.
    b.allowSleep = false;
    b.wake();
    run(world, 2);
    expect(a.sleeping).toBe(false);
  });

  it('skips contacts between jointed bodies unless collideConnected', () => {
    const { world } = ground({ gravity: 0 });
    const a = world.add({ shape: rigidBox(60, 60), x: 300, y: 500 });
    const b = world.add({ shape: rigidBox(60, 60), x: 340, y: 500 });
    world.addJoint({ type: 'revolute', a, b, anchor: { x: 320, y: 500 } });
    const c = world.add({ shape: rigidBox(60, 60), x: 600, y: 500 });
    const d = world.add({ shape: rigidBox(60, 60), x: 640, y: 500 });
    world.addJoint({ type: 'revolute', a: c, b: d, anchor: { x: 620, y: 500 }, collideConnected: true });
    world.step(H);
    const pairs = world.touches.map((t) => [t.a, t.b]);
    expect(pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a))).toBe(false);
    expect(pairs.some(([x, y]) => (x === c && y === d) || (x === d && y === c))).toBe(true);
  });

  it('filters by group: negative never collides, positive always does', () => {
    const { world } = ground({ gravity: 0 });
    const a = world.add({ shape: rigidBox(60, 60), x: 300, y: 500, group: -1 });
    const b = world.add({ shape: rigidBox(60, 60), x: 340, y: 500, group: -1 });
    const c = world.add({ shape: rigidBox(60, 60), x: 600, y: 500, group: 2, mask: 0 });
    const d = world.add({ shape: rigidBox(60, 60), x: 640, y: 500, group: 2, mask: 0 });
    world.step(H);
    const touching = (x: RigidBody, y: RigidBody) => world.touches.some((t) => (t.a === x && t.b === y) || (t.a === y && t.b === x));
    expect(touching(a, b)).toBe(false);
    expect(touching(c, d)).toBe(true);
    expect(a.describe()).toContain('group=-1');
  });

  it('defers addJoint / removeJoint made inside callbacks and clears joints with the world', () => {
    const { world } = ground();
    const ball = world.add({ name: 'ball', shape: rigidCircle(20), x: 400, y: 900 });
    let made: RigidJoint | null = null;
    world.on('contactBegin', (e) => {
      if (made || e.a.type === e.b.type) return;
      const hook = world.add({ type: 'static', name: 'hook', shape: rigidCircle(4), x: 400, y: 600 });
      made = world.addJoint({ type: 'distance', a: hook, b: ball, minLength: 0, name: 'tether' });
      expect(world.joints.length).toBe(0);
    });
    run(world, 1);
    expect(made).not.toBe(null);
    expect(world.joints).toEqual([made]);
    expect(world.dump()).toContain('joint distance #tether #hook-#ball');
    expect(world.dump().split('\n')[0]).toContain('joints=1');
    world.on('step', () => {
      if (made && made.world) world.removeJoint(made);
    });
    world.step(H);
    expect(world.joints.length).toBe(0);
    const again = world.addJoint({ type: 'distance', a: world.get('hook')!, b: ball });
    world.clear();
    expect(world.joints.length).toBe(0);
    expect(again.world).toBe(null);
    expect(ball.joints.length).toBe(0);
  });

  it('rejects joints to bodies outside the world', () => {
    const world = new RigidWorld();
    const a = world.add({ shape: rigidCircle(10), x: 0, y: 0 });
    const other = new RigidWorld().add({ shape: rigidCircle(10), x: 50, y: 0 });
    expect(() => world.addJoint({ type: 'distance', a, b: other })).toThrow(/add both bodies/);
    expect(() => world.addJoint({ type: 'weld', a, b: a })).toThrow(/same body/);
  });
});

describe('ragdoll and chain presets', () => {
  it('drops a limp ragdoll that settles connected and sleeps', () => {
    const { world } = ground();
    const guy = createRigidRagdoll(world, { x: 500, y: 600, angle: 0.5, vx: 120 });
    expect(Object.keys(guy.parts).length).toBe(10);
    expect(guy.joints.length).toBe(9);
    expect(guy.bodies.length).toBe(10);
    expect(maxSeparation(guy.joints)).toBeLessThan(0.01);
    let worst = 0;
    run(world, 6, () => (worst = Math.max(worst, maxSeparation(guy.joints))));
    expect(worst).toBeLessThan(3);
    for (const b of guy.bodies) expect(b.maxY).toBeLessThan(1002);
    expect(guy.bodies.every((b) => b.sleeping)).toBe(true);
    for (const def of guy.joints) {
      expect(def.angle()).toBeGreaterThan(def.lowerAngle - 0.1);
      expect(def.angle()).toBeLessThan(def.upperAngle + 0.1);
    }
  });

  it('keeps a stiff ragdoll standing with its head above the pelvis', () => {
    const { world } = ground();
    const guy = createRigidRagdoll(world, { x: 500, y: 1000 - 86.5, stiffness: 1 });
    const { head, torso } = guy.parts;
    const hip = () => guy.joint.hipF.anchorWorldA();
    const headStart = head.y;
    let worst = -Infinity;
    run(world, 2, () => (worst = Math.max(worst, head.y - (hip().y - 60))));
    expect(worst).toBeLessThan(0);
    expect(Math.abs(head.x - hip().x)).toBeLessThan(25);
    expect(Math.abs(head.y - headStart)).toBeLessThan(15);
    expect(Math.abs(torso.angle)).toBeLessThan(0.3);
    // A hit makes it flinch; it does not fall apart.
    guy.impulse(torso.x, torso.y - 20, 150 * torso.mass, 0);
    run(world, 1);
    expect(maxSeparation(guy.joints)).toBeLessThan(3);
  });

  it('turns a limp ragdoll stiff and mirrors joint limits when facing left', () => {
    const { world } = ground();
    const left = createRigidRagdoll(world, { x: 300, y: 700, facing: -1, pose: 'limp', name: 'L' });
    const right = createRigidRagdoll(world, { x: 700, y: 700, pose: 'limp', name: 'R' });
    expect(left.group).not.toBe(right.group);
    expect(left.joint.kneeF.lowerAngle).toBeCloseTo(-right.joint.kneeF.upperAngle, 6);
    expect(left.joint.kneeF.springHz).toBe(0);
    left.setStiffness(1);
    expect(left.joint.kneeF.springHz).toBeGreaterThan(1);
    expect(left.partOf(left.parts.head)).toBe('head');
    expect(left.partOf(right.parts.head)).toBe(null);
    expect(world.get('L.head')).toBe(left.parts.head);
    right.remove();
    expect(world.bodies.length).toBe(11);
    expect(world.joints.length).toBe(9);
  });

  it('hangs a chain bridge that holds a crate', () => {
    const world = new RigidWorld({ gravity: 1600 });
    const bridge = createRigidChain(world, { from: { x: 100, y: 400 }, to: { x: 600, y: 400 }, links: 12, linkLength: 44, linkWidth: 10 });
    expect(bridge.bodies.length).toBe(12);
    expect(bridge.joints.length).toBe(13);
    expect(bridge.pins.length).toBe(2);
    expect(maxSeparation(bridge.joints)).toBeLessThan(0.5);
    const mid = bridge.bodies[6]!;
    expect(mid.y).toBeGreaterThan(440);
    const crate = world.add({ shape: rigidBox(50, 50), x: 350, y: 300 });
    let worst = 0;
    run(world, 4, () => (worst = Math.max(worst, maxSeparation(bridge.joints))));
    expect(worst).toBeLessThan(4);
    expect(crate.y).toBeLessThan(mid.y);
    expect(crate.y).toBeGreaterThan(400);
    expect(Math.abs(crate.x - 350)).toBeLessThan(60);
    expect(crate.speed).toBeLessThan(5);
    // Pins never collide nor show in queries.
    expect(world.queryPoint(100, 400).some((b) => bridge.pins.includes(b))).toBe(false);
  });

  it('hangs a rope from a point with a body at its end', () => {
    const world = new RigidWorld({ gravity: 1600 });
    const lamp = world.add({ shape: rigidCircle(20), x: 500, y: 400 });
    // 10 x 30 is shorter than the 360.6 span, so the links grow to span / 10 (taut).
    const rope = createRigidChain(world, { from: { x: 300, y: 100 }, to: { body: lamp }, links: 10, linkLength: 30 });
    expect(rope.joints[10]!.b).toBe(lamp);
    expect(rope.bodies[0]!.shape.type === 'polygon' && rope.bodies[0]!.shape.width).toBeCloseTo(Math.hypot(200, 300) / 10, 6);
    let longest = 0;
    let worst = 0;
    let lowest = 0;
    run(world, 5, () => {
      longest = Math.max(longest, Math.hypot(lamp.x - 300, lamp.y - 100));
      worst = Math.max(worst, maxSeparation(rope.joints));
      lowest = Math.max(lowest, lamp.y);
    });
    expect(longest).toBeLessThan(360 + 10 * 2);
    expect(lowest).toBeGreaterThan(420);
    expect(worst).toBeLessThan(2);
  });

  it('is deterministic with joints', () => {
    const build = () => {
      const { world } = ground();
      createRigidRagdoll(world, { x: 400, y: 700, angle: 0.3, stiffness: 0.5 });
      createRigidChain(world, { from: { x: 600, y: 500 }, to: { x: 900, y: 500 }, links: 8, linkLength: 42 });
      const pivot = world.add({ type: 'static', shape: rigidCircle(4), x: 200, y: 500 });
      const bob = world.add({ shape: rigidCircle(15), x: 320, y: 440 });
      world.addJoint({ type: 'distance', a: pivot, b: bob });
      world.add({ shape: rigidBox(40, 40), x: 750, y: 300 });
      return world;
    };
    const a = build();
    const b = build();
    run(a, 3);
    run(b, 3);
    expect(a.dump(200)).toBe(b.dump(200));
    expect(a.joints.every((j) => j instanceof RigidRevoluteJoint || j.type === 'distance')).toBe(true);
  });
});
