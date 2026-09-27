import { Scene } from '@engine';
import { screenLayout } from '../layout';
import { mountMenu } from './menu';

/** The start menu alone over a plain background, for screenshots and lint (placeholder; owned by the menu worker). */
export class MenuPreviewScene extends Scene {
  override get kind(): string {
    return 'MenuPreviewScene';
  }

  override onEnter(): void {
    const { zone, hudBottom } = screenLayout(this.game.view, this.game.safe);
    mountMenu(this, { zone, hudBottom });
  }
}
