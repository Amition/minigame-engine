import { getAudioManager, mountScreen, Node, Scene, tween, ui } from '@engine';
import { FruitNode } from '../art/fruit-art';
import { suikaSave } from '../save';
import { Backdrop } from './play-view';

/** [level, x fraction, y fraction, radius scale] of the fruits around the hero watermelon. */
const ORBIT: readonly (readonly [number, number, number, number])[] = [
  [1, 0.16, 0.34, 1.2],
  [2, 0.84, 0.3, 1],
  [6, 0.14, 0.62, 0.7],
  [4, 0.87, 0.6, 0.75],
  [0, 0.3, 0.26, 1.4],
  [3, 0.7, 0.7, 0.8],
];

/** Start screen: title, a bobbing watermelon with its friends, best score and the start button. */
export class TitleScene extends Scene {
  override get kind(): string {
    return 'TitleScene';
  }

  override onEnter(): void {
    const g = this.game;
    const safe = g.safe;
    const save = suikaSave().data;
    const floorY = safe.y + safe.h - 64;
    const backdrop = this.add(new Backdrop({ width: this.width, height: this.height }));
    backdrop.showJar = false;
    backdrop.jar = { x: 0, y: 0, w: this.width, h: floorY };

    const deco = this.add(new Node({ id: 'deco' }));
    const heroY = safe.y + safe.h * 0.5;
    ORBIT.forEach(([level, fx, fy, k], i) => {
      const f = deco.add(new FruitNode(level, { x: this.width * fx, y: safe.y + safe.h * fy }));
      f.radius *= k;
      f.face = i % 2 ? 'happy' : 'idle';
      tween(f, { y: f.y - 18 }, 1.2 + i * 0.17, { yoyo: true, repeat: Infinity, ease: 'sineInOut', delay: i * 0.2 });
      tween(f, { rotation: (i % 2 ? 1 : -1) * 0.25 }, 1.6 + i * 0.1, { yoyo: true, repeat: Infinity, ease: 'sineInOut' });
    });
    const hero = deco.add(new FruitNode(10, { id: 'hero', x: this.width / 2, y: heroY }));
    hero.radius = 150;
    hero.face = 'happy';
    tween(hero, { y: heroY - 24 }, 1.1, { yoyo: true, repeat: Infinity, ease: 'sineInOut' });
    tween(hero, { rotation: 0.12 }, 1.8, { yoyo: true, repeat: Infinity, ease: 'sineInOut', delay: 0.4 });

    const stats = save.best > 0 ? `最高分 ${save.best}` + (save.watermelons > 0 ? `  ·  大西瓜 ×${save.watermelons}` : '') : '相同水果碰一碰，合出大西瓜！';
    mountScreen(
      this,
      ui.column({ align: 'center', padding: [70, 32, 40, 32] }, [
        ui.text('合成大西瓜', { id: 'title', variant: 'title', size: 108, stroke: { color: '#2f9e44', width: 16 }, align: 'center' }),
        ui.text('Watermelon Merge', { variant: 'h2', size: 30, color: '#b4541d', align: 'center', margin: [14, 0, 0, 0] }),
        ui.spacer(),
        ui.text(stats, { id: 'stats', variant: 'h2', size: 32, color: '#8a4a1f', align: 'center' }),
        ui.button({ id: 'start', text: '开始游戏', icon: 'play', variant: 'success', size: 'xl', width: 460, margin: [24, 0, 0, 0], onTap: () => this.start() }),
      ]),
      { safeArea: true, replace: false },
    );
    getAudioManager(g)?.playMusic('bgm', { fadeMs: 1500 });
  }

  private start(): void {
    getAudioManager(this.game)?.playSfx('click');
    void this.game.scenes.go('play', undefined, { transition: 'fade', duration: 0.35 });
  }
}
