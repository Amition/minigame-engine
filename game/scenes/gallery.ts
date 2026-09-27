import { Scene, Text } from '@engine';
import { FruitNode } from '../art/fruit-art';
import { FRUITS } from '../fruits';

/** Art review scene: every fruit at its game size. `pnpm shot --app game --scene gallery` */
export class GalleryScene extends Scene {
  override onEnter(): void {
    const w = this.width;
    this.add(new Text('Fruit gallery', { fontSize: 36, color: '#5a3a1a', fontWeight: 'bold' }, { x: w / 2, y: 90, anchor: 0.5 }));
    let x = 20;
    let y = 160;
    let rowH = 0;
    for (const f of FRUITS) {
      const d = f.radius * 2;
      if (x + d > w - 20) {
        x = 20;
        y += rowH + 50;
        rowH = 0;
      }
      this.add(new FruitNode(f.level, { x: x + f.radius, y: y + f.radius }));
      this.add(new Text(f.name, { fontSize: 22, color: '#5a3a1a' }, { x: x + f.radius, y: y + d + 22, anchor: 0.5 }));
      x += d + 20;
      rowH = Math.max(rowH, d);
    }
  }
}
