import { describe, expect, it } from 'vitest';
import { TOWER_TOP, TOWER_X } from './layout';
import { NECK_BONE, Ragdoll, segCircle, segRect, segSeg, TORSO_BONE } from './ragdoll';
import { BODY, BONES, J, WORLD_H, type PlatformView } from './types';

const DT = 1 / 60;
const tower: PlatformView = { id: 1, kind: 'tower', x: TOWER_X, y: TOWER_TOP + 500, w: 230, h: 1000, angle: 0, stuck: [] };
const blockTop = 500;
const diag = (110 * Math.SQRT2) / 2;
const block: PlatformView = { id: 2, kind: 'block', x: 1100, y: blockTop + diag, w: 110, h: 110, angle: Math.PI / 4, stuck: [] };

function run(r: Ragdoll, seconds: number, platforms: PlatformView[] = [tower], lift = 0): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) r.step(DT, platforms, lift);
}

function upright(r: Ragdoll): void {
  const p = r.pos;
  expect(p[J.head]!.y).toBeLessThan(p[J.neck]!.y);
  expect(p[J.neck]!.y).toBeLessThan(p[J.pelvis]!.y);
  expect(p[J.pelvis]!.y).toBeLessThan(p[J.kneeF]!.y);
  expect(p[J.kneeF]!.y).toBeLessThan(p[J.footF]!.y);
  expect(Math.abs(p[J.head]!.x - p[J.pelvis]!.x)).toBeLessThan(20 * r.scale);
}

function boneLengthsOk(r: Ragdoll): void {
  for (const [a, b] of BONES) {
    const d = Math.hypot(r.pos[a]!.x - r.pos[b]!.x, r.pos[a]!.y - r.pos[b]!.y);
    expect(d).toBeGreaterThan(8 * r.scale);
    expect(d).toBeLessThan(60 * r.scale);
  }
}

describe('ragdoll', () => {
  it('stands upright on the tower under gravity, feet planted', () => {
    const r = new Ragdoll({ x: TOWER_X, y: TOWER_TOP, facing: 1 });
    run(r, 5);
    upright(r);
    boneLengthsOk(r);
    expect(r.pos[J.footF]!.y).toBeCloseTo(TOWER_TOP, 3);
    expect(r.pos[J.footB]!.y).toBeCloseTo(TOWER_TOP, 3);
    const height = TOWER_TOP - (r.pos[J.head]!.y - BODY.headR);
    expect(height).toBeGreaterThan(160);
    expect(height).toBeLessThan(185);
  });

  it('extends the bow arm along the aim angle and pulls the string hand back with draw', () => {
    const r = new Ragdoll({ x: TOWER_X, y: TOWER_TOP, facing: 1, aimAngle: -0.5 });
    run(r, 1);
    const n = r.pos[J.neck]!;
    const h = r.pos[J.handF]!;
    expect(Math.abs(Math.atan2(h.y - n.y, h.x - n.x) - -0.5)).toBeLessThan(0.15);
    const loose = Math.hypot(r.pos[J.handB]!.x - n.x, r.pos[J.handB]!.y - n.y);
    r.draw = 1;
    run(r, 1);
    const drawn = Math.hypot(r.pos[J.handB]!.x - r.pos[J.neck]!.x, r.pos[J.handB]!.y - r.pos[J.neck]!.y);
    expect(drawn).toBeLessThan(loose * 0.4);
  });

  it('flinches from an impulse and recovers', () => {
    const r = new Ragdoll({ x: TOWER_X, y: TOWER_TOP, facing: 1 });
    run(r, 1);
    const rest = { x: r.pos[J.head]!.x, y: r.pos[J.head]!.y };
    r.push(J.head, -900, -100);
    r.push(J.neck, -300, 0);
    let maxDev = 0;
    for (let i = 0; i < 20; i++) {
      r.step(DT, [tower]);
      maxDev = Math.max(maxDev, Math.hypot(r.pos[J.head]!.x - rest.x, r.pos[J.head]!.y - rest.y));
    }
    expect(maxDev).toBeGreaterThan(10);
    run(r, 2);
    upright(r);
    expect(Math.hypot(r.pos[J.head]!.x - rest.x, r.pos[J.head]!.y - rest.y)).toBeLessThan(4);
  });

  it('stands on the corner of a rotated block with feet on its sides', () => {
    const r = new Ragdoll({ x: block.x, y: blockTop, facing: -1, slope: 1, aimAngle: Math.PI });
    run(r, 3, [block]);
    upright(r);
    expect(r.pos[J.footF]!.x).toBeLessThan(block.x);
    expect(r.pos[J.footB]!.x).toBeGreaterThan(block.x);
    expect(r.pos[J.footF]!.y).toBeGreaterThan(blockTop);
  });

  it('dead bodies go limp, tumble off their block and fall out of the world', () => {
    const r = new Ragdoll({ x: block.x, y: blockTop, facing: -1, slope: 1, aimAngle: Math.PI });
    run(r, 0.5, [block]);
    r.kill();
    r.push(J.head, 400, -100);
    let t = 0;
    while (r.top() < WORLD_H + 300 && t < 10) {
      r.step(DT, [block]);
      t += DT;
      boneLengthsOk(r);
    }
    expect(r.top()).toBeGreaterThan(WORLD_H + 300);
    expect(t).toBeLessThan(6);
  });

  it('a dead body collapses onto the tower top instead of falling through', () => {
    const r = new Ragdoll({ x: TOWER_X, y: TOWER_TOP, facing: 1 });
    run(r, 0.5);
    r.kill();
    run(r, 3);
    for (const p of r.pos) expect(p.y).toBeLessThan(TOWER_TOP + 1);
    expect(r.bottom()).toBeGreaterThan(TOWER_TOP - 20);
  });

  it('jumps and lands back on its stand', () => {
    const r = new Ragdoll({ x: TOWER_X, y: TOWER_TOP, facing: 1 });
    run(r, 0.5);
    r.jump(640);
    expect(r.grounded).toBe(false);
    let peak = 0;
    let landed = false;
    for (let i = 0; i < 120 && !landed; i++) {
      landed = r.step(DT, [tower]);
      peak = Math.max(peak, TOWER_TOP - r.pos[J.footF]!.y);
    }
    expect(landed).toBe(true);
    expect(peak).toBeGreaterThan(80);
    expect(r.grounded).toBe(true);
    run(r, 1);
    upright(r);
  });

  it('balloons lift the body off its block once there are enough of them', () => {
    const r = new Ragdoll({ x: block.x, y: blockTop, facing: -1, slope: 1, aimAngle: Math.PI });
    r.balloons = 1;
    run(r, 1, [block], 260);
    expect(r.grounded).toBe(true);
    r.balloons = 2;
    run(r, 3, [block], 260);
    expect(r.grounded).toBe(false);
    expect(r.bottom()).toBeLessThan(0);
    upright(r);
  });

  it('sweeps arrow segments against the head circle and bone capsules', () => {
    const r = new Ragdoll({ x: TOWER_X, y: TOWER_TOP, facing: 1 });
    run(r, 0.5);
    const head = r.pos[J.head]!;
    const hh = r.sweep(head.x + 100, head.y, head.x - 100, head.y);
    expect(hh?.head).toBe(true);
    expect(hh?.bone).toBe(NECK_BONE);
    expect(hh!.x).toBeCloseTo(head.x + BODY.headR, 0);
    const c = r.chest();
    const th = r.sweep(c.x + 100, c.y, c.x - 100, c.y);
    expect(th?.head).toBe(false);
    expect(th?.bone).toBe(TORSO_BONE);
    expect(r.sweep(c.x + 100, c.y - 300, c.x - 100, c.y - 300)).toBeNull();
  });
});

describe('geometry helpers', () => {
  it('closest points of two segments', () => {
    const out = { s: 0, t: 0, d2: 0 };
    segSeg(0, 0, 10, 0, 5, -5, 5, 5, out);
    expect(out.d2).toBeCloseTo(0);
    expect(out.s).toBeCloseTo(0.5);
    segSeg(0, 0, 10, 0, 0, 3, 10, 3, out);
    expect(out.d2).toBeCloseTo(9);
  });

  it('segment vs circle and rotated rectangle', () => {
    expect(segCircle(-10, 0, 20, 0, 0, 0, 5)).toBeCloseTo(0.25);
    expect(segCircle(-10, 10, 20, 0, 0, 0, 5)).toBeNull();
    expect(segRect(-100, 0, 100, 0, { ...block, x: 0, y: 0 })).toBeCloseTo((100 - diag) / 200, 3);
    expect(segRect(-100, -200, 100, -200, { ...block, x: 0, y: 0 })).toBeNull();
  });
});
