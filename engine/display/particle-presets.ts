import type { Node } from '../scene/node';
import { ParticleEmitter, type ParticleConfig } from './particles';

export type ParticlePresetName =
  | 'explosion'
  | 'confetti'
  | 'sparkle'
  | 'smoke'
  | 'fire'
  | 'rain'
  | 'snow'
  | 'coinBurst'
  | 'hitSpark'
  | 'magic'
  | 'dust'
  | 'trail';

type Preset = (overrides?: Partial<ParticleConfig>) => ParticleConfig;

const preset =
  (base: ParticleConfig): Preset =>
  (o) => ({ ...base, ...o });

/**
 * Ready-made effect configs, sized for a 750-wide design. Call with overrides: `particlePresets.fire({ rate: 80 })`.
 * One-shot: explosion, confetti, coinBurst, hitSpark, dust. Continuous: sparkle, smoke, fire, rain, snow, magic, trail.
 * rain/snow spawn along a 750-unit line centered on the emitter (put it at the top center of the view).
 */
export const particlePresets: Record<ParticlePresetName, Preset> = {
  explosion: preset({
    bursts: [{ count: 40 }],
    maxParticles: 60,
    spawn: { type: 'circle', radius: 10 },
    radial: true,
    speed: [100, 480],
    drag: 4,
    lifetime: [0.45, 0.9],
    size: [26, 50],
    scale: 1,
    scaleEnd: 0.3,
    color: [
      [0, '#fffbe6'],
      [0.2, '#ffd166'],
      [0.5, '#ff7b25'],
      [1, '#5a1a0a'],
    ],
    alpha: [
      [0, 1],
      [0.6, 0.85],
      [1, 0],
    ],
    blend: 'lighter',
  }),
  confetti: preset({
    bursts: [{ count: 70 }],
    maxParticles: 90,
    shape: 'square',
    colors: ['#ff5d73', '#ffd23f', '#3ec1d3', '#7bd389', '#a78bfa', '#ff9f1c'],
    speed: [350, 800],
    angle: [235, 305],
    gravity: 900,
    drag: 1.6,
    rotation: [0, 360],
    spin: [-720, 720],
    size: [9, 15],
    lifetime: [1.4, 2.2],
    alpha: [
      [0, 1],
      [0.8, 1],
      [1, 0],
    ],
  }),
  sparkle: preset({
    rate: 14,
    maxParticles: 40,
    shape: 'star',
    spawn: { type: 'circle', radius: 60 },
    speed: [5, 30],
    angle: [0, 360],
    lifetime: [0.5, 1.1],
    size: [18, 34],
    scale: [0.5, 1],
    scaleEnd: 0,
    spin: [-180, 180],
    colors: ['#ffffff', '#fff6b0', '#b8e1ff'],
    alpha: [
      [0, 0],
      [0.3, 1],
      [1, 0],
    ],
    blend: 'lighter',
    prewarm: 1,
  }),
  smoke: preset({
    rate: 10,
    maxParticles: 50,
    spawn: { type: 'circle', radius: 12 },
    speed: [25, 55],
    angle: [255, 285],
    drag: 0.4,
    lifetime: [1.8, 2.8],
    size: [30, 50],
    scale: 0.5,
    scaleEnd: [1.6, 2.2],
    color: [
      [0, '#a3a8b0'],
      [1, '#5f6368'],
    ],
    alpha: [
      [0, 0],
      [0.15, 0.4],
      [1, 0],
    ],
    prewarm: 2,
  }),
  fire: preset({
    rate: 60,
    maxParticles: 90,
    spawn: { type: 'circle', radius: 18 },
    speed: [70, 160],
    angle: [258, 282],
    gravity: { x: 0, y: -120 },
    lifetime: [0.5, 0.9],
    size: [30, 46],
    scale: 1,
    scaleEnd: 0.1,
    color: [
      [0, '#fff3b0'],
      [0.25, '#ffb627'],
      [0.6, '#ff5e1a'],
      [1, '#7a1c0a'],
    ],
    alpha: [
      [0, 0],
      [0.1, 0.9],
      [0.7, 0.6],
      [1, 0],
    ],
    blend: 'lighter',
    prewarm: 1,
  }),
  rain: preset({
    rate: 90,
    maxParticles: 150,
    shape: 'spark',
    spawn: { type: 'line', length: 750 },
    speed: [900, 1100],
    angle: [100, 103],
    lifetime: 1,
    size: 2,
    stretch: 0.035,
    color: '#aac8ff',
    alpha: 0.6,
    prewarm: 1,
  }),
  snow: preset({
    rate: 22,
    maxParticles: 220,
    spawn: { type: 'line', length: 750 },
    speed: [30, 70],
    angle: [75, 105],
    gravity: 8,
    lifetime: [6, 9],
    size: [4, 10],
    color: '#ffffff',
    alpha: [
      [0, 0],
      [0.1, 0.9],
      [0.85, 0.9],
      [1, 0],
    ],
    prewarm: 6,
  }),
  coinBurst: preset({
    bursts: [{ count: 16 }],
    maxParticles: 30,
    shape: 'coin',
    colors: ['#ffd23f', '#ffc300', '#ffe066', '#f5b700'],
    speed: [380, 680],
    angle: [235, 305],
    gravity: 1500,
    rotation: [0, 180],
    spin: [360, 900],
    size: [18, 26],
    lifetime: [0.8, 1.2],
    alpha: [
      [0, 1],
      [0.85, 1],
      [1, 0],
    ],
  }),
  hitSpark: preset({
    bursts: [{ count: 14 }],
    maxParticles: 24,
    shape: 'spark',
    speed: [400, 900],
    drag: 6,
    lifetime: [0.15, 0.32],
    size: [3, 6],
    stretch: 0.05,
    color: [
      [0, '#ffffff'],
      [0.5, '#ffe08a'],
      [1, '#ff8a3d'],
    ],
    alpha: [
      [0, 1],
      [1, 0],
    ],
    blend: 'lighter',
  }),
  magic: preset({
    rate: 30,
    maxParticles: 60,
    shape: 'star',
    spawn: { type: 'ring', radius: 50, inner: 38 },
    speed: [10, 40],
    angle: [250, 290],
    gravity: { x: 0, y: -40 },
    lifetime: [0.8, 1.4],
    size: [12, 22],
    scale: 1,
    scaleEnd: 0,
    spin: [-240, 240],
    colors: ['#c084fc', '#818cf8', '#f0abfc', '#ffffff'],
    alpha: [
      [0, 0],
      [0.2, 1],
      [1, 0],
    ],
    blend: 'lighter',
    prewarm: 1,
  }),
  dust: preset({
    bursts: [{ count: 10 }],
    maxParticles: 20,
    spawn: { type: 'line', length: 40 },
    speed: [30, 100],
    angle: [195, 345],
    drag: 3,
    gravity: { x: 0, y: -15 },
    lifetime: [0.4, 0.75],
    size: [14, 24],
    scale: 0.5,
    scaleEnd: 1.4,
    color: '#cbbd9f',
    alpha: [
      [0, 0.55],
      [1, 0],
    ],
  }),
  trail: preset({
    rate: 60,
    maxParticles: 80,
    space: 'world',
    speed: [0, 15],
    lifetime: [0.3, 0.5],
    size: [16, 24],
    scale: 1,
    scaleEnd: 0,
    color: [
      [0, '#ffffff'],
      [1, '#60a5fa'],
    ],
    alpha: [
      [0, 0.9],
      [1, 0],
    ],
    blend: 'lighter',
  }),
};

export interface SpawnParticlesOptions extends Partial<ParticleConfig> {
  x?: number;
  y?: number;
  id?: string;
  zIndex?: number;
  /** Reference space for `space: 'world'`. */
  spaceNode?: Node;
}

/**
 * One-liner effect: `spawnParticles(scene, 'confetti', { x: 375, y: 600 })`. Extra options override the preset.
 * autoDestroy defaults to true, so one-shot effects clean up after themselves and continuous ones
 * remove themselves once you call `stop()` and their particles faded.
 */
export function spawnParticles(
  parent: Node,
  effect: ParticlePresetName | ParticleConfig,
  opts: SpawnParticlesOptions = {},
): ParticleEmitter {
  const { x = 0, y = 0, id, zIndex, spaceNode, ...overrides } = opts;
  let base: ParticleConfig;
  if (typeof effect === 'string') {
    const make = particlePresets[effect];
    if (!make) throw new Error(`spawnParticles: unknown preset "${effect}" (have: ${Object.keys(particlePresets).join(', ')})`);
    base = make();
  } else {
    base = effect;
  }
  const emitter = new ParticleEmitter(
    { autoDestroy: true, ...base, ...overrides },
    {
      x,
      y,
      ...(id !== undefined ? { id } : {}),
      ...(zIndex !== undefined ? { zIndex } : {}),
      ...(spaceNode ? { spaceNode } : {}),
      ...(typeof effect === 'string' ? { preset: effect } : {}),
    },
  );
  return parent.add(emitter);
}
