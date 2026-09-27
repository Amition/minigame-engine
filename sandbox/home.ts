import { Box, Scene, Text } from '@engine';

/** Lists every registered scene as a button. */
export class HomeScene extends Scene {
  override onEnter(): void {
    const g = this.game;
    this.add(new Box(this.width, this.height, { fill: '#14161c' }, { id: 'bg' }));
    this.add(
      new Text('Engine Sandbox', { fontSize: 44, fontWeight: 'bold', color: '#ffffff' }, {
        id: 'title',
        x: this.width / 2,
        y: g.safe.y + 80,
        anchor: 0.5,
      }),
    );
    const names = g.scenes.names().filter((n) => n !== 'home');
    const cols = 2;
    const gap = 24;
    const w = (this.width - 48 * 2 - gap) / cols;
    const h = 96;
    names.forEach((name, i) => {
      const x = 48 + (i % cols) * (w + gap);
      const y = g.safe.y + 160 + Math.floor(i / cols) * (h + gap);
      const btn = this.add(
        new Box(w, h, { fill: '#2b3140', radius: 20 }, {
          id: `go-${name}`,
          tags: ['scene-button'],
          x,
          y,
        }),
      );
      btn.add(new Text(name, { fontSize: 28, color: '#e6e9f2' }, { x: w / 2, y: h / 2, anchor: 0.5 }));
      btn.onTap(() => void g.scenes.go(name));
    });
    if (names.length === 0) {
      this.add(
        new Text('No demo scenes yet', { fontSize: 28, color: '#8a90a2' }, {
          x: this.width / 2,
          y: this.height / 2,
          anchor: 0.5,
        }),
      );
    }
  }
}
