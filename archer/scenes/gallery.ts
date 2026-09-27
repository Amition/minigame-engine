import { Scene, Text } from '@engine';

/** Art review scene (placeholder; the art worker fills it with every painter and baked texture). */
export class GalleryScene extends Scene {
  override get kind(): string {
    return 'GalleryScene';
  }

  override onEnter(): void {
    this.add(new Text('gallery', { fontSize: 40, color: '#ffffff' }, { x: 40, y: 40 }));
  }
}
