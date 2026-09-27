import { Scene } from '@engine';
import { mountMenu } from './menu';

/** The start menu alone over a plain background, for screenshots and lint (placeholder; owned by the menu worker). */
export class MenuPreviewScene extends Scene {
  override get kind(): string {
    return 'MenuPreviewScene';
  }

  override onEnter(): void {
    const safe = this.game.safe;
    mountMenu(this, { zone: { x: safe.x, y: safe.y, w: this.width * 0.3, h: safe.h }, hudBottom: safe.y + 60 });
  }
}
