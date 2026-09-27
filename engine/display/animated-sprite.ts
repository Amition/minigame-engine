import type { Texture } from '../gfx/texture';
import { textures } from '../gfx/textures';
import type { NodeOptions } from '../scene/node';
import { Sprite, type SpriteFit } from '../scene/sprite';

/** A frame: a Texture or a texture registry key. */
export type SpriteFrameSource = Texture | string;

export interface SpriteClip {
  frames: readonly SpriteFrameSource[];
  /** Frames per second (default 12). */
  fps?: number;
  /** Loop forever (default true). */
  loop?: boolean;
  /** Clip to play after this one completes (non-looping clips only). */
  next?: string;
}

export interface AnimatedSpriteOptions extends NodeOptions {
  /** Clip shown first (default: the first clip). */
  start?: string;
  /** Start playing immediately (default true). */
  autoPlay?: boolean;
  /** Playback speed multiplier (default 1; negative plays backwards). */
  speed?: number;
  /** fps / loop for the single clip created when frames are passed as an array. */
  fps?: number;
  loop?: boolean;
  fit?: SpriteFit;
}

/** Payload of the 'frame' event. */
export interface SpriteFrameEvent {
  clip: string;
  frame: number;
}

interface ResolvedClip {
  name: string;
  frames: Texture[];
  fps: number;
  loop: boolean;
  next: string;
}

const resolveFrame = (f: SpriteFrameSource): Texture => (typeof f === 'string' ? textures.get(f) : f);

/**
 * Frame-by-frame animation with named clips:
 *
 *     const hero = new AnimatedSprite({ idle: { frames: idleTex, fps: 6 }, run: { frames: runTex, fps: 12 } });
 *     hero.play('run');
 *     hero.on('complete', (clip) => ...);   // non-looping clip finished
 *     hero.on('frame', (e) => ...);         // { clip, frame } on every frame change
 *
 * Size comes from the first frame of the initial clip; later frames are drawn into the same box.
 */
export class AnimatedSprite extends Sprite {
  /** Playback speed multiplier; negative plays backwards. */
  speed = 1;
  private readonly clipMap = new Map<string, ResolvedClip>();
  private current: ResolvedClip | null = null;
  private _frame = 0;
  private acc = 0;
  private _playing = false;

  constructor(frames: readonly SpriteFrameSource[] | Record<string, SpriteClip>, opts: AnimatedSpriteOptions = {}) {
    super();
    const defs: Record<string, SpriteClip> = Array.isArray(frames)
      ? { default: { frames: frames as readonly SpriteFrameSource[], fps: opts.fps ?? 12, loop: opts.loop ?? true } }
      : (frames as Record<string, SpriteClip>);
    for (const [name, def] of Object.entries(defs)) this.addClip(name, def);
    const first = opts.start ?? Object.keys(defs)[0];
    if (first !== undefined) {
      this.useClip(first);
      this.showFrame(0);
      if (this.texture) this.setTexture(this.texture);
    }
    if (opts.speed !== undefined) this.speed = opts.speed;
    if (opts.fit) this.fit = opts.fit;
    this.set(opts);
    if (first !== undefined && opts.autoPlay !== false) this.play(first);
  }

  override get kind(): string {
    return 'AnimatedSprite';
  }

  /** Adds or replaces a clip. Texture keys are resolved immediately. */
  addClip(name: string, def: SpriteClip): this {
    this.clipMap.set(name, {
      name,
      frames: def.frames.map(resolveFrame),
      fps: def.fps ?? 12,
      loop: def.loop ?? true,
      next: def.next ?? '',
    });
    return this;
  }

  hasClip(name: string): boolean {
    return this.clipMap.has(name);
  }

  get clipNames(): string[] {
    return [...this.clipMap.keys()];
  }

  /** Name of the active clip. */
  get currentClip(): string {
    return this.current?.name ?? '';
  }

  get currentFrame(): number {
    return this._frame;
  }

  get totalFrames(): number {
    return this.current?.frames.length ?? 0;
  }

  get playing(): boolean {
    return this._playing;
  }

  /** Plays a clip (default: the current one). Does not restart a clip that is already playing unless `restart`. */
  play(name?: string, restart = false): this {
    const target = name ?? this.current?.name;
    if (target === undefined) return this;
    if (!restart && this._playing && this.current?.name === target) return this;
    const changed = this.useClip(target);
    if (changed || restart || this._frame < 0 || this.atEnd()) this.showFrame(this.speed < 0 ? this.totalFrames - 1 : 0);
    this.acc = 0;
    this._playing = this.totalFrames > 0;
    return this;
  }

  stop(): this {
    this._playing = false;
    return this;
  }

  /** Jumps to a frame (optionally of another clip) and stops. */
  gotoAndStop(frame: number, clip?: string): this {
    if (clip !== undefined) this.useClip(clip);
    this.showFrame(frame);
    this.acc = 0;
    this._playing = false;
    return this;
  }

  /** Jumps to a frame (optionally of another clip) and plays from there. */
  gotoAndPlay(frame: number, clip?: string): this {
    if (clip !== undefined) this.useClip(clip);
    this.showFrame(frame);
    this.acc = 0;
    this._playing = this.totalFrames > 0;
    return this;
  }

  override update(dt: number): void {
    const c = this.current;
    if (!this._playing || !c || c.frames.length === 0 || c.fps <= 0) return;
    this.acc += dt * this.speed * c.fps;
    while (this._playing && this.current === c && this.acc >= 1 - 1e-9) {
      this.acc -= 1;
      this.advance(1);
    }
    while (this._playing && this.current === c && this.acc <= -1 + 1e-9) {
      this.acc += 1;
      this.advance(-1);
    }
  }

  override describe() {
    return {
      ...super.describe(),
      clip: this.current?.name,
      frame: this._frame,
      frames: this.totalFrames,
      playing: this._playing,
    };
  }

  private advance(dir: 1 | -1): void {
    const c = this.current!;
    const n = c.frames.length;
    const next = this._frame + dir;
    if (next >= 0 && next < n) {
      this.showFrame(next);
      return;
    }
    if (c.loop) {
      this.showFrame(dir > 0 ? 0 : n - 1);
      return;
    }
    this._playing = false;
    this.acc = 0;
    this.emit('complete', c.name);
    if (c.next && this.current === c && !this._playing) this.play(c.next, true);
  }

  private atEnd(): boolean {
    const n = this.totalFrames;
    return this.speed < 0 ? this._frame <= 0 : this._frame >= n - 1;
  }

  /** Switches the active clip without changing play state. Returns true if the clip changed. */
  private useClip(name: string): boolean {
    const c = this.clipMap.get(name);
    if (!c) throw new Error(`AnimatedSprite: no clip "${name}" (have: ${this.clipNames.join(', ')})`);
    if (c === this.current) return false;
    this.current = c;
    this._frame = -1;
    return true;
  }

  private showFrame(i: number): void {
    const c = this.current;
    if (!c || c.frames.length === 0) return;
    const f = Math.max(0, Math.min(c.frames.length - 1, Math.floor(i)));
    const changed = f !== this._frame;
    this._frame = f;
    this.texture = c.frames[f]!;
    if (changed && this.hasListeners('frame')) this.emit('frame', { clip: c.name, frame: f } satisfies SpriteFrameEvent);
  }
}
