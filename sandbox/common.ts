import { Box, Scene, Text } from '@engine';

/**
 * Base for sandbox demo scenes: dark background, title bar with a back button (#back) that returns to 'home'.
 * Build demo content in `build()`; `this.content` is the area below the title bar (stage coordinates start at 0,0).
 */
export abstract class DemoScene extends Scene {
  abstract readonly title: string;
  protected content!: { x: number; y: number; w: number; h: number };

  override onEnter(params?: unknown): void | Promise<void> {
    const g = this.game;
    this.add(new Box(this.width, this.height, { fill: '#14161c' }, { id: 'bg' }));
    const barH = 96;
    const top = g.safe.y;
    this.add(new Box(this.width, top + barH, { fill: '#1f2330' }, { id: 'titlebar' }));
    const back = this.add(
      new Box(120, 64, { fill: '#2d3345', radius: 16 }, { id: 'back', x: 24, y: top + 16, hitPadding: 12 }),
    );
    back.add(new Text('← 返回', { fontSize: 26, color: '#e6e9f2' }, { x: 60, y: 32, anchor: 0.5 }));
    back.onTap(() => void g.scenes.go('home'));
    this.add(
      new Text(this.title, { fontSize: 34, fontWeight: 'bold', color: '#ffffff' }, {
        id: 'title',
        x: this.width / 2,
        y: top + barH / 2,
        anchor: 0.5,
      }),
    );
    this.content = { x: 0, y: top + barH, w: this.width, h: this.height - top - barH - g.safeInsets.bottom };
    return this.build(params);
  }

  protected abstract build(params?: unknown): void | Promise<void>;
}
