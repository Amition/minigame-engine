import type { Rect } from '@engine';
import { WORLD_H, WORLD_W } from './types';

/**
 * Shared screen geometry (lead-owned contract). The battle world (WORLD_W x WORLD_H world units) is drawn in a
 * `field` node scaled to fit the view and centred; the menu and HUD live in scene coordinates around it.
 */

/** Player tower: centre x and top y (the player's floor) in world units. */
export const TOWER_X = 380;
export const TOWER_TOP = 620;
/** Where the first enemy (idle during the start menu) stands: block top corner, world units. */
export const MENU_ENEMY_X = 1080;
export const MENU_ENEMY_TOP = 520;

export interface ScreenLayout {
  /** World-to-scene mapping: scene = (field.x + wx * field.scale, field.y + wy * field.scale). */
  field: { x: number; y: number; scale: number };
  /**
   * Operation zone (操作区), scene coordinates: the full-height strip on the left. The play scene's aim zone covers
   * it (in the menu and in battle); the menu draws its dark panel and hints there without taking taps.
   */
  zone: Rect;
  /** Bottom of the top-left skull counter row; menu content on the left starts below it. */
  hudBottom: number;
}

export function screenLayout(view: { width: number; height: number }, safe: Rect): ScreenLayout {
  const scale = Math.min(view.width / WORLD_W, view.height / WORLD_H);
  return {
    field: { x: (view.width - WORLD_W * scale) / 2, y: (view.height - WORLD_H * scale) / 2, scale },
    zone: { x: 0, y: 0, w: Math.max(safe.x + 380, Math.round(view.width * 0.34)), h: view.height },
    hudBottom: safe.y + 70,
  };
}
