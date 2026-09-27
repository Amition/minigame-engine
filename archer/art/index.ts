import { bakeTexture, textures, type Ctx2D } from '@engine';
import { APPLES, ARROWS, type AppleKind, type ArrowId } from '../config';
import { drawArrowCard } from './arrows';
import { paintFilmIcon, paintGearIcon, paintLockIcon, paintPodiumIcon, paintSkullIcon } from './icons';
import { drawApple } from './world';

/**
 * ART CONTRACT (signatures frozen).
 *
 * World painters draw in world units (see types.ts) straight onto the given context; the battle scene calls them from
 * its nodes' draw(). They must not allocate textures per call.
 *
 * bakeArcherArt() runs once in boot() and registers these textures (use `textures.set(key, bakeTexture(...))`,
 * sizes in design units, resolution 'auto'):
 *   'archer:skull'            48 x 48   white skull (currency icon)
 *   'archer:lock'             48 x 48   white padlock
 *   'archer:film'             48 x 48   yellow/black film-strip ad icon (单次体验 / +100)
 *   'archer:gear'             48 x 48   white settings gear
 *   'archer:podium'           64 x 64   leaderboard icon (three people on a podium)
 *   'archer:apple-<kind>'     64 x 64   red / green / gold apple
 *   'archer:arrow-<id>'      300 x 56   arrow of each type lying horizontally, TIP ON THE LEFT (menu list cards)
 *
 * Modules: arrows.ts (drawArrow, drawStuckArrow, card art), fighter.ts (drawFighter, drawHpBar, nockDistance),
 * world.ts (backdrop, platforms, apples, explosion, lightning), icons.ts (baked icon painters), common.ts (art clock).
 */
export const ART_KEYS = {
  skull: 'archer:skull',
  lock: 'archer:lock',
  film: 'archer:film',
  gear: 'archer:gear',
  podium: 'archer:podium',
  apple: (kind: AppleKind) => `archer:apple-${kind}`,
  arrow: (id: ArrowId) => `archer:arrow-${id}`,
} as const;

/** Card texture size of 'archer:arrow-<id>' in design units. */
export const ARROW_CARD_W = 300;
export const ARROW_CARD_H = 56;

function bake(key: string, w: number, h: number, draw: (ctx: Ctx2D, w: number, h: number) => void): void {
  textures.set(key, bakeTexture(w, h, draw, { resolution: 'auto', key }));
}

/** Bakes and registers every texture listed above. Safe to call again (re-registers). */
export function bakeArcherArt(): void {
  bake(ART_KEYS.skull, 48, 48, (ctx, w) => paintSkullIcon(ctx, w));
  bake(ART_KEYS.lock, 48, 48, (ctx, w) => paintLockIcon(ctx, w));
  bake(ART_KEYS.film, 48, 48, (ctx, w) => paintFilmIcon(ctx, w));
  bake(ART_KEYS.gear, 48, 48, (ctx, w) => paintGearIcon(ctx, w));
  bake(ART_KEYS.podium, 64, 64, (ctx, w) => paintPodiumIcon(ctx, w));
  for (const a of APPLES) bake(ART_KEYS.apple(a.kind), 64, 64, (ctx) => drawApple(ctx, a.kind, 31, 37, 22, 0));
  for (const a of ARROWS) bake(ART_KEYS.arrow(a.id), ARROW_CARD_W, ARROW_CARD_H, (ctx, w, h) => drawArrowCard(ctx, a.id, w, h));
}

export { drawArrow, drawArrowCard, drawStuckArrow } from './arrows';
export { setArtTime } from './common';
export { drawFighter, drawHpBar, nockDistance } from './fighter';
export { paintFilmIcon, paintGearIcon, paintLockIcon, paintPodiumIcon, paintSkullIcon } from './icons';
export { drawApple, drawBackdrop, drawExplosion, drawLightning, drawPlatform } from './world';
