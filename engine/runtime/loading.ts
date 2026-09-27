import type { Color } from '../core/color';
import { Box } from '../scene/box';
import { Scene, type TransitionOptions } from '../scene/scene';
import { Text } from '../scene/text';
import { loadAssets, type AssetManifest } from './assets';
import { wait } from './timers';

export interface LoadingSceneOptions {
  manifest?: AssetManifest;
  /** Scene to open when loading finished. */
  next?: string;
  nextParams?: unknown;
  /** Transition to the next scene (default fade 0.3s). */
  transition?: TransitionOptions;
  /** Minimum seconds on screen (default 0). */
  minTime?: number;
  title?: string;
  background?: Color;
  barColor?: Color;
  trackColor?: Color;
  textColor?: Color;
}

/**
 * Loads a manifest behind a progress bar, then opens `next`. Use directly or subclass:
 *
 *     scenes: { boot: () => new LoadingScene({ manifest, next: 'menu' }) }
 *     class Boot extends LoadingScene { manifest = { images: {...} }; next = 'menu'; override onLoaded() { bakeArt(); } }
 */
export class LoadingScene extends Scene {
  manifest: AssetManifest;
  next: string;
  nextParams: unknown;
  transition: TransitionOptions;
  minTime: number;
  title: string;
  /** 0..1 */
  progress = 0;
  /** Set when loading failed (also shown on screen). */
  error: Error | null = null;
  protected readonly colors: { background: Color; bar: Color; track: Color; text: Color };
  protected bg: Box | null = null;
  protected track: Box | null = null;
  protected bar: Box | null = null;
  protected label: Text | null = null;

  constructor(opts: LoadingSceneOptions = {}) {
    super();
    this.manifest = opts.manifest ?? {};
    this.next = opts.next ?? '';
    this.nextParams = opts.nextParams;
    this.transition = opts.transition ?? { transition: 'fade', duration: 0.3 };
    this.minTime = opts.minTime ?? 0;
    this.title = opts.title ?? '';
    this.colors = {
      background: opts.background ?? '#14161c',
      bar: opts.barColor ?? '#3b82f6',
      track: opts.trackColor ?? '#2b3140',
      text: opts.textColor ?? '#e6e9f2',
    };
  }

  override onEnter(): void {
    this.buildUI();
    this.layoutUI();
    this.setProgress(0);
    void this.run();
  }

  override onResize(): void {
    this.layoutUI();
  }

  /** Hook after loading, before going to `next` (bake textures, parse data...). May be async. */
  protected onLoaded(): void | Promise<void> {}

  /** Builds the default background, title, bar and percentage label. Override for a custom look. */
  protected buildUI(): void {
    const c = this.colors;
    this.bg = this.add(new Box(this.width, this.height, { fill: c.background }, { id: 'loading-bg' }));
    if (this.title) {
      this.add(new Text(this.title, { fontSize: 44, fontWeight: 'bold', color: c.text }, { id: 'loading-title', anchor: 0.5 }));
    }
    this.track = this.add(new Box(480, 20, { fill: c.track, radius: 10 }, { id: 'loading-track' }));
    this.bar = this.track.add(new Box(0, 20, { fill: c.bar, radius: 10 }, { id: 'loading-bar' }));
    this.label = this.add(new Text('0%', { fontSize: 26, color: c.text }, { id: 'loading-label', anchor: 0.5 }));
  }

  protected layoutUI(): void {
    const w = this.width;
    const h = this.height;
    this.bg?.setSize(w, h);
    const trackW = Math.min(480, w - 120);
    this.track?.setSize(trackW, 20).setPosition((w - trackW) / 2, h * 0.6);
    this.find('#loading-title')?.setPosition(w / 2, h * 0.4);
    this.label?.setPosition(w / 2, h * 0.6 + 60);
    this.setProgress(this.progress);
  }

  /** Updates the bar; called with 0..1 while loading. */
  protected setProgress(p: number): void {
    this.progress = p;
    if (this.bar && this.track) this.bar.width = this.track.width * p;
    if (this.label && !this.error) this.label.text = `${Math.round(p * 100)}%`;
  }

  protected async run(): Promise<void> {
    try {
      await Promise.all([
        loadAssets(this.manifest, (p) => this.setProgress(p)),
        this.minTime > 0 ? wait(this.minTime, { owner: this, game: this.game }) : Promise.resolve(),
      ]);
      await this.onLoaded();
    } catch (e) {
      this.error = e instanceof Error ? e : new Error(String(e));
      console.error(this.error);
      this.label?.setStyle({ color: '#f87171', fontSize: 22, wrapWidth: this.width - 80, align: 'center' });
      if (this.label) this.label.text = this.error.message;
      return;
    }
    if (this.destroyed || !this.next) return;
    void this.game.scenes.go(this.next, this.nextParams, this.transition);
  }
}
