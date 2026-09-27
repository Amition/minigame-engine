import { mountScreen, Node, Scene, ui, type Ctx2D, type Label, type NodeOptions } from '@engine';
import { ART_KEYS, drawBackdrop } from '../art/index';
import { COLORS, NO_UPGRADES } from '../config';
import { MENU_ENEMY_TOP, MENU_ENEMY_X, screenLayout, TOWER_TOP, TOWER_X, type ScreenLayout } from '../layout';
import { archerSave } from '../save';
import { WORLD_H } from '../types';
import { mountMenu, type MenuHandle } from './menu';

export interface MenuPreviewParams {
  /** Fill the save with bought upgrades, unlocked arrows and leaderboard runs (screenshots of a played save). */
  demo?: boolean;
  /** Override the skull count. */
  skulls?: number;
}

/**
 * The start menu alone over the backdrop, for screenshots and lint. Stand-ins mark what the play scene owns: the
 * skull counter (top-left), the score (top-right), the tower with the player and the idle first enemy.
 */
export class MenuPreviewScene extends Scene {
  menu!: MenuHandle;
  /** onChange calls so far (tests). */
  changes = 0;
  private skullLabel!: Label;

  override get kind(): string {
    return 'MenuPreviewScene';
  }

  override onEnter(params?: MenuPreviewParams): void {
    if (params?.demo) seedDemo();
    if (params?.skulls !== undefined) archerSave().set({ skulls: params.skulls });
    const lay = screenLayout(this.game.view, this.game.safe);
    this.add(new PreviewBackdrop(lay, { id: 'backdrop', width: this.width, height: this.height }));
    this.menu = mountMenu(this, {
      zone: lay.zone,
      hudBottom: lay.hudBottom,
      onChange: () => {
        this.changes++;
        this.skullLabel.text = String(archerSave().data.skulls);
      },
    });
    this.skullLabel = ui.text(String(archerSave().data.skulls), { id: 'hud-skulls', size: 32, weight: 'bold', color: COLORS.text });
    const d = archerSave().data;
    mountScreen(
      this.add(new Node({ id: 'hud', width: this.width, height: this.height })),
      ui.view({ kind: 'HudStandIn' }, [
        ui.row({ position: 'absolute', left: 20, top: 12, gap: 8 }, [ui.icon(ART_KEYS.skull, { size: 36 }), this.skullLabel]),
        ui.row({ position: 'absolute', right: 24, top: 12, gap: 24 }, [
          ui.text('赛季', { size: 28, color: COLORS.labelOrange }),
          ui.text(`得分 0/${d.best}`, { id: 'hud-score', size: 36, weight: 'bold', color: COLORS.text }),
        ]),
      ]),
    );
  }
}

/** Backdrop plus grey silhouettes of the tower, the player and the first enemy on its block. */
class PreviewBackdrop extends Node {
  private clock = 0;

  constructor(
    private readonly lay: ScreenLayout,
    opts: NodeOptions,
  ) {
    super(opts);
  }

  override update(dt: number): void {
    this.clock += dt;
  }

  override draw(ctx: Ctx2D): void {
    drawBackdrop(ctx, this.width, this.height, this.clock);
    const { x, y, scale } = this.lay.field;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = COLORS.stone;
    ctx.fillRect(TOWER_X - 110, TOWER_TOP, 220, WORLD_H - TOWER_TOP);
    for (let i = 0; i < 4; i++) ctx.fillRect(TOWER_X - 110 + i * 64, TOWER_TOP - 28, 28, 28);
    ctx.fillStyle = COLORS.block;
    ctx.beginPath();
    ctx.moveTo(MENU_ENEMY_X, MENU_ENEMY_TOP);
    ctx.lineTo(MENU_ENEMY_X + 75, MENU_ENEMY_TOP + 75);
    ctx.lineTo(MENU_ENEMY_X, MENU_ENEMY_TOP + 150);
    ctx.lineTo(MENU_ENEMY_X - 75, MENU_ENEMY_TOP + 75);
    ctx.closePath();
    ctx.fill();
    stickFigure(ctx, TOWER_X, TOWER_TOP - 28, 1);
    stickFigure(ctx, MENU_ENEMY_X, MENU_ENEMY_TOP, -1);
    ctx.restore();
  }
}

function stickFigure(ctx: Ctx2D, x: number, footY: number, facing: 1 | -1): void {
  const hip = footY - 80;
  const neck = hip - 54;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = COLORS.figure;
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.moveTo(x - 18, footY);
  ctx.lineTo(x, hip);
  ctx.lineTo(x + 18, footY);
  ctx.moveTo(x + facing * 62, neck + 6);
  ctx.lineTo(x, neck + 4);
  ctx.lineTo(x - facing * 26, neck + 14);
  ctx.stroke();
  ctx.lineWidth = 24;
  ctx.beginPath();
  ctx.moveTo(x, hip);
  ctx.lineTo(x, neck);
  ctx.stroke();
  ctx.fillStyle = COLORS.figure;
  ctx.beginPath();
  ctx.arc(x, neck - 24, 17, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COLORS.bow;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(x + facing * 44, neck + 6, 46, facing > 0 ? -1.1 : Math.PI - 1.1, facing > 0 ? 1.1 : Math.PI + 1.1);
  ctx.stroke();
  ctx.restore();
}

function seedDemo(): void {
  const day = 86_400_000;
  const now = Date.UTC(2026, 8, 27, 11, 30);
  const scores = [141, 118, 97, 86, 71, 64, 52, 40, 33, 21];
  archerSave().set({
    skulls: 2736,
    levels: { ...NO_UPGRADES, armor: 1, hp: 2, stamina: 1, regen: 1, drawSpeed: 1, damage: 1, slots: 1 },
    owned: ['normal', 'electric', 'poison', 'explosive'],
    equipped: ['normal', 'electric', 'explosive'],
    best: scores[0]!,
    runs: scores.map((score, i) => ({ score, skulls: score * 4 + 12, at: now - i * day * 0.7 })),
    games: 23,
  });
}
