import { Node, Scene, type Ctx2D } from '@engine';
import { drawBackdrop } from '../art/index';
import { screenLayout } from '../layout';
import { mountMenu } from './menu';

export interface PlayParams {
  seed?: number;
}

/** Placeholder: the battle worker replaces this with the real battle scene (menu overlay, aiming, HUD, pause). */
export class PlayScene extends Scene {
  override get kind(): string {
    return 'PlayScene';
  }

  override onEnter(_params?: PlayParams): void {
    const w = this.width;
    const h = this.height;
    this.add(
      new (class extends Node {
        override draw(ctx: Ctx2D): void {
          drawBackdrop(ctx, w, h, 0);
        }
      })({ id: 'backdrop', width: w, height: h }),
    );
    const { zone, hudBottom } = screenLayout(this.game.view, this.game.safe);
    mountMenu(this, { zone, hudBottom });
  }
}
