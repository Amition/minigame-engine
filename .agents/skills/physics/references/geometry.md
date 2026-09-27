# Geometry sweeps and ballistics (`engine/core/geom.ts`)

Pure helpers for projectile and ragdoll games, exported from `'@engine'`: swept hit tests for arrows, bullets and
balls, rotated-box frames for pinning things to moving platforms, and launch solvers for aiming lobs. No world, no
bodies: call them from your own fixed-step model. Reference use: `archer/ragdoll.ts` (`Ragdoll.sweep`) and
`archer/model.ts` (`collideArrow`, `hitPlatform`, `syncPlatformStuck`, `aimFrom`); tests in `engine/core/geom.test.ts`.

Conventions:

- Screen space: y down, angles in radians, positive = clockwise (same as `Node.rotation`, `RigidBody.angle` and
  `Math.atan2(dy, dx)`).
- A sweep tests the segment (x0, y0) -> (x1, y1) (one sub-step of a projectile) and returns the first parameter
  `t` in 0..1 where it enters the shape, or `null`. Impact point: `x0 + (x1 - x0) * t`. Starting inside returns 0;
  touching the boundary counts as a hit.
- `GeomBox` is centre-based: `{ x, y, w, h, angle? }`. Any object with those fields fits (the archer's `Platform`
  class is passed as is), so no conversion is needed.
- Optional `out` objects make the hot calls allocation-free; without one a new object is returned.

## API

| Function | Returns |
|---|---|
| `closestSegmentSegment(p1x, p1y, q1x, q1y, p2x, p2y, q2x, q2y, out?)` | `GeomClosestPair { s, t, d2 }`: params along each segment, squared distance |
| `closestPointOnSegment(px, py, ax, ay, bx, by, out?)` | `GeomClosestPoint { x, y, t, d2 }` |
| `sweepSegmentCircle(x0, y0, x1, y1, cx, cy, r)` | `number \| null` |
| `sweepSegmentCapsule(x0, y0, x1, y1, ax, ay, bx, by, r)` | `number \| null` (exact, entry on the surface) |
| `sweepSegmentBox(x0, y0, x1, y1, box)` | `number \| null` (Liang-Barsky in box space) |
| `sweepCircleCircle(x0, y0, x1, y1, r, cx, cy, cr)` | `number \| null`: moving circle vs static circle |
| `sweepCircleBox(x0, y0, x1, y1, r, box)` | `number \| null`: moving circle vs static box, rounded corners |
| `boxToLocal(box, x, y, out?)` / `boxToWorld(box, lx, ly, out?)` | `Vec2` (origin at the box centre, x along `w`) |
| `boxContainsPoint(box, x, y, pad = 0)` | `boolean` (edge inclusive; negative `pad` shrinks) |
| `ballisticAngle(dx, dy, speed, gravity, high = false)` | `number \| null`: flat shot, or the lob with `high` |
| `ballisticMinSpeed(dx, dy, gravity, out?: BallisticLaunch)` | slowest speed that reaches; `out` gets `{ speed, angle }` |
| `ballisticPosition(x0, y0, vx, vy, gravity, t, out?)` | `Vec2` on the exact parabola |
| `ballisticTimeToX(dx, vx)` | seconds, or `null` when `vx` is 0 or points away |
| `ballisticApex(x0, y0, vx, vy, gravity, out?)` | `BallisticPoint { x, y, t }` (the start when already falling) |
| `ballisticPath(x0, y0, vx, vy, gravity, { step?, maxTime?, until? }, out?)` | flat `[x0, y0, x1, y1, ...]` |

Gravity is in units/s², > 0 pulls down; `ballisticAngle` with gravity 0 returns the straight-line angle.

## Arrow sweep vs head circle and limb capsules

```ts
import { closestSegmentSegment, sweepSegmentCapsule, sweepSegmentCircle, type GeomClosestPair } from '@engine';

const scratch: GeomClosestPair = { s: 0, t: 0, d2: 0 };

// One sub-step: the tip moves (x0, y0) -> (x1, y1). Keep sub-steps shorter than the thinnest limb (archer: 24 units).
let best = Infinity;
let part = -1; // -1 = head, else limb index
const th = sweepSegmentCircle(x0, y0, x1, y1, head.x, head.y, HEAD_R);
if (th !== null) best = th;
limbs.forEach((l, i) => {
  const t = sweepSegmentCapsule(x0, y0, x1, y1, l.a.x, l.a.y, l.b.x, l.b.y, l.r);
  if (t !== null && t < best) {
    best = t;
    part = i;
  }
});
if (best !== Infinity) {
  stopArrowAt(x0 + (x1 - x0) * best, y0 + (y1 - y0) * best); // impact point on the surface
  if (part >= 0) {
    // Where along the bone (0 = joint a, 1 = joint b), e.g. to split the impulse between its two joints.
    const l = limbs[part]!;
    closestSegmentSegment(x0, y0, x1, y1, l.a.x, l.a.y, l.b.x, l.b.y, scratch);
    pushBone(part, scratch.t);
  }
}
```

`Ragdoll.sweep` in the archer uses `closestSegmentSegment` plus a back-off approximation instead of
`sweepSegmentCapsule` only to keep its seeded replays unchanged; new code should use the exact sweep.

## Hit a rotated platform and pin the arrow to it

```ts
import { boxToLocal, boxToWorld, sweepSegmentBox, type GeomBox } from '@engine';

const block: GeomBox = { x: 1100, y: 578, w: 110, h: 110, angle: Math.PI / 4 }; // standing on its corner
const t = sweepSegmentBox(x0, y0, x1, y1, block);
if (t !== null) {
  const tip = boxToLocal(block, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t); // remember it in block space
  pins.push({ lx: tip.x, ly: tip.y, rel: arrowAngle - (block.angle ?? 0) });
}

// Each step after the block moved (glides in, falls): no allocation, writes stuck.x / stuck.y.
for (let i = 0; i < pins.length; i++) {
  const pin = pins[i]!;
  const stuck = stuckViews[i]!;
  boxToWorld(block, pin.lx, pin.ly, stuck);
  stuck.angle = (block.angle ?? 0) + pin.rel;
}
```

Moving ball vs crate: `sweepCircleBox(bx, by, nx, ny, ballR, crate)`; move the ball to `t` along its step.
Point test with a margin (e.g. "feet on the block"): `boxContainsPoint(block, fx, fy, 3)`.

## Aim a lob with ballisticAngle

```ts
import { ballisticAngle, ballisticMinSpeed, type BallisticLaunch } from '@engine';

const GRAVITY = 1400;
const dx = target.x - muzzle.x;
const dy = target.y - muzzle.y;
let angle = ballisticAngle(dx, dy, speed, GRAVITY, true); // true: the high lob; false: the flat shot
if (angle === null) {
  const min: BallisticLaunch = { speed: 0, angle: 0 };
  ballisticMinSpeed(dx, dy, GRAVITY, min); // out of range: the slowest shot that still reaches
  angle = min.angle;                        // fire at min.speed * 1.001 (exactly min.speed may round to null)
}
arrow.vx = Math.cos(angle) * speed;
arrow.vy = Math.sin(angle) * speed;
```

- Leftward shots come back as `PI - elevation`, in (PI/2, 3PI/2), continuous around PI, not wrapped to atan2's
  (-PI, PI]. Lerping a left-facing archer's aim from PI toward it therefore never spins the long way round.
- When the muzzle moves with the aim angle (a bow at arm's length), re-solve from the new muzzle 3-4 times; it
  converges quickly (see `aimFrom` in `archer/model.ts`).
- AI inaccuracy: add `rng.gauss(0, err)` to the solved angle, never `Math.random()`.

## Draw an aim preview with ballisticPath

```ts
import { ballisticPath, Node, type BallisticPathOptions, type Ctx2D } from '@engine';

class AimPreview extends Node {
  ox = 0;
  oy = 0;
  vx = 0;
  vy = 0;
  groundY = 700;
  private readonly pts: number[] = [];
  // Built once so draw() allocates nothing.
  private readonly opts: BallisticPathOptions = { step: 1 / 30, maxTime: 0.6, until: (_x, y) => y >= this.groundY };

  override get kind(): string {
    return 'AimPreview';
  }

  override draw(ctx: Ctx2D): void {
    const pts = ballisticPath(this.ox, this.oy, this.vx, this.vy, 1400, this.opts, this.pts);
    ctx.fillStyle = '#ffffff';
    for (let i = 2; i < pts.length; i += 2) {
      ctx.globalAlpha = 1 - i / pts.length;
      ctx.beginPath();
      ctx.arc(pts[i]!, pts[i + 1]!, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
```

The path ends at the first point where `until` is true, refined by bisection onto the crossing, so the last dot sits
on the ground (or wall, or enemy box: `until: (x, y) => boxContainsPoint(block, x, y)`).

## Pitfalls

- **Sub-step fast projectiles.** A sweep only sees its own segment; split a frame into pieces no longer than the
  thinnest target (archer: `ceil(speed * dt / 24)` sub-steps) or thin limbs are skipped between frames.
- **Thick projectiles.** Sweeps treat the projectile as a point. For a ball of radius r grow the target instead:
  `sweepCircleCircle` (radius sum) and `sweepCircleBox` (rounded corners) do that exactly.
- **Spawning inside.** A start inside a shape returns 0, so an arrow spawned inside its own archer or tower hits at
  once: spawn it outside or skip the owner.
- **No normals.** The sweeps return only `t`. For a bounce normal use `segmentVsRect` / `segmentVsCircle`
  (`engine/world/collide.ts`, axis-aligned, allocate a `RayHit`) or `RigidWorld.raycast`.
- **Euler drift.** `ballisticPosition` / `ballisticPath` are the exact parabola. A model stepping
  `vy += g * dt; y += vy * dt` lands `0.5 * g * dt * t` lower (about 12 units after 1 s at g 1400, 60 Hz), so
  test tolerances must allow it, or step with `y += vy * dt + 0.5 * g * dt * dt; vy += g * dt` (exact).
- **Params, not distances.** `t` is relative to the segment you passed; multiply by its length for a distance.
