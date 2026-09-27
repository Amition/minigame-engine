import { bakeTexture, Box, Sprite, Text, type SceneFactory } from '@engine';
import { DemoScene } from '../common';

/** Groundwork smoke test: boxes, anchors, rotation, CJK text wrapping, baked sprite, tap counter. */
class BasicsScene extends DemoScene {
  readonly title = 'Basics';

  protected build(): void {
    const { x, y, w } = this.content;
    this.add(
      new Text(
        '这是一段用于测试自动换行的中文文本，包含标点符号：逗号、句号。Mixed English words wrap by word too.',
        { fontSize: 28, color: '#cfd5e6', wrapWidth: w - 96, lineHeight: 1.4 },
        { id: 'para', x: x + 48, y: y + 32 },
      ),
    );
    const tex = bakeTexture(
      96,
      96,
      (ctx, tw, th) => {
        const g = ctx.createRadialGradient(tw * 0.35, th * 0.35, 4, tw / 2, th / 2, tw / 2);
        g.addColorStop(0, '#fff3b0');
        g.addColorStop(1, '#f59e0b');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(tw / 2, th / 2, tw / 2 - 2, 0, Math.PI * 2);
        ctx.fill();
      },
      { resolution: 2, key: 'demo-orb' },
    );
    for (let i = 0; i < 4; i++) {
      this.add(new Sprite(tex, { id: `orb${i}`, x: x + 120 + i * 170, y: y + 330, anchor: 0.5, scale: 0.6 + i * 0.2 }));
    }
    const spinner = this.add(
      new Box(140, 140, { fill: '#3b82f6', radius: 24 }, { id: 'spinner', x: w / 2, y: y + 560, anchor: 0.5 }),
    );
    spinner.onUpdate((dt) => (spinner.rotation += dt * 1.5));
    let count = 0;
    const btn = this.add(
      new Box(360, 100, { fill: '#10b981', radius: 50, shadow: { color: '#0008', blur: 16, y: 6 } }, {
        id: 'counter',
        x: w / 2,
        y: y + 780,
        anchor: 0.5,
      }),
    );
    const label = btn.add(
      new Text('点我 0', { fontSize: 36, fontWeight: 'bold', color: '#ffffff' }, { x: 180, y: 50, anchor: 0.5 }),
    );
    btn.onTap(() => {
      count++;
      label.text = `点我 ${count}`;
    });
  }
}

export const scenes: Record<string, SceneFactory> = {
  basics: () => new BasicsScene(),
};
