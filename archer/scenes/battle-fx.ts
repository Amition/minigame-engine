import { Node, playSound, popIn, shake, spawnParticles, Sprite, Text, tween, type Vec2 } from '@engine';
import { ART_KEYS } from '../art/index';
import { COLORS, type AppleKind } from '../config';
import type { BattleEvent } from '../model';
import { ExplosionNode, LightningNode } from './battle-view';

/**
 * Juice shared by the solo and the two-player battles: sparks, blasts, floating numbers, banners, flying skulls and
 * the effects of world events that look the same in every mode. `field` is the scaled world node (shaken on
 * impacts), `layer` a world-space fx node inside it, `screen` a scene-space fx node above the HUD.
 */
export class BattleFx {
  constructor(
    private readonly scene: Node,
    private readonly field: Node,
    private readonly layer: Node,
    private readonly screen: Node,
  ) {}

  /** Plays the effect of a world event (stuck arrows, blasts, status effects...); false for events it leaves alone. */
  world(e: BattleEvent): boolean {
    switch (e.type) {
      case 'dot':
        this.popupWorld(`-${Math.max(1, Math.round(e.damage))}`, e.x, e.y - 40, 34, COLORS.poison, '#1f3d12');
        return true;
      case 'thunk':
        playSound('thunk', { volume: 0.7, pitchJitter: 1 });
        this.sparks(e.x, e.y, 6, [COLORS.stoneLight, COLORS.dustLight]);
        return true;
      case 'explode':
        this.explosion(e.x, e.y, e.radius);
        return true;
      case 'zap':
        playSound('zap');
        this.layer.add(new LightningNode(46, { x: e.x, y: e.y }));
        return true;
      case 'poison':
        playSound('poison');
        this.sparks(e.x, e.y, 10, [COLORS.poison, '#b6f09c']);
        return true;
      case 'balloon':
        playSound('balloon', { rate: 0.9 + e.count * 0.1 });
        if (e.lifted) this.popupWorld('飞走啦!', e.x, e.y - 80, 38, '#ffd166', '#7a3b00');
        return true;
      case 'saw':
        playSound('saw');
        this.sparks(e.x, e.y, 14, [COLORS.spark, '#ffffff']);
        return true;
      case 'split':
        playSound('shoot', { rate: 1.4, volume: 0.35 });
        return true;
      default:
        return false;
    }
  }

  sparks(x: number, y: number, count: number, colors: string[]): void {
    spawnParticles(
      this.layer,
      {
        bursts: [{ count }],
        maxParticles: count + 4,
        shape: 'circle',
        speed: [140, 420],
        gravity: 1100,
        drag: 2,
        lifetime: [0.25, 0.6],
        size: [5, 9],
        colors,
      },
      { x, y },
    );
  }

  explosion(x: number, y: number, radius: number): void {
    playSound('explode');
    const n = this.layer.add(new ExplosionNode(radius, { x, y }));
    tween(n, { progress: 1 }, 0.45, { ease: 'quadOut', owner: this.scene, onComplete: () => n.destroy() });
    spawnParticles(this.layer, 'explosion', { x, y, maxParticles: 40 });
    this.sparks(x, y, 20, [COLORS.spark, '#ffb347', '#ffffff']);
    shake(this.field, radius > 100 ? 14 : 9, 0.35);
  }

  /** Juice burst where an apple was shot. */
  appleBurst(kind: AppleKind, x: number, y: number): void {
    spawnParticles(
      this.layer,
      {
        bursts: [{ count: 16 }],
        maxParticles: 20,
        shape: 'circle',
        speed: [150, 380],
        gravity: 900,
        drag: 1.5,
        lifetime: [0.35, 0.7],
        size: [6, 12],
        colors: [kind === 'red' ? COLORS.hp : kind === 'green' ? COLORS.poison : '#f5c542', '#ffffff'],
      },
      { x, y },
    );
  }

  /** Floating text in world units (inside the field). */
  popupWorld(text: string, x: number, y: number, size: number, color: string, stroke: string): void {
    const t = this.layer.add(new Text(text, { fontSize: size, fontWeight: 'bold', color, stroke: { color: stroke, width: 7 } }, { x, y, anchor: 0.5 }));
    t.zIndex = 10;
    popIn(t, 0.18);
    tween(t, { y: y - 70, alpha: 0 }, 0.8, { delay: 0.35, ease: 'quadIn', owner: this.scene, onComplete: () => t.destroy() });
  }

  /** Floating text next to a HUD node (scene units). */
  popupScreen(text: string, near: Node, color: string): void {
    const c = near.worldCenter();
    const p = this.screen.toLocal(c.x, c.y);
    const t = this.screen.add(new Text(text, { fontSize: 28, fontWeight: 'bold', color, stroke: { color: '#111114', width: 6 } }, { x: p.x, y: p.y - 44, anchor: 0.5 }));
    popIn(t, 0.15);
    tween(t, { y: p.y - 90, alpha: 0 }, 0.7, { delay: 0.3, owner: this.scene, onComplete: () => t.destroy() });
  }

  /** Big centred announcement ('首领来袭', '第2回合'): pops in, holds, fades out. */
  banner(text: string, stroke: string, opts: { size?: number; hold?: number; y?: number; id?: string } = {}): Text {
    const t = this.screen.add(
      new Text(text, { fontSize: opts.size ?? 76, fontWeight: 'bold', color: '#ffffff', stroke: { color: stroke, width: 12 } }, {
        id: opts.id,
        x: this.scene.width / 2,
        y: opts.y ?? this.scene.height * 0.3,
        anchor: 0.5,
      }),
    );
    popIn(t, 0.4);
    tween(t, { alpha: 0 }, 0.5, { delay: opts.hold ?? 1.5, owner: this.scene, onComplete: () => t.destroy() });
    return t;
  }

  /** '+N' skulls flying from a kill (world point) to `target` (a HUD node); `onLand` runs when they arrive. */
  flySkulls(reward: number, wx: number, wy: number, target: Node | undefined, onLand: () => void): void {
    const from = this.field.toWorld(wx, wy);
    const to: Vec2 = target?.worldCenter() ?? { x: 60, y: 40 };
    const a = this.screen.toLocal(from.x, from.y);
    const b = this.screen.toLocal(to.x, to.y);
    const g = this.screen.add(new Node({ x: a.x, y: a.y - 40 }));
    g.add(new Sprite(ART_KEYS.skull, { anchor: 0.5, width: 44, height: 44 }));
    g.add(new Text(`+${reward}`, { fontSize: 34, fontWeight: 'bold', color: '#ffffff', stroke: { color: '#3b3b3d', width: 6 } }, { x: 28, y: 0, anchorY: 0.5 }));
    popIn(g, 0.25);
    tween(g, { x: b.x, y: b.y, scale: 0.6 }, 0.65, {
      delay: 0.5,
      ease: 'quadIn',
      owner: this.scene,
      onComplete: () => {
        g.destroy();
        onLand();
      },
    });
  }
}
