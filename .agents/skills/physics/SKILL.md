---
name: physics
description: >-
  2D physics in this engine (物理 / 刚体 / 碰撞 / 堆叠). Use when a game needs rigid bodies that rotate, roll, stack
  and topple (boxes, circles, convex polygons, fruit/ball merge games like 合成大西瓜, plinko, physics puzzles), or
  arcade movement (platformer/top-down heroes vs tile maps). Covers choosing RigidWorld vs PhysicsWorld/ArcadeBody,
  fixed-step setup and interpolation, syncing nodes (bindRigidNode), contact events (contactBegin/contactEnd, touches) for
  game rules such as merging or scoring, sensors and category/mask filtering, raycast/queryPoint/queryAABB, impulses and
  forces, sleeping, joints (distance/rope/spring, revolute hinge with limits/motor/spring, weld, mouse drag, breakable
  joints, group filtering), ragdoll and chain/rope/bridge presets (createRigidRagdoll, createRigidChain), debug drawing
  (drawRigidWorld, RigidDebugView, dump), solver tuning (iterations, slop, margins,
  sleep thresholds, damping, substeps), pitfalls (tunnelling, mass ratios, design-unit scale) and headless vitest tests.
  Keywords: rigid body, collision, collision detection, stacking, friction, restitution, bounce, gravity, sensor, trigger,
  raycast, joint, hinge, motor, pendulum, rope, chain, bridge, ragdoll, Box2D-like, 物理引擎, 刚体, 碰撞, 堆叠, 弹性,
  摩擦, 关节, 铰链, 绳子, 链条, 吊桥, 布娃娃.
---

# Physics: RigidWorld and PhysicsWorld

Two systems live in `engine/world/` and are exported from `'@engine'`:

| | `PhysicsWorld` + `ArcadeBody` (`physics.ts`) | `RigidWorld` + `RigidBody` (`rigid*.ts`) |
|---|---|---|
| Shapes | AABB, circle; never rotate | circle, convex polygon (`rigidBox`, `rigidPolygon`); rotate |
| Tiles | `addTileMap(map)`: exact per-axis sweeps, one-way tiles | none (build static boxes/polygons yourself) |
| Solver | separate overlaps, bounce, drag | sequential impulses + warm starting, friction, restitution, NGS position correction |
| Stacking | poor (no rotation, no friction solve) | stable towers/pyramids/piles, sleeping |
| Use for | platformer / top-down heroes, bullets, pickups | crates that topple, rolling balls, fruit/merge games, plinko, physics puzzles |

Rule of thumb: character controllers on tile maps -> `PhysicsWorld`. Anything that must stack, roll or rotate ->
`RigidWorld`. Do not mix the two on the same objects.

Arcade performance notes: a `PhysicsWorld` step allocates next to nothing: the `SpatialHash` broadphase reuses
its cells and per-body records across `clear()` (bodies that stay in their cells skip the map lookups), the narrow
phase writes into scratch results, and `ArcadeCollision` payloads are only built when someone receives them
(`onCollide` / `onOverlap` on either body, or a `'collide'` / `'overlap'` listener), so leave unused callbacks `null`
and poll `touching` / `blocked` instead. 400 piled bodies (40 px boxes and r16 circles on a tile map) cost about
0.4 ms per step headless and ~35 KB of garbage (50 bodies: ~0.03 ms, ~4 KB). Queries take an optional `out` array
that results are appended to (`queryPoint(x, y, mask, out)`, `queryRect(r, mask, out)`, `queryCircle(x, y, r,
mask, out)`); `SpatialHash.queryInto(r, out)` overwrites `out` and returns the count, and the `collide.ts` overlap /
segment helpers take an optional `out` object. Keep `cellSize` (default 128) at 2-4x the typical body size; the
cell layout sets the pair order, so changing it changes trajectories (replays recorded with another size diverge).

Reference implementations: `sandbox/scenes/physics.ts` ('rigid-stack', 'rigid-plinko', 'rigid-joints'), the 合成大西瓜
adapter `game/physics.ts`, tests `engine/world/rigid.test.ts` and `engine/world/rigid-joint.test.ts` (joints, presets).

Hand-rolled physics (projectiles, Verlet bodies, hit tests outside any world) should use the pure geometry helpers in
`engine/core/geom.ts`: segment sweeps vs circle / capsule / rotated box, box-local frames and ballistics
(`ballisticAngle`, `ballisticMinSpeed`, `ballisticPath`). Cheat-sheet: [references/geometry.md](references/geometry.md).

## Quick start

```ts
import { bindRigidNode, rigidBox, rigidCircle, RigidWorld } from '@engine';

const world = new RigidWorld({ gravity: 1600 });                 // y down, design units, units/s²
world.add({ type: 'static', name: 'floor', shape: rigidBox(750, 40), x: 375, y: 1200 });
const crate = world.add({ shape: rigidBox(60, 60), x: 375, y: 300, friction: 0.6 });
const ball = world.add({ shape: rigidCircle(24), x: 300, y: 100, restitution: 0.5, userData: { kind: 'ball' } });
world.attach(this.game, this);                                  // 60 Hz fixed steps from the game loop
bindRigidNode(crateNode, crate);                                // node.x/y/rotation follow the body
```

- `world.add(opts | body)` returns the `RigidBody`. Position is the **centre of mass** (circle centre, polygon
  centroid). `angle` is radians, positive = clockwise on screen (same as `Node.rotation`).
- Types: `'dynamic'` (default), `'static'` (never moves), `'kinematic'` (moves by its velocity only, pushes dynamics,
  e.g. a spinning paddle: `world.add({ type: 'kinematic', shape: rigidBox(170, 16), x, y, av: 2.4 })`).
- Mass comes from `density` (default 0.001 per square unit: a 100x100 box weighs 10). Friction of a pair is
  `sqrt(fa * fb)`, restitution is the max of the two.

### Shapes

```ts
rigidCircle(20);
rigidBox(80, 40);                                   // centred box
const tri = rigidPolygon([0, 0, 170, 60, 0, 60]);   // convex hull of the points, recentred to its centroid
world.add({ type: 'static', shape: tri, x: left + tri.centroidX, y: top + tri.centroidY }); // place by original coords
```

Shapes are immutable and shareable. To resize a body use `body.setShape(rigidCircle(r))` (recomputes mass, wakes).

## Fixed-step setup

`RigidWorld` implements `System`. Pick one driver:

| Driver | When |
|---|---|
| `world.attach(game, owner?)` | normal scenes; steps at `hz` (60) and syncs bound nodes; detaches when `owner` is destroyed |
| `world.update(dt)` in `onUpdate` | you want to time it or run game logic between frames; returns the interpolation alpha |
| `world.step(h?)` | game rules that own the clock (a model with its own `step(dt)`), tests, pre-warming a scene |

- `update(dt)` accumulates time and runs at most `maxSteps` (5) fixed steps; leftover time becomes `world.alpha`.
- `interpolate: true` makes `syncNodes` blend `prev*` -> current pose by `alpha` (smooth at any frame rate, one step
  of latency). Custom drawing should do the same: `x = b.prevX + (b.x - b.prevX) * world.alpha`.
- `substeps` splits each step into N collide + solve passes: stiffer piles and less tunnelling, linear cost.
- Deterministic: no randomness, insertion-order iteration, ids assigned on add. Same inputs -> same `dump()`.
  Lengths use `Math.sqrt(x * x + y * y)`, never `Math.hypot` (sqrt is correctly rounded everywhere, hypot differs
  between V8 and JavaScriptCore by an ulp, which a replay amplifies); keep that in rigid code. `Math.sin/cos` still
  vary by engine, so only same-engine replays are guaranteed bit-identical.
- Pre-warm a demo so screenshots show a settled state: `for (let i = 0; i < 120; i++) world.step();`.
- `world.paused = true` freezes `update()`.

## Syncing nodes and drawing

```ts
const node = view.add(new Sprite(tex, { anchor: 0.5 }));        // anchor = centre of mass
const unbind = bindRigidNode(node, body, { offsetX: 0, offsetY: 0, rotate: true, removeWithNode: true });
```

- The node's parent space must be physics space (put nodes and physics in the same `World` container or scene).
- `removeWithNode` removes the body when the node is destroyed; the binding always ends on 'destroyed'.
- Many bodies: skip nodes, draw them all in one `Paint`-style node (see `paintBodies` in `sandbox/scenes/physics.ts`).
- Debug: `view.add(new RigidDebugView(world, { contacts: true, aabbs: false, fill: false }))` or call
  `drawRigidWorld(ctx, world, opts)` inside a draw. Sleeping bodies are grey, sensors dashed green, contact points
  red with normals. `world.dump()` prints counts plus one `describe()` line per body; `body.describe()` alone too.

## Contacts for game rules

Two views of the same data, both filled by the solver:

1. **Events** `world.on('contactBegin' | 'contactEnd', (e) => ...)`, payload `RigidContactEvent`:
   `a, b, contact, sensor, nx, ny` (normal from a to b), `x, y` (point), `approachSpeed` (normal speed at first
   touch), `impulse` (normal impulse applied in the step it began; 0 for sensors / end).
2. **`world.touches`**: every contact that touched at any time during the last step (including brief touches that
   began and ended inside it and resting contacts of sleeping bodies), each once, rebuilt every step. Best for
   "are these two touching now" rules. Each item is a `RigidContact` (`a`, `b`, `sensor`, `touching`, `nx`, `ny`,
   `count`, `points`, `impulse`, `other(body)`).

Touching means the shapes are within `contactMargin` (1 unit) or collided within the step, so exactly-touching
bodies count. The `step` event fires after each step, once events and deferred adds/removes are done.

### Mutating inside callbacks

`add()` / `remove()` are safe anywhere. During a step (inside contact events) they are deferred until the step
ends; `body.world` becomes `null` at once, so use it as the "already consumed" flag. Inside the `step` event the
world is idle: removals are immediate and emit their `contactEnd` events synchronously.

### Merge example (合成大西瓜 style)

```ts
interface Fruit { level: number }
const RADIUS = [26, 38, 52, 60, 76, 92];

world.on('step', () => {
  const used = new Set<RigidBody>();
  for (const c of world.touches) {
    const fa = c.a.userData as Fruit | null;
    const fb = c.b.userData as Fruit | null;
    if (c.sensor || !fa || !fb || fa.level !== fb.level || used.has(c.a) || used.has(c.b)) continue;
    used.add(c.a);
    used.add(c.b);
    const x = (c.a.x + c.b.x) / 2;
    const y = (c.a.y + c.b.y) / 2;
    world.remove(c.a);
    world.remove(c.b);
    const level = fa.level + 1;
    world.add({ shape: rigidCircle(RADIUS[level]!), x, y, linearDamping: 0.4, userData: { level } });
  }
});
```

Keep rules pure: `game/physics.ts` wraps the world in a `FruitPhysics` class whose `step(dt)` returns the merge pairs
and leaves spawning/scoring to the model (`game/model.ts`), so the rules are unit-tested without rendering. A growing
merged fruit is `setShape(rigidCircle(r))` each step; overlaps it creates are pushed out by position correction,
which never adds velocity (no explosions).

### Scoring with sensors

```ts
world.add({ type: 'static', sensor: true, shape: rigidBox(90, 24), x, y, userData: { bin: 3 } });
world.on('contactBegin', (e) => {
  if (!e.sensor) return;
  const ball = e.a.sensor ? e.b : e.a;
  if (ball.world === null) return;            // already removed this step
  world.remove(ball);                         // deferred until the step ends
  score++;
});
```

Sensors report begin/end but never push. Sensor-sensor and static-static pairs are never tested.

## Filtering, queries, forces

```ts
const PLAYER = 1, ENEMY = 2, PICKUP = 4;
world.add({ shape, category: ENEMY, mask: PLAYER | ENEMY });   // both sides must accept each other
world.add({ shape, group: -1 });   // same nonzero group: negative = never collide, positive = always (beats category/mask)

world.queryPoint(x, y);                          // bodies containing the point (e.g. tap to poke)
world.queryAABB({ x, y, w, h }, { mask: ENEMY }); // AABB overlap only (superset of shape overlap)
const hit = world.raycast(x0, y0, x1, y1, { ignore: hero }); // closest: { body, x, y, nx, ny, fraction, distance }

body.applyImpulse(0, -900 * body.mass, px, py);  // instant velocity change at a point (adds spin off-centre)
body.applyForce(fx, fy);                          // for the next step (cleared after it), e.g. wind, thrusters
body.applyTorque(t); body.applyAngularImpulse(i);
body.setVelocity(vx, vy, av);
body.setPosition(x, y, angle);                    // teleport: no interpolation smear, wakes it and its neighbours
```

Options for queries: `mask`, `sensors` (include sensors, default false), `ignore`. A ray that starts inside a shape
does not hit that shape. Queries never wake anything; the body methods above do. Plain writes to `body.x` neither
wake nor update the AABB, so always go through `setPosition`. Each query tests every body's AABB (no broadphase,
results in body order) and allocates only its result: about 2-5 µs per call with 400 bodies, fine for taps and a
few rays per frame.

## Sleeping

Island sleeping: a group of touching bodies sleeps when every body is slower than `sleepLinear` / `sleepAngular`
for `timeToSleep` seconds. Sleeping bodies cost nothing to simulate and are woken by contact begin/end, a removed
support, impulses/forces/velocity/teleport, and `setShape`. When every dynamic body sleeps and no kinematic moves,
a step only re-lists the resting contacts in `touches` (about 0.02 ms for 400 settled bodies), so a settled level
is nearly free. `allowSleep: false` per body (e.g. the player) or per
world. `awake: false` starts a pre-settled stack asleep. Jointed bodies share an island, so a ragdoll or bridge sleeps
and wakes as one.

## Joints

`world.addJoint(opts)` connects two bodies that are already in the world and returns the typed joint
(`RigidDistanceJoint`, `RigidRevoluteJoint`, `RigidWeldJoint`, `RigidMouseJoint`); `world.removeJoint(j)`;
`world.joints` lists them in add order, `body.joints` per body. Either body may be static: a hidden pin is a static
body with `category: 0, mask: 0`. `anchorA` / `anchorB` are body-local points (relative to the centre of mass),
`anchor` is a world point. Angles are radians, positive = clockwise, measured as `b.angle - a.angle` relative to the
creation pose.

```ts
import { rigidBox, rigidCircle, RigidWorld } from '@engine';

const world = new RigidWorld({ gravity: 1600 });
const pin = (x: number, y: number) => world.add({ type: 'static', shape: rigidCircle(4), x, y, category: 0, mask: 0 });

// Distance: rigid rod (length = current distance), rope (minLength 0), spring (springHz).
const bob = world.add({ shape: rigidCircle(24), x: 250, y: 200 });
world.addJoint({ type: 'distance', name: 'rod', a: pin(100, 200), b: bob });                // pendulum, length 150
const lamp = world.add({ shape: rigidBox(40, 30), x: 400, y: 380 });
world.addJoint({ type: 'distance', a: pin(400, 100), b: lamp, anchorB: { x: 0, y: -15 }, minLength: 0, maxLength: 300 });
const buoy = world.add({ shape: rigidCircle(20), x: 600, y: 300 });
world.addJoint({ type: 'distance', a: pin(600, 150), b: buoy, springHz: 3, dampingRatio: 0.3 }); // bouncy, rest 150

// Revolute: shared pivot (`anchor`, default b's centre) + optional limits, motor, angular spring toward targetAngle.
const flap = world.add({ shape: rigidBox(160, 16), x: 280, y: 600 });
const hinge = world.addJoint({
  type: 'revolute', a: pin(200, 600), b: flap, anchor: { x: 200, y: 600 },
  lowerAngle: -1.2, upperAngle: 1.2, springHz: 4, dampingRatio: 0.5,    // springy flap that holds level
});
const fan = world.add({ shape: rigidBox(200, 12), x: 550, y: 700 });
const motor = world.addJoint({ type: 'revolute', a: pin(550, 700), b: fan, motorSpeed: 3, maxMotorTorque: 1e7 });

// Weld: glue at the current relative pose (compound bodies, breakable structures).
const blade = world.add({ shape: rigidBox(200, 12), x: 550, y: 700, angle: Math.PI / 2 });
world.addJoint({ type: 'weld', a: fan, b: blade });

// Mouse: pull a point of a body toward a target with a soft, force-limited spring.
const drag = world.addJoint({ type: 'mouse', body: bob, target: { x: bob.x, y: bob.y } });
drag.setTarget(300, 120);

for (let i = 0; i < 120; i++) world.step();
console.log(hinge.angle(), motor.speed(), world.dump());
motor.setMotor(-3);                // or setMotor(0, torque) = joint friction
hinge.setLimits(-0.3, 0.3);
hinge.setTarget(0.5);              // spring rest angle
world.removeJoint(drag);
```

- **Distance**: `length`, `minLength`, `maxLength`. Missing bounds default to `length` when rigid, so give
  `maxLength` for a rope. With `springHz` the bounds default to 0 / Infinity (pure spring). `setLength(len, min?, max?)`,
  `currentLength()`.
- **Revolute**: `lowerAngle` / `upperAngle` (either one enables limits), `motorSpeed` (rad/s, b relative to a) with
  `maxMotorTorque` (motor is off at 0), `targetAngle` + `springHz` / `dampingRatio` (angular spring, like an active
  ragdoll joint). Methods: `angle()`, `speed()`, `setMotor(speed, maxTorque?)`, `setLimits(lo, hi)`, `setTarget(a)`,
  `setSpring(hz, ratio?)`, `motorTorque()`. Wheels: `{ a: chassis, b: wheel }` (anchor defaults to the axle).
- **Weld**: rigid by default; `springHz` makes the angular part soft (bendy).
- **Mouse**: `{ body, target, anchor?, maxForce? (30000 * mass), springHz? (5), dampingRatio? (0.7) }`,
  `setTarget(x, y)` wakes the body. `a` and `b` are both the dragged body.
- Common options: `name` (shown in dumps), `collideConnected` (default **false**: the two jointed bodies pass through
  each other; all other pairs still collide), `breakForce` / `breakTorque`, `userData`.
- Every joint: `type a b name broken userData world`, `other(body)`, `reactionForce()` / `reactionTorque()` (last
  substep, force units: mass * units/s²), `anchorWorldA(alpha?)` / `anchorWorldB(alpha?)` (pass `world.alpha` when
  drawing interpolated), `describe()`.
- `addJoint` / `removeJoint` are safe inside events (applied when the step ends). Adding or removing wakes both
  bodies. Removing a body removes its joints; `clear()` removes all. Waking, moving or teleporting one body wakes the
  bodies jointed to it.
- Solver: joints are warm-started and solved with contacts in every velocity iteration and position pass, per
  substep. Chains of many links and heavy loads on light links need more `velocityIterations` (ratio < 10:1 as
  for stacks) or `substeps`.

### Breakable joints

```ts
import { rigidBox, rigidCircle, RigidWorld } from '@engine';

const world = new RigidWorld({ gravity: 1600 });
const hook = world.add({ type: 'static', shape: rigidCircle(4), x: 375, y: 100, category: 0, mask: 0 });
const crate = world.add({ shape: rigidBox(60, 60), x: 375, y: 300 });
const rope = world.addJoint({
  type: 'distance', name: 'rope', a: hook, b: crate, minLength: 0,
  breakForce: 3 * crate.mass * 1600,                // snaps when yanked harder than 3x the crate's weight
});
world.on('jointBreak', (j) => console.log('snap', j.name, j.broken, world.joints.includes(j))); // snap rope true false
crate.applyImpulse(0, 900 * crate.mass);            // yank down
for (let i = 0; i < 10; i++) world.step();
console.log(rope.broken);                           // true
```

A broken joint has already left the world when 'jointBreak' fires. Stress gauges and creak sounds can poll
`reactionForce()` instead.

### Drawing and debugging joints

`drawRigidWorld` / `RigidDebugView` draw joints in purple: lines from each centre to its anchor, the anchor link
(dashed for mouse joints) and revolute limit arcs; `{ joints: false }` hides them. Custom art: draw rods from
`j.anchorWorldA(world.alpha)` to `j.anchorWorldB(world.alpha)` (see `paintRods` in the 'rigid-joints' scene).
`world.dump()` adds `joints=N` to its first line and one line per joint (bodies by name or id, `#name` when set,
`F` = reaction force), e.g. for the snippet above:

```text
  joint distance #rod id2-id1 len=150 rod=150 F=53185
  joint distance id4-id3 len=300 range=0..300 F=1920
  joint revolute id8-id7 @200,600 angle=5.4° limits=-68.8..68.8 spring=4Hz target=0° F=4102
  joint revolute id10-id9 @550,700 angle=343.8° motor=3/10000000 F=7680
  joint mouse id1-id1 target=300,120 F=54287
```

### Dragging with the pointer

```ts
// Inside a scene: `view` is the World node the physics lives in, `world` the RigidWorld.
let drag: { joint: RigidMouseJoint; pointer: number } | null = null;
view.interactive = true;
view.on('pointerdown', (e) => {
  const p = view.stageToWorld(e.x, e.y);
  const body = world.queryPoint(p.x, p.y).find((b) => b.type === 'dynamic');
  if (drag || !body) return;
  drag = { joint: world.addJoint({ type: 'mouse', body, target: p, maxForce: 60000 * body.mass }), pointer: e.pointerId };
});
view.on('pointermove', (e) => {
  if (drag?.pointer !== e.pointerId) return;
  const p = view.stageToWorld(e.x, e.y);
  drag.joint.setTarget(p.x, p.y);
});
const release = (e: PointerEvt) => {
  if (drag?.pointer !== e.pointerId) return;
  world.removeJoint(drag.joint);
  drag = null;
};
view.on('pointerup', release);
view.on('pointercancel', release);
```

## Presets

`engine/world/rigid-presets.ts` builds common jointed rigs.

### Ragdoll

```ts
import { createRigidRagdoll, rigidBox, RigidWorld } from '@engine';

const world = new RigidWorld({ gravity: 1600 });
world.add({ type: 'static', shape: rigidBox(2000, 100), x: 375, y: 1050 });           // floor top at y = 1000
const guy = createRigidRagdoll(world, { x: 375, y: 1000 - 86, stiffness: 1, name: 'guy' }); // x, y = hip joint
for (let i = 0; i < 60; i++) world.step();                                             // stands (springs hold the pose)
const torso = guy.parts.torso;
guy.impulse(torso.x, torso.y - 20, 400 * torso.mass, 0);                               // shove: it stumbles and falls
world.on('contactBegin', (e) => {
  const part = guy.partOf(e.a) ?? guy.partOf(e.b);
  if (part === 'head' && e.approachSpeed > 400) guy.setStiffness(0);                   // knocked out: goes limp
});
for (let i = 0; i < 180; i++) world.step();
console.log(guy.centerOfMass(), guy.joint.kneeF.angle());
```

- Ten parts `head torso upperArmF foreArmF upperArmB foreArmB thighF shinF thighB shinB` (F = front/near limbs,
  B = back/far), nine revolute joints `neck shoulderF elbowF shoulderB elbowB hipF kneeF hipB kneeB` with human
  limits (elbows and knees bend one way). `guy.bodies` is the draw order (back limbs, torso, head, front limbs).
- Options: `scale` (1 = about 171 units tall: soles 86 * scale below `y`, head top 85 * scale above), `facing` (1 = faces
  +x, -1 mirrored), `pose` ('stand' | 'limp'), `stiffness` (0 = limp ragdoll, default; 1 = holds the pose, an active
  ragdoll; > 1 stiffer), `dampingRatio`, `jointFriction` (damps flailing, default 0.001 of weight * height), `angle`,
  `vx` / `vy`, `density`, `friction`, `restitution`, `category`, `mask`, `group`, `breakForce` (dismemberment),
  `name` (bodies `<name>.head`, ...), `userData`.
- Parts never collide with each other: all share a fresh negative `group` (one per ragdoll). Pass the same negative
  `group` to several ragdolls to stop them hitting each other too.
- Methods: `setStiffness(k)` (wakes), `setPose(pose)`, `impulse(x, y, ix, iy)` (on the part under the point, returns
  it), `partOf(body)`, `centerOfMass()`, `remove()`.
- A stiff ragdoll stands on flat ground but has no balance controller: `impulse(chest, 250 * torso.mass, 0)`
  topples it. To keep it upright, add an upright torque on the torso each step (forces apply to the next step):

```ts
world.on('step', () => {
  const t = guy.parts.torso;
  if (t.sleeping) return;                                      // applyTorque wakes: let a settled ragdoll sleep
  t.applyTorque(-(t.angle * 1800 + t.av * 360) * t.inertia);   // now shrugs off shoves up to ~350 * torso.mass
});
```

### Chains, ropes and bridges

```ts
import { createRigidChain, rigidBox, rigidCircle, RigidWorld } from '@engine';

const world = new RigidWorld({ gravity: 1600 });
// Hanging bridge: planks 3.5% longer than the gap so it sags; point ends are pinned to hidden static bodies.
const bridge = createRigidChain(world, {
  from: { x: 60, y: 400 }, to: { x: 690, y: 400 }, links: 16,
  linkLength: (630 / 16) * 1.035, linkWidth: 12, density: 0.0015, name: 'bridge',
});
world.add({ shape: rigidBox(50, 50), x: 375, y: 300 });                              // a crate lands on it
// Rope with a lamp: an end can be a body (anchor is body-local, default its centre).
const lamp = world.add({ shape: rigidCircle(20), x: 200, y: 700 });
createRigidChain(world, { from: { x: 200, y: 500 }, to: { body: lamp, anchor: { x: 0, y: -20 } }, links: 10, linkWidth: 4 });
// Free end: without `to` the chain hangs straight down (links 20 long by default).
const tail = createRigidChain(world, { from: { x: 600, y: 500 }, links: 12, name: 'tail' });
for (let i = 0; i < 300; i++) world.step();
console.log(bridge.bodies.length, bridge.joints.length, tail.bodies.at(-1)!.y);   // 16 17 730
```

- Returns `{ bodies, joints, pins, remove() }`; joints run pin/body -> link 0 -> ... -> last link -> pin/body.
- `linkLength` defaults to span / links (taut) with `to`, else 20. Longer links start on a parabola that sags.
- `jointFriction` (default 0.05 of one link's weight * length) damps swaying so bridges sleep; 0 = frictionless.
- Non-adjacent links collide with each other by default; `group: -n` turns that off (a loose rope that folds).
- `breakForce` on every joint (a bridge that snaps), `category` / `mask`, `friction`, `linearDamping`, `name`.

## Tuning

| Option (default) | Raise it when | Cost / risk |
|---|---|---|
| `velocityIterations` (8) | tall stacks sag or jitter, heavy-on-light piles | linear CPU |
| `positionIterations` (3) | visible overlap after spawns / growth (game uses 8) | linear CPU; never adds velocity |
| `baumgarte` (0.2) | overlap resolves too slowly (game uses 0.4) | > 0.5 can overshoot and jitter |
| `maxCorrection` (8) | big overlaps take many frames to clear (game 12) | large values look like popping |
| `slop` (0.25) | resting contacts jitter | visible sinking of that many units |
| `contactMargin` (1) | touch detection must be looser (rules, events) | more contacts kept alive |
| `substeps` (1) | fast bodies tunnel, piles are soft (game uses 2) | linear CPU |
| `restitutionThreshold` (50) | small bounces never settle (game 120) | slow impacts stop bouncing |
| `sleepLinear` (4) / `sleepAngular` (0.1) / `timeToSleep` (0.5) | piles take long to sleep | too high freezes slow sliding |
| `linearDamping` / `angularDamping` (0) | things roll or slide forever (fruit: 0.4 / 1.2) | floaty motion |
| `maxSpeed` (10000) | limit launches from bugs or huge impulses | clamps real speed |
| `warmStarting` (true) | never turn off except to debug | off = much softer stacks |

Scale: everything is in design units (750x1334 screen). Gravity 1600-2600 feels right for phone-sized objects;
objects 20-200 units across. Perf (node, headless, busy machine): ~200 mixed bodies at 60 Hz cost about
0.7-1.5 ms per step, 400 boxes 2-3 ms, 400 fruit piled in a jar with 2 substeps about 2 ms; the fruit jar game is
under 0.1 ms per step. The broadphase sweeps along the axis the non-static bodies spread over most (a tall pile
sweeps vertically), so crowded piles stay close to linear. Steps allocate little (about 4 KB per step for the fruit
jar, 30-60 KB with 400 awake bodies, almost nothing asleep), so GC pauses stay rare.

## Pitfalls

- **Tunnelling**: no continuous collision. Speculative contacts catch fast bodies about to hit within one step, but
  keep `speed * step` below roughly half the thinnest body; use thick walls (walls 200-400 units deep, outside
  the view), `substeps`, or `maxSpeed`. Bullets: use a raycast instead of a body.
- **Mass ratios**: a heavy body on a light one (ratio > 10:1) sags and jitters. Keep densities similar, or raise
  iterations. Static bodies have infinite mass and are always fine.
- **Design units**: do not model in metres with tiny numbers; slop, margins and sleep thresholds are in units.
- **Polygons** must be convex; `rigidPolygon` takes the hull. Concave terrain = several static polygons.
- **Position is the centroid**: a triangle from `rigidPolygon` is offset from its input coords (`centroidX/Y`).
- **Direct writes**: `body.x = ...` does not wake or update the AABB; use `setPosition` / `setVelocity`.
- **Stepping from callbacks**: calling `world.step()` inside an event throws. Do spawns in `step` or later.
- **`clear()`** removes everything without contactEnd events (use it for a reset, not for gameplay).
- **Sleeping and polling**: a sleeping body's velocity is 0; read `world.touches` (it includes resting contacts
  of sleeping bodies) instead of assuming contacts vanished.
- **Sensors on statics**: a static sensor does detect dynamic bodies; static-static pairs are skipped.

## Headless testing

The world needs no game, canvas or scene: build it, loop `step()`, assert on bodies. Tests live next to code.

```ts
import { describe, expect, it } from 'vitest';
import { rigidBox, RigidWorld } from '@engine';

describe('crate stack', () => {
  it('settles and sleeps', () => {
    const w = new RigidWorld({ gravity: 1600 });
    w.add({ type: 'static', shape: rigidBox(2000, 100), x: 500, y: 1050 });  // top at y = 1000
    const boxes = Array.from({ length: 6 }, (_, i) => w.add({ shape: rigidBox(40, 40), x: 500, y: 980 - i * 40 }));
    for (let i = 0; i < 300; i++) w.step();
    expect(Math.abs(boxes[5]!.x - 500)).toBeLessThan(1);
    expect(boxes.every((b) => b.sleeping)).toBe(true);
    expect(w.dump()).toContain('sleeping=6');
  });
});
```

- Determinism test: build the same scene twice (seeded `Rng` for random spawns), run N steps, compare `dump()`.
- Events: push strings into a log inside `on('contactBegin')` and compare the log.
- Perf smoke: time 200 bodies for 60 steps with a generous bound (machines are shared).
- Screens: `pnpm shot --app sandbox --scene rigid-stack --device iphone-se,iphone-14,ipad --lint` and Read the PNGs
  (quote the device list in PowerShell).

## API summary

- Shapes: `rigidCircle(r)`, `rigidBox(w, h)`, `rigidPolygon(points: number[] | Vec2[])`,
  `rigidShapeMass(shape, density)`; types `RigidShape`, `RigidCircleShape`, `RigidPolygonShape`.
- `new RigidWorld(opts?: RigidWorldOptions)`: `add`, `remove`, `clear`, `get(name)`, `on`, `attach`, `update(dt)`,
  `step(h?)`, `syncNodes(alpha?)`, `queryPoint`, `queryAABB`, `raycast`, `addJoint`, `removeJoint`,
  `dump(maxBodies?)`; fields `bodies`, `joints`, `contacts`, `touches`, `time`, `steps`, `alpha`, `paused`, plus every
  option as a mutable field. Events `contactBegin`, `contactEnd`, `jointBreak` (payload `RigidJoint`), `step`.
- `RigidBody`: `x y angle vx vy av mass inertia sleeping group joints userData node`, `setShape`, `setPosition`,
  `setVelocity`, `applyForce`, `applyTorque`, `applyImpulse`, `applyAngularImpulse`, `wake`, `sleep`, `velocityAt`,
  `containsPoint`, `describe`, getters `awake`, `speed`, `shape`, `fixedRotation`.
- Joints: options `RigidJointOptions` = `RigidDistanceJointOptions | RigidRevoluteJointOptions | RigidWeldJointOptions
  | RigidMouseJointOptions` (+ `RigidJointCommonOptions`); classes `RigidJoint` (base), `RigidDistanceJoint`,
  `RigidRevoluteJoint`, `RigidWeldJoint`, `RigidMouseJoint`.
- Presets: `createRigidRagdoll(world, RigidRagdollOptions): RigidRagdoll`,
  `createRigidChain(world, RigidChainOptions): RigidChain`; types `RigidRagdollPart`, `RigidRagdollJointName`,
  `RigidRagdollPose`, `RigidChainEnd`.
- Rendering: `bindRigidNode(node, body, RigidBindOptions)`, `drawRigidWorld(ctx, world, RigidDrawOptions)`,
  `RigidDebugView`.
