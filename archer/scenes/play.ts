import { Node, Scene, type Ctx2D } from '@engine';
import { drawBackdrop } from '../art/index';
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
    const safe = this.game.safe;
    mountMenu(this, { zone: { x: safe.x, y: safe.y, w: w * 0.3, h: safe.h }, hudBottom: safe.y + 60 });
  }
}
