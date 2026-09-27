import { Node, Text, type Scene } from '@engine';

/**
 * MENU CONTRACT (signature frozen; the menu worker replaces this placeholder).
 *
 * The start menu is an overlay mounted by the play scene over the live battle (player on the tower, first enemy
 * idle on its block), like the original: operation-zone hints on the left, the eight upgrade rows in the middle,
 * the arrow list on the right, settings + leaderboard buttons at the bottom, a "+100 skulls" ad button under the
 * scene's skull counter. The play scene owns the skull counter (top-left), the score (top-right), the aim zone and
 * the battle HUD; the menu must not cover or take taps inside `zone` (the player starts a run by aiming there).
 */
export interface MenuOptions {
  /** Operation zone in scene coordinates: the menu draws its hints ("操作区", "射击消耗体力", "按住松开") inside it. */
  zone: { x: number; y: number; w: number; h: number };
  /** Top edge (scene y) the menu content must stay below on the left: the scene's skull counter sits above it. */
  hudBottom: number;
  /** After any purchase / unlock / equip / ad reward: the scene re-reads currentStats(), loadout() and skulls. */
  onChange?: () => void;
}

export interface MenuHandle {
  readonly root: Node;
  /** Re-reads the save and updates every row, price and card. */
  refresh(): void;
  /** Fades out and destroys the menu (the run started). */
  close(): void;
}

export function mountMenu(scene: Scene, opts: MenuOptions): MenuHandle {
  const root = scene.add(new Node({ id: 'menu', width: scene.width, height: scene.height }));
  root.add(new Text('操作区', { fontSize: 44, color: '#ffffff' }, { x: opts.zone.x + opts.zone.w / 2, y: opts.zone.y + 60, anchor: 0.5 }));
  return {
    root,
    refresh() {},
    close() {
      root.destroy();
    },
  };
}
