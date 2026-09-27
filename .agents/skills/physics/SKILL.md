---
name: physics
description: >-
  2D physics in this engine (物理 / 刚体 / 碰撞 / 堆叠). Use when a game needs rigid bodies that rotate, roll, stack
  and topple (boxes, circles, convex polygons, fruit/ball merge games like 合成大西瓜, plinko, physics puzzles), or
  arcade movement (platformer/top-down heroes vs tile maps). Covers choosing RigidWorld vs PhysicsWorld/ArcadeBody,
  fixed-step setup and interpolation, syncing nodes (bindRigidNode), contact events (contactBegin/contactEnd, touches) for
  game rules such as merging or scoring, sensors and category/mask filtering, raycast/queryPoint/queryAABB, impulses and
  forces, sleeping, debug drawing (drawRigidWorld, RigidDebugView, dump), solver tuning (iterations, slop, margins,
  sleep thresholds, damping, substeps), pitfalls (tunnelling, mass ratios, design-unit scale) and headless vitest tests.
  Keywords: rigid body, collision, collision detection, stacking, friction, restitution, bounce, gravity, sensor, trigger,
  raycast, Box2D-like, 物理引擎, 刚体, 碰撞, 堆叠, 弹性, 摩擦.
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

Reference implementations: `sandbox/scenes/physics.ts` ('rigid-stack', 'rigid-plinko'), the 合成大西瓜 adapter
`game/physics.ts`, tests `engine/world/rigid.test.ts`.

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
wake nor update the AABB, so always go through `setPosition`.

## Sleeping

Island sleeping: a group of touching bodies sleeps when every body is slower than `sleepLinear` / `sleepAngular`
for `timeToSleep` seconds. Sleeping bodies cost nothing to simulate and are woken by contact begin/end, a removed
support, impulses/forces/velocity/teleport, and `setShape`. `allowSleep: false` per body (e.g. the player) or per
world. `awake: false` starts a pre-settled stack asleep.

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
objects 20-200 units across. Perf: ~200 mixed bodies at 60 Hz cost about 1.2-1.5 ms per step in node (headless,
busy machine); the fruit jar with 2 substeps is about 0.1 ms per step.

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
  `step(h?)`, `syncNodes(alpha?)`, `queryPoint`, `queryAABB`, `raycast`, `dump(maxBodies?)`; fields `bodies`,
  `contacts`, `touches`, `time`, `steps`, `alpha`, `paused`, plus every option as a mutable field.
- `RigidBody`: `x y angle vx vy av mass inertia sleeping userData node`, `setShape`, `setPosition`, `setVelocity`,
  `applyForce`, `applyTorque`, `applyImpulse`, `applyAngularImpulse`, `wake`, `sleep`, `velocityAt`,
  `containsPoint`, `describe`, getters `awake`, `speed`, `shape`, `fixedRotation`.
- Rendering: `bindRigidNode(node, body, RigidBindOptions)`, `drawRigidWorld(ctx, world, RigidDrawOptions)`,
  `RigidDebugView`.
