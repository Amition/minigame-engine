import { afterEach, describe, expect, it } from 'vitest';
import {
  Node,
  ParticleEmitter,
  particlePresets,
  spawnParticles,
  type AnimatedSprite,
  type AppDef,
  type CacheContainer,
  type ParticleConfig,
  type ParticlePresetName,
  type ParticleShape,
} from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';
import sandbox from '../sandbox/main';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

const snapshot = (e: ParticleEmitter): number[] => {
  const out: number[] = [];
  for (let i = 0; i < e.particleCount; i++) {
    const p = e.particleAt(i)!;
    out.push(p.x, p.y, p.vx, p.life, p.size);
  }
  return out;
};

function pixel(tg: TestGame, x: number, y: number): [number, number, number, number] {
  const d = tg.platform.canvas.getContext('2d').getImageData(x, y, 1, 1).data;
  return [d[0]!, d[1]!, d[2]!, d[3]!];
}

describe('ParticleEmitter', () => {
  it('is deterministic for a given seed', async () => {
    t = await createTestGame();
    const cfg: ParticleConfig = {
      rate: 50,
      bursts: [{ count: [5, 10], repeat: 2, interval: 0.3 }],
      speed: [50, 200],
      lifetime: [0.5, 1.5],
      gravity: 300,
      drag: 1,
      spin: [-90, 90],
      size: [4, 12],
      spawn: { type: 'circle', radius: 20 },
      seed: 42,
    };
    const a = new ParticleEmitter(cfg);
    const b = new ParticleEmitter(cfg);
    const c = new ParticleEmitter({ ...cfg, seed: 43 });
    for (let i = 0; i < 60; i++) for (const e of [a, b, c]) e.update(1 / 60);
    expect(a.particleCount).toBeGreaterThan(20);
    expect(snapshot(a)).toEqual(snapshot(b));
    expect(snapshot(a)).not.toEqual(snapshot(c));
  });

  it('runs bursts, completes once and auto-destroys', async () => {
    t = await createTestGame();
    const parent = t.game.sceneLayer.add(new Node());
    const e = parent.add(new ParticleEmitter({ bursts: [{ count: 12 }], lifetime: 0.5, autoDestroy: true, seed: 1 }, { id: 'boom' }));
    let completes = 0;
    e.on('complete', () => completes++);
    await t.step(1);
    expect(e.particleCount).toBe(12);
    expect(e.emitting).toBe(false);
    expect(t.dump()).toContain('ParticleEmitter#boom @0,0 live=12 emitting=false');
    await t.advance(0.6);
    expect(completes).toBe(1);
    expect(e.destroyed).toBe(true);
    expect(parent.children).toHaveLength(0);
  });

  it('emits at a steady rate, honours duration, the pool cap, stop and restart', async () => {
    t = await createTestGame();
    const e = new ParticleEmitter({ rate: 60, lifetime: 100, duration: 0.5, seed: 3 });
    for (let i = 0; i < 60; i++) e.update(1 / 60);
    expect(e.particleCount).toBeGreaterThanOrEqual(29);
    expect(e.particleCount).toBeLessThanOrEqual(31);
    expect(e.emitting).toBe(false);
    const capped = new ParticleEmitter({ rate: 1000, lifetime: 100, maxParticles: 50, seed: 3 });
    for (let i = 0; i < 30; i++) capped.update(1 / 60);
    expect(capped.particleCount).toBe(50);
    capped.stop(true);
    expect([capped.particleCount, capped.emitting, capped.finished]).toEqual([0, false, true]);
    capped.start();
    capped.update(0.1);
    expect(capped.particleCount).toBe(50);
  });

  it('bursts at a point and keeps world-space particles behind a moving emitter', async () => {
    t = await createTestGame({ device: '750x1334@1' });
    const cfg: ParticleConfig = { rate: 0, speed: 0, lifetime: 10, size: 20, shape: 'square', color: '#ff0000', alpha: 1, seed: 1 };
    const world = t.game.sceneLayer.add(new ParticleEmitter({ ...cfg, space: 'world' }, { x: 100, y: 100 }));
    const local = t.game.sceneLayer.add(new ParticleEmitter(cfg, { x: 100, y: 300 }));
    world.burst(1);
    local.burst(1);
    local.burst(2, { x: 50, y: -20 });
    world.x = 400;
    local.x = 400;
    t.game.render();
    expect(world.particleAt(0)).toMatchObject({ x: 100, y: 100 });
    expect(local.particleAt(2)).toMatchObject({ x: 50, y: -20 });
    expect(pixel(t, 100, 100)).toEqual([255, 0, 0, 255]);
    expect(pixel(t, 400, 100)).toEqual([0, 0, 0, 255]);
    expect(pixel(t, 400, 300)).toEqual([255, 0, 0, 255]);
    expect(pixel(t, 100, 300)).toEqual([0, 0, 0, 255]);
    expect(world.describe()).toMatchObject({ live: 1, space: 'world' });
  });

  it('defers world-space bursts until the emitter is attached', async () => {
    t = await createTestGame();
    const e = new ParticleEmitter({ rate: 0, speed: 0, lifetime: 5, space: 'world', seed: 2 }, { x: 50, y: 60 });
    e.burst(3);
    expect(e.particleCount).toBe(0);
    t.game.sceneLayer.add(e);
    await t.step(1);
    expect(e.particleCount).toBe(3);
    expect(e.particleAt(0)).toMatchObject({ x: 50, y: 60 });
  });

  it('every preset produces particles and renders', async () => {
    t = await createTestGame();
    const names = Object.keys(particlePresets) as ParticlePresetName[];
    expect(names.sort()).toEqual(
      ['coinBurst', 'confetti', 'dust', 'explosion', 'fire', 'hitSpark', 'magic', 'rain', 'smoke', 'snow', 'sparkle', 'trail'],
    );
    for (const name of names) {
      const e = t.game.sceneLayer.add(new ParticleEmitter(particlePresets[name]({ seed: 5 }), { x: 375, y: 600 }));
      let peak = 0;
      for (let i = 0; i < 30; i++) {
        e.update(1 / 60);
        peak = Math.max(peak, e.particleCount);
      }
      expect(peak, name).toBeGreaterThan(0);
    }
    t.game.render();
  });

  it('spawnParticles adds a self-destroying preset emitter', async () => {
    t = await createTestGame();
    const e = spawnParticles(t.game.sceneLayer, 'confetti', { x: 375, y: 600 });
    await t.step(1);
    expect(t.find('ParticleEmitter[preset=confetti]')).toBe(e);
    expect(e.describe().live).toBe(70);
    await t.advance(3);
    expect(e.destroyed).toBe(true);
    const fire = spawnParticles(t.game.sceneLayer, 'fire', { x: 100, y: 100, rate: 10 });
    await t.step(2);
    expect(fire.emitting).toBe(true);
    expect(fire.particleCount).toBeGreaterThan(0);
    fire.stop();
    await t.advance(1.5);
    expect(fire.destroyed).toBe(true);
    expect(() => spawnParticles(t!.game.sceneLayer, 'nope' as ParticlePresetName)).toThrow(/unknown preset/);
  });

  it('stress: 1000 particles for 120 frames without growing the pool', async () => {
    t = await createTestGame();
    const results: string[] = [];
    const shapes: ParticleShape[] = ['circle', 'square', 'spark', 'star'];
    for (const shape of shapes) {
      const e = t.game.sceneLayer.add(
        new ParticleEmitter(
          {
            rate: 0,
            maxParticles: 1000,
            lifetime: 100,
            speed: [20, 200],
            gravity: 50,
            drag: 0.2,
            spin: [-90, 90],
            size: [6, 14],
            scaleEnd: 0.5,
            shape,
            color: [
              [0, '#ffffff'],
              [1, '#ff8800'],
            ],
            alpha: [
              [0, 1],
              [1, 0.5],
            ],
            spawn: { type: 'circle', radius: 200 },
            seed: 9,
          },
          { x: 375, y: 667 },
        ),
      );
      e.burst(1000);
      const pool = (e as unknown as { pool: unknown[] }).pool;
      const frame = () => {
        t!.game.update(1 / 60);
        t!.game.render();
      };
      for (let i = 0; i < 5; i++) frame();
      const drawn = 30;
      const t0 = performance.now();
      for (let i = 0; i < drawn; i++) frame();
      const frameMs = (performance.now() - t0) / drawn;
      const t1 = performance.now();
      for (let i = 0; i < 120; i++) e.update(1 / 60);
      const updateMs = (performance.now() - t1) / 120;
      expect(e.particleCount).toBe(1000);
      expect(pool.length).toBe(1000);
      expect(frameMs).toBeLessThan(100);
      results.push(`${shape}: ${frameMs.toFixed(2)} ms/frame (update+render), update ${updateMs.toFixed(3)} ms`);
      e.destroy();
    }
    console.log(`[perf] 1000 particles, 30 drawn + 120 updated frames, headless 780x1688 canvas\n  ${results.join('\n  ')}`);
  });
});

describe('sandbox display scenes', () => {
  it('build, spawn bursts on tap and animate on tap', async () => {
    t = await createTestGame({ app: sandbox as AppDef, scene: 'display-particles' });
    const before = t.findAll('ParticleEmitter').length;
    expect(before).toBe(12);
    await t.tap({ x: 375, y: 1000 });
    expect(t.findAll('ParticleEmitter').length).toBe(before + 1);
    await t.go('display-graphics');
    expect(t.find('Graphics#g-star-linear')).not.toBeNull();
    expect(t.find('Sprite#baked')).not.toBeNull();
    await t.go('display-sprites');
    await t.tap('#slime');
    expect(t.get<AnimatedSprite>('#slime').currentClip).toBe('hop');
    await t.advance(1);
    expect(t.get<AnimatedSprite>('#slime').currentClip).toBe('idle');
    expect(t.get<CacheContainer>('#cache').redraws).toBe(1);
  });
});
