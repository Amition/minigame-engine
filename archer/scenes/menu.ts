import {
  bakeTexture,
  canShowAd,
  isAudioMuted,
  mountScreen,
  Node,
  parseColor,
  playSound,
  punch,
  setAudioMuted,
  shake,
  showDialog,
  showModal,
  showRewardedAd,
  showToast,
  textures,
  toastHost,
  tween,
  ui,
  UIView,
  type Ctx2D,
  type Dialog,
  type DialogButton,
  type Game,
  type Label,
  type Modal,
  type Rect,
  type Scene,
  type Texture,
  type UIChild,
  type UIIcon,
  type UIToastVariant,
  type UIViewProps,
} from '@engine';
import { ART_KEYS } from '../art/index';
import { AD_SKULLS, ARROWS, arrowDef, COLORS, UPGRADES, upgradeBonusText, type ArrowDef, type ArrowId, type LabelColor, type UpgradeId } from '../config';
import { MENU_ENEMY_TOP, MENU_ENEMY_X, screenLayout, TOWER_TOP, TOWER_X } from '../layout';
import {
  buyUpgrade,
  equippedArrows,
  equipSlot,
  grantTrial,
  hasTrial,
  isEquipped,
  isOwned,
  nextUpgradeCost,
  toggleEquip,
  unlockArrow,
  upgradeLevel,
} from '../progress';
import { addSkulls, archerSave, currentStats } from '../save';

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
  return new ArcherMenu(scene, opts);
}

// ---------------------------------------------------------------- geometry

const MIN_TAP = 88;
/** Upgrade price button and the name + bonus labels beside it. */
const PRICE_W = 108;
const PRICE_H = 60;
const ROW_GAP = 12;
const LABEL_W = 186;
const ROWS_W = PRICE_W + ROW_GAP + LABEL_W;
/** Row pitch: one full tap target per row when the safe height allows it. */
const MAX_PITCH = 88;
/** Arrow list: '单次体验' tag gutter + card; cards are one tap target tall. */
const LIST_W = 290;
const TAG_W = 52;
const CARD_W = LIST_W - TAG_W;
const CARD_H = 88;
const CARD_BODY_H = 58;
const HEADER_H = 40;
/** Top-right band the play scene's score ('得分 x/best') occupies. */
const SCORE_H = 76;
/** Bottom cluster: gear button, then the leaderboard button with the podium above it. */
const BTN_H = 64;
const BOARD_W = 136;
const CLUSTER_GAP = 14;
const PODIUM = 64;
const CLUSTER_W = BTN_H + CLUSTER_GAP + BOARD_W;
const CLUSTER_H = PODIUM + 8 + BTN_H;

export interface MenuGeometry {
  /** Dark translucent 操作区 panel (decor only). */
  panel: Rect;
  /** Column of zone hints (title, stamina note, animated tutorial); h is the tutorial box height. */
  hints: Rect;
  /** Top-left of the '+100' ad button (visual box; its hit area adds padding up to 88). */
  ad: { x: number; y: number };
  /** Upgrade rows column and its row pitch. */
  rows: Rect;
  pitch: number;
  /** Screen area of the idle first enemy (with its bow, HP bar and block), kept free of menu content. */
  enemy: Rect;
  /** Screen area of the player standing on the tower; the tutorial finger stays left of it. */
  player: Rect;
  /** Arrow list: header + scroll view. */
  list: Rect;
  /** Settings + leaderboard cluster. */
  cluster: Rect;
}

/** Where each menu part goes for a view / safe area, the play scene's zone and its HUD bottom. */
export function menuGeometry(view: { width: number; height: number }, safe: Rect, zone: Rect, hudBottom: number): MenuGeometry {
  const { field } = screenLayout(view, safe);
  const s = field.scale;
  const enemy = { x: field.x + (MENU_ENEMY_X - 100) * s, y: field.y + (MENU_ENEMY_TOP - 240) * s, w: 200 * s, h: 380 * s };
  const player = { x: field.x + (TOWER_X - 60) * s, y: field.y + (TOWER_TOP - 220) * s, w: 150 * s, h: 220 * s };
  const zoneRight = zone.x + zone.w;
  const left = Math.max(zone.x, safe.x) + 16;
  const safeBottom = safe.y + safe.h;
  const pitch = Math.min(MAX_PITCH, Math.floor((safe.h - 8) / UPGRADES.length));
  const rowsH = pitch * UPGRADES.length;
  // Price buttons pad their hit area by (88 - PRICE_H) / 2; start far enough right that it stays out of the zone.
  const rows = { x: zoneRight + 24, y: Math.round(safe.y + (safe.h - rowsH) / 2), w: ROWS_W, h: rowsH };
  const listTop = safe.y + SCORE_H;
  const list = { x: safe.x + safe.w - 16 - LIST_W, y: listTop, w: LIST_W, h: safeBottom - 8 - listTop };
  const lo = rows.x + rows.w + 12;
  const hi = list.x - 12 - CLUSTER_W;
  const cx = Math.round(Math.max(Math.min(enemy.x + enemy.w / 2 - CLUSTER_W / 2, hi), Math.min(lo, hi)));
  return {
    panel: { x: zone.x + 8, y: zone.y + 8, w: zone.w - 16, h: zone.h - 16 },
    hints: { x: left, y: hudBottom + 72, w: zoneRight - 16 - left, h: 112 },
    ad: { x: left + 4, y: hudBottom + 8 },
    rows,
    pitch,
    enemy,
    player,
    list,
    cluster: { x: cx, y: safeBottom - 14 - CLUSTER_H, w: CLUSTER_W, h: CLUSTER_H },
  };
}

// ---------------------------------------------------------------- look

const LABEL_COLORS: Record<LabelColor, string> = { red: COLORS.labelRed, blue: COLORS.labelBlue, orange: COLORS.labelOrange };
/** Modal / dialog panel in the game's flat greys instead of the theme's indigo. */
const PANEL = { gradient: null, fill: '#2d2d30', border: { color: '#5a5a5f', width: 3 } };
const MAXED_FILL = '#c4c4c9';
const PRIMARY_FACE = '#ffb627';
const PRIMARY_INK = '#4a2500';

const inked = new Map<string, { src: Texture; tex: Texture }>();

/**
 * The art icons are white on transparent; light buttons need them dark. Maps brightness per pixel (white -> ink,
 * black -> paper) so painted details such as eye sockets survive. Falls back to the key while the art is missing.
 */
function inkIcon(key: string, ink: string = COLORS.buttonText, paper: string = COLORS.button): Texture | string {
  const src = textures.tryGet(key);
  if (!src) return key;
  const id = `${key}~${ink}~${paper}`;
  const hit = inked.get(id);
  if (hit && hit.src === src) return hit.tex;
  const res = 2;
  const w = src.width;
  const h = src.height;
  const a = parseColor(ink);
  const b = parseColor(paper);
  const tex = bakeTexture(
    w,
    h,
    (ctx) => {
      src.draw(ctx, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, Math.ceil(w * res), Math.ceil(h * res));
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        const l = (0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!) / 255;
        d[i] = b.r + (a.r - b.r) * l;
        d[i + 1] = b.g + (a.g - b.g) * l;
        d[i + 2] = b.b + (a.b - b.b) * l;
      }
      ctx.putImageData(img, 0, 0);
    },
    { resolution: res, key: id },
  );
  inked.set(id, { src, tex });
  return tex;
}

/** Flat rounded button (the original's light grey keys): press dip, hit area padded to 88. */
class FlatButton extends UIView {
  private pressTween: { kill(): void } | null = null;

  constructor(props: UIViewProps, onPress: () => void) {
    super(
      { direction: 'row', align: 'center', justify: 'center', gap: 6, fill: COLORS.button, radius: 12, anchor: 0.5, lintRole: 'control', ...props },
      'FlatButton',
    );
    this.interactive = true;
    this.on('pointerdown', () => this.dip(true));
    this.on('pointerup', () => this.dip(false));
    this.on('pointercancel', () => this.dip(false));
    this.onTap(() => onPress());
  }

  private dip(down: boolean): void {
    this.pressTween?.kill();
    const s = down ? 0.94 : 1;
    this.pressTween = tween(this, { scaleX: s, scaleY: s }, down ? 0.06 : 0.18, { ease: down ? 'quadOut' : 'backOut' });
  }

  override onLayout(): void {
    this.hitPadding = Math.ceil(Math.max(0, MIN_TAP - Math.min(this.width, this.height)) / 2);
  }
}

function flatButton(props: UIViewProps, kids: readonly UIChild[], onPress: () => void): FlatButton {
  const b = new FlatButton(props, onPress);
  for (const k of kids) if (k) b.add(k);
  return b;
}

/**
 * The 操作区 tutorial: a thick grey finger presses near the bow side, slides back leaving a dotted pull line, holds,
 * lets go, loops. Decoration only (not interactive).
 */
class AimHint extends Node {
  static readonly PERIOD = 2.6;
  private clock = 0;

  /** pressX / pullX: local x where the finger presses and where the pull ends. */
  constructor(
    private readonly pressX: number,
    private readonly pullX: number,
  ) {
    super();
  }

  override get kind(): string {
    return 'AimHint';
  }

  override update(dt: number): void {
    this.clock = (this.clock + dt) % AimHint.PERIOD;
  }

  override draw(ctx: Ctx2D): void {
    const h = this.height;
    const t = this.clock;
    const px = this.pressX;
    const py = h * 0.7;
    const qx = this.pullX;
    const qy = h * 0.8;
    const smooth = (u: number) => u * u * (3 - 2 * u);
    let k = 0;
    let alpha = 1;
    let lift = 0;
    let pressed = true;
    if (t < 0.35) {
      alpha = t / 0.35;
      lift = 1 - alpha;
      pressed = false;
    } else if (t < 0.55) {
      k = 0;
    } else if (t < 1.45) {
      k = smooth((t - 0.55) / 0.9);
    } else if (t < 1.85) {
      k = 1;
    } else if (t < 2.15) {
      k = 1;
      lift = (t - 1.85) / 0.3;
      alpha = 1 - lift;
      pressed = false;
    } else return;
    const tx = px + (qx - px) * k;
    const ty = py + (qy - py) * k - lift * 22;
    ctx.save();
    ctx.globalAlpha *= alpha;
    if (k > 0) {
      const dx = px - tx;
      const dy = py - ty;
      const n = Math.max(1, Math.floor(Math.hypot(dx, dy) / 15));
      ctx.fillStyle = '#ffffff';
      for (let i = 1; i <= n; i++) {
        ctx.beginPath();
        ctx.arc(tx + (dx * i) / n, ty + (dy * i) / n, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (t >= 0.35 && t < 0.8) {
      const u = (t - 0.35) / 0.45;
      ctx.save();
      ctx.globalAlpha *= 1 - u;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, 12 + 26 * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    const ux = -0.87;
    const uy = 0.5;
    const len = 170;
    const ex = tx + ux * len;
    const ey = ty + uy * len;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#76767c';
    ctx.lineWidth = 38;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.strokeStyle = '#a3a3a9';
    ctx.lineWidth = 28;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.strokeStyle = '#86868c';
    ctx.lineWidth = 3;
    for (const d of [104, 118]) {
      const cx = tx + ux * d;
      const cy = ty + uy * d;
      ctx.beginPath();
      ctx.moveTo(cx - uy * 11, cy + ux * 11);
      ctx.quadraticCurveTo(cx + ux * 4, cy + uy * 4, cx + uy * 11, cy - ux * 11);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(tx, ty, pressed ? 8 : 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ---------------------------------------------------------------- menu

interface UpgradeRowNodes {
  row: UIView;
  btn: FlatButton;
  skull: UIIcon;
  price: Label;
  bonus: Label;
}

class ArcherMenu implements MenuHandle {
  readonly root: Node;
  private readonly rows = new Map<UpgradeId, UpgradeRowNodes>();
  private readonly cards = new Map<ArrowId, UIView>();
  private readonly modals = new Set<Modal>();
  private header!: Label;
  private ad!: FlatButton;
  private adBusy = false;
  private closing = false;
  private readonly game: Game;

  constructor(
    scene: Scene,
    private readonly opts: MenuOptions,
  ) {
    const game = (this.game = scene.game);
    this.root = scene.add(new Node({ id: 'menu', width: scene.width, height: scene.height }));
    const g = menuGeometry(game.view, game.safe, opts.zone, opts.hudBottom);
    mountScreen(this.root, ui.view({ kind: 'MenuLayer' }, [...this.buildZone(g), this.buildRows(g), ...this.buildList(g), this.buildCluster(g)]), {
      area: 'view',
    });
    this.root.onUpdate(() => {
      this.ad.visible = this.adBusy || canShowAd('rewarded');
    });
    this.refresh();
  }

  // ------------------------------------------------ build

  private buildZone(g: MenuGeometry): UIChild[] {
    const abs = (r: Rect) => ({ position: 'absolute' as const, left: r.x, top: r.y, width: r.w });
    const panel = ui.view({ kind: 'ZonePanel', id: 'menu-zone', ...abs(g.panel), height: g.panel.h, fill: 'rgba(0,0,0,0.2)', radius: 28 });
    this.ad = flatButton(
      { id: 'menu-ad', position: 'absolute', left: g.ad.x, top: g.ad.y, height: 48, padding: [0, 16], gap: 8, fill: 'rgba(0,0,0,0.32)', radius: 'full' },
      [ui.icon(ART_KEYS.film, { size: 36, shrink: 0 }), ui.text(`+${AD_SKULLS}`, { size: 30, weight: 'bold', color: COLORS.labelOrange })],
      () => void this.watchAd(),
    );
    const pressX = Math.max(g.hints.w * 0.4, Math.min(g.hints.w * 0.56, g.player.x - 40 - g.hints.x));
    const hint = new AimHint(pressX, Math.round(g.hints.w * 0.17));
    const tutorial = ui.view({ kind: 'AimTutorial', width: g.hints.w, height: g.hints.h }, [
      ui.text('按住松开', { position: 'absolute', left: Math.round(g.hints.w * 0.04), top: 0, size: 28, color: COLORS.text }),
      ui.node(hint, { position: 'absolute', left: 0, top: 0, width: g.hints.w, height: g.hints.h }),
    ]);
    const hints = ui.column({ kind: 'ZoneHints', ...abs(g.hints), align: 'center', gap: 14 }, [
      ui.text('操作区', { id: 'zone-title', size: 46, color: COLORS.text }),
      ui.row({ gap: 6 }, [ui.text('射击消耗', { size: 28, color: COLORS.text }), ui.text('体力', { size: 28, color: COLORS.labelBlue })]),
      tutorial,
    ]);
    return [panel, this.ad, hints];
  }

  private buildRows(g: MenuGeometry): UIView {
    const col = ui.column({ kind: 'UpgradeRows', id: 'menu-upgrades', position: 'absolute', left: g.rows.x, top: g.rows.y, width: g.rows.w, height: g.rows.h });
    for (const u of UPGRADES) {
      const color = LABEL_COLORS[u.color];
      const skull = ui.icon(inkIcon(ART_KEYS.skull), { size: 30, shrink: 0 });
      const price = ui.text('', { id: `price-${u.id}`, size: 26, weight: 'bold', color: COLORS.buttonText, autoFit: 20 });
      const btn = flatButton({ id: `buy-${u.id}`, width: PRICE_W, height: PRICE_H, gap: 4, padding: [0, 8] }, [skull, price], () => this.buy(u.id));
      const bonus = ui.text('+0', { id: `bonus-${u.id}`, size: 26, color });
      const row = ui.row({ kind: 'UpgradeRow', id: `upgrade-${u.id}`, height: g.pitch, gap: ROW_GAP, anchor: [0.3, 0.5] }, [
        btn,
        ui.text(u.name, { size: 28, color }),
        bonus,
      ]);
      col.add(row);
      this.rows.set(u.id, { row, btn, skull, price, bonus });
    }
    return col;
  }

  private buildList(g: MenuGeometry): UIChild[] {
    this.header = ui.text('', { id: 'slots-header', size: 26, color: COLORS.text });
    const head = ui.row({ kind: 'SlotsHeader', position: 'absolute', left: g.list.x + TAG_W, top: g.list.y, width: CARD_W, height: HEADER_H }, [this.header]);
    const scroll = ui.scroll(
      { id: 'arrow-list', position: 'absolute', left: g.list.x, top: g.list.y + HEADER_H + 4, width: g.list.w, height: g.list.h - HEADER_H - 4 },
      ARROWS.map((a) => {
        const c = ui.view({ kind: 'ArrowCard', id: `arrow-${a.id}`, height: CARD_H, anchor: 0.5, lintRole: 'control' });
        c.onTap(() => this.tapArrow(a.id));
        this.cards.set(a.id, c);
        return c;
      }),
    );
    return [head, scroll];
  }

  private buildCluster(g: MenuGeometry): UIView {
    const top = PODIUM + 8;
    return ui.view({ kind: 'MenuCluster', position: 'absolute', left: g.cluster.x, top: g.cluster.y, width: g.cluster.w, height: g.cluster.h }, [
      ui.image(ART_KEYS.podium, { position: 'absolute', left: BTN_H + CLUSTER_GAP + (BOARD_W - PODIUM) / 2, top: 0, width: PODIUM, height: PODIUM }),
      flatButton({ id: 'menu-settings', position: 'absolute', left: 0, top, width: BTN_H, height: BTN_H }, [ui.icon(inkIcon(ART_KEYS.gear), { size: 40 })], () =>
        this.openSettings(),
      ),
      flatButton(
        { id: 'menu-leaderboard', position: 'absolute', left: BTN_H + CLUSTER_GAP, top, width: BOARD_W, height: BTN_H },
        [ui.text('排行榜', { size: 28, color: COLORS.buttonText })],
        () => this.openBoard(),
      ),
    ]);
  }

  // ------------------------------------------------ state

  refresh(): void {
    if (this.root.destroyed) return;
    for (const u of UPGRADES) {
      const r = this.rows.get(u.id)!;
      const cost = nextUpgradeCost(u.id);
      const maxed = !Number.isFinite(cost);
      r.skull.visible = !maxed;
      r.price.text = maxed ? '已满' : String(cost);
      r.btn.fill = maxed ? MAXED_FILL : COLORS.button;
      r.bonus.text = upgradeBonusText(u.id, upgradeLevel(u.id));
    }
    this.header.text = `箭矢槽 ${equippedArrows().length}/${currentStats().slots}`;
    for (const a of ARROWS) this.renderCard(a);
  }

  private renderCard(a: ArrowDef): void {
    const c = this.cards.get(a.id)!;
    for (const k of [...c.children]) k.destroy();
    const owned = isOwned(a.id);
    const slot = equipSlot(a.id);
    const trial = !owned && hasTrial(a.id);
    const fill = owned ? COLORS.card : a.trial ? COLORS.cardTrial : COLORS.cardLocked;
    const badge = (kid: Node) =>
      ui.stack({ width: 36, height: 36, radius: 'full', fill: COLORS.labelOrange, shrink: 0 }, [kid]);
    const lead: UIChild[] = [];
    if (slot > 0) lead.push(badge(ui.text(String(slot), { size: 22, weight: 'bold', color: COLORS.buttonText })));
    else if (trial) lead.push(badge(ui.icon('check', { size: 24, color: COLORS.buttonText })));
    else if (!owned && a.trial) lead.push(ui.icon(ART_KEYS.film, { size: 40, shrink: 0 }));
    else if (!owned) {
      lead.push(
        ui.icon(inkIcon(ART_KEYS.lock, COLORS.buttonText, COLORS.cardLocked), { size: 30, shrink: 0 }),
        ui.row({ gap: 2, shrink: 0 }, [
          ui.icon(inkIcon(ART_KEYS.skull, COLORS.buttonText, COLORS.cardLocked), { size: 22 }),
          ui.text(String(a.cost), { size: 22, weight: 'bold', color: COLORS.buttonText }),
        ]),
      );
    }
    c.add(
      ui.row(
        {
          kind: 'CardBody',
          position: 'absolute',
          left: TAG_W,
          top: 4,
          width: CARD_W,
          height: CARD_BODY_H,
          fill,
          radius: 10,
          padding: [0, 14, 0, 12],
          gap: 6,
          border: slot > 0 || trial ? { color: COLORS.labelOrange, width: 4 } : null,
        },
        [...lead, ui.spacer(), ui.text(a.name, { size: 28, color: COLORS.buttonText })],
      ),
    );
    const arrowW = CARD_W + 12;
    const arrowH = Math.round((arrowW * 56) / 300);
    c.add(ui.image(ART_KEYS.arrow(a.id), { position: 'absolute', left: TAG_W - 6, top: CARD_H - arrowH, width: arrowW, height: arrowH, fit: 'fill' }));
    if (!owned && a.trial) {
      c.add(
        ui.text(trial ? '本局\n可用' : '单次\n体验', {
          id: `trial-tag-${a.id}`,
          position: 'absolute',
          left: 0,
          top: 7,
          width: TAG_W - 6,
          size: 20,
          lineHeight: 1.25,
          align: 'center',
          color: COLORS.text,
        }),
      );
    }
  }

  // ------------------------------------------------ actions

  private buy(id: UpgradeId): void {
    const r = this.rows.get(id)!;
    const res = buyUpgrade(id);
    if (res === 'ok') {
      playSound('buy');
      this.refresh();
      punch(r.row, 1.06, 0.25);
      this.changed();
      return;
    }
    playSound('deny');
    shake(r.btn, 8, 0.3);
    this.say(res === 'max' ? '已满级' : '骷髅币不足', res === 'max' ? 'info' : 'danger');
  }

  private tapArrow(id: ArrowId): void {
    const a = arrowDef(id);
    const card = this.cards.get(id)!;
    if (!isOwned(id)) {
      playSound('click');
      this.openArrow(a);
      return;
    }
    switch (toggleEquip(id)) {
      case 'equipped':
        playSound('equip');
        this.refresh();
        punch(card, 1.05, 0.22);
        this.say(`已装备${a.name}：${a.desc}`, 'success');
        this.changed();
        break;
      case 'unequipped':
        playSound('equip', { rate: 0.85 });
        this.refresh();
        this.say(`已卸下${a.name}`);
        this.changed();
        break;
      case 'full':
        playSound('deny');
        shake(card, 8, 0.3);
        this.say('箭矢槽已满，可在升级中增加', 'warning');
        break;
      case 'last':
        playSound('deny');
        shake(card, 8, 0.3);
        this.say('至少要装备一种箭矢', 'warning');
        break;
      case 'locked':
        break;
    }
  }

  private openArrow(a: ArrowDef): void {
    const buttons: DialogButton[] = [
      { id: 'arrow-unlock', text: '解锁', action: 'unlock', size: 'md', keepOpen: true, onTap: () => this.unlockFromDialog(a, dialog) },
    ];
    if (a.trial && !hasTrial(a.id) && canShowAd('rewarded')) {
      buttons.push({ id: 'arrow-trial', text: '看广告体验一局', action: 'trial', size: 'md', icon: ART_KEYS.film, color: COLORS.button, textColor: COLORS.buttonText });
    }
    const ink = { size: 26, color: COLORS.textDim };
    const dialog = showDialog({ id: 'arrow-dialog', title: a.name, buttons, vertical: true, closeButton: true, ...PANEL }, [
      ui.image(ART_KEYS.arrow(a.id), { width: 420, height: 78, alignSelf: 'center' }),
      ui.text(a.desc, { id: 'arrow-desc', variant: 'body', align: 'center' }),
      ui.row({ justify: 'center', gap: 6 }, [
        ui.text('拥有', ink),
        ui.icon(ART_KEYS.skull, { size: 28 }),
        ui.text(String(archerSave().data.skulls), { ...ink, color: COLORS.text }),
      ]),
    ]);
    const priceInk = { size: 32, weight: 'bold' as const, color: PRIMARY_INK };
    dialog.buttons[0]!.add(
      ui.row({ gap: 2 }, [ui.text('(', priceInk), ui.icon(inkIcon(ART_KEYS.skull, PRIMARY_INK, PRIMARY_FACE), { size: 34 }), ui.text(`${a.cost})`, priceInk)]),
    );
    this.track(dialog);
    void dialog.closed.then((r) => {
      if (r === 'trial') void this.trial(a);
    });
  }

  private unlockFromDialog(a: ArrowDef, dialog: Dialog): void {
    if (unlockArrow(a.id) === 'poor') {
      playSound('deny');
      shake(dialog.buttons[0]!, 8, 0.3);
      this.say('骷髅币不足', 'danger');
      return;
    }
    dialog.close('unlock');
    playSound('buy');
    this.refresh();
    const card = this.cards.get(a.id);
    if (card) punch(card, 1.06, 0.25);
    this.say(isEquipped(a.id) ? `已解锁并装备${a.name}` : `已解锁${a.name}（箭矢槽已满）`, 'success');
    this.changed();
  }

  private async trial(a: ArrowDef): Promise<void> {
    const ok = await showRewardedAd('rewarded');
    if (this.root.destroyed) return;
    if (!ok) {
      this.say('广告未看完，无法体验', 'warning');
      return;
    }
    grantTrial(a.id);
    playSound('equip');
    this.refresh();
    this.say(`本局可体验${a.name}`, 'success');
    this.changed();
  }

  private async watchAd(): Promise<void> {
    if (this.adBusy || this.closing) return;
    this.adBusy = true;
    playSound('click');
    const ok = await showRewardedAd('rewarded');
    this.adBusy = false;
    if (this.root.destroyed) return;
    if (!ok) {
      this.say('广告未看完，没有奖励', 'warning');
      return;
    }
    addSkulls(AD_SKULLS);
    archerSave().flush();
    playSound('coin');
    punch(this.ad, 1.12, 0.25);
    this.say(`获得 ${AD_SKULLS} 骷髅币`, 'success');
    this.refresh();
    this.changed();
  }

  private openSettings(): void {
    playSound('click');
    const row = (label: string, id: string, channel: 'sfx' | 'music') =>
      ui.row({ justify: 'between', align: 'center', width: 420 }, [
        ui.text(label, { variant: 'body' }),
        ui.toggle({ id, value: !isAudioMuted(channel), onChange: (on) => setAudioMuted(channel, !on) }),
      ]);
    this.track(showModal({ id: 'settings', title: '设置', ...PANEL }, [row('音效', 'sfx-toggle', 'sfx'), row('音乐', 'music-toggle', 'music')]));
  }

  private openBoard(): void {
    playSound('click');
    const runs = archerSave().data.runs;
    const cell = (text: string, width: number, color: string = COLORS.text, size = 26) => ui.text(text, { width, size, color, align: 'center' });
    const kids: Node[] =
      runs.length === 0
        ? [
            ui.image(ART_KEYS.podium, { width: 96, height: 96, alignSelf: 'center' }),
            ui.text('还没有记录，快去战斗吧', { id: 'board-empty', variant: 'body', align: 'center', color: COLORS.textDim }),
          ]
        : [
            ui.row({ padding: [0, 12] }, [cell('排名', 80, COLORS.textDim, 24), cell('得分', 110, COLORS.textDim, 24), cell('骷髅币', 130, COLORS.textDim, 24), cell('日期', 150, COLORS.textDim, 24)]),
            ui.scroll(
              { id: 'board-list', height: Math.min(runs.length * 56, Math.max(168, this.game.safe.h - 330)) },
              runs.map((r, i) =>
                ui.row({ id: `run-${i}`, height: 56, padding: [0, 12], radius: 10, fill: i % 2 === 0 ? 'rgba(255,255,255,0.06)' : null }, [
                  cell(String(i + 1), 80, i === 0 ? COLORS.labelOrange : COLORS.text, 28),
                  cell(String(r.score), 110, COLORS.text, 28),
                  ui.row({ width: 130, justify: 'center', gap: 4 }, [ui.icon(ART_KEYS.skull, { size: 26 }), ui.text(String(r.skulls), { size: 26, color: COLORS.text })]),
                  cell(formatDate(r.at), 150, COLORS.textDim, 24),
                ]),
              ),
            ),
          ];
    this.track(showModal({ id: 'leaderboard', title: '排行榜', ...PANEL }, kids));
  }

  // ------------------------------------------------ helpers

  private track(m: Modal): void {
    this.modals.add(m);
    void m.closed.then(() => this.modals.delete(m));
  }

  private say(text: string, variant: UIToastVariant = 'info'): void {
    toastHost().clear();
    showToast(text, { variant, duration: 1.6 });
  }

  private changed(): void {
    this.opts.onChange?.();
  }

  close(): void {
    if (this.closing || this.root.destroyed) return;
    this.closing = true;
    this.root.interactiveChildren = false;
    for (const m of [...this.modals]) m.close(null);
    tween(this.root, { alpha: 0 }, 0.25, { onComplete: () => this.root.destroy() });
  }
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
