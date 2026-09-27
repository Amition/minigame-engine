import {
  createInputActions,
  fixedUpdate,
  followNode,
  isAudioMuted,
  mountScreen,
  Node,
  onAim,
  platform,
  playSong,
  playSound,
  punch,
  Rng,
  Scene,
  setAudioMuted,
  shake,
  showDialog,
  showModal,
  spawnParticles,
  stopSong,
  Text,
  ui,
  wait,
  type AimInfo,
  type FollowRect,
  type Label,
  type Rect,
  type UIImage,
} from '@engine';
import { ART_KEYS } from '../art/index';
import { COLORS, JUMP_COST, SHOT_COST } from '../config';
import { screenLayout, type ScreenLayout } from '../layout';
import { BattleModel, launchSpeed, type BattleEvent, type Fighter, type Human, type Platform, type Who } from '../model';
import { addSkulls, archerSave, currentStats, loadout } from '../save';
import { J } from '../types';
import { BattleFx } from './battle-fx';
import { AimIndicator, AppleLayer, ArrowLayer, Backdrop, FighterNode, PlatformNode, StatBar, TrajectoryPreview } from './battle-view';
import { DEAD_ZONE, PULL_DISTANCE, TOWER_HUD_AREA } from './play';

export type DuoMode = 'versus' | 'coop';

export interface DuoParams {
  mode: DuoMode;
  seed?: number;
}

/** P1 blue, P2 orange: tags over the archers, jump / switch borders, banners. */
export const PLAYER_COLORS: readonly [string, string] = [COLORS.labelBlue, COLORS.labelOrange];
const BAR_W = 120;
const BAR_H = 26;
const JUMP_W = 124;
const JUMP_H = 72;
/** Jump button top inside the tower column: two bars, a spacer and three gaps of 8 above it. */
const JUMP_TOP = BAR_H + 8 + BAR_H + 8 + 4 + 8;
const SWAP_W = 112;
const SWAP_H = 60;

/** One human's input and HUD: its half of the screen, aim feedback, bars, jump and arrow switch. */
interface Pad {
  readonly who: Who;
  readonly human: Human;
  readonly zone: Node;
  readonly indicator: AimIndicator;
  readonly preview: TrajectoryPreview;
  readonly tag: Text;
  readonly hud: Node;
  readonly hp: StatBar;
  readonly stamina: StatBar;
  readonly jump: Node;
  /** Arrow switch (loadout > 1 only): tap cycles to the next arrow. */
  readonly swap: Node | null;
  readonly swapImage: UIImage | null;
  aiming: boolean;
}

/**
 * Local two-player battle on one screen. versus (双人对战): P1 on the left tower, P2 on the mirrored right tower,
 * best of five rounds. coop (双人合作): both archers on the left against the enemy series, shared score and skulls.
 * P1 aims by dragging anywhere in the left half of the screen, P2 in the right half, at the same time.
 */
export class DuoScene extends Scene {
  model!: BattleModel;
  mode: DuoMode = 'versus';
  private layout!: ScreenLayout;
  private backdrop!: Backdrop;
  private field!: Node;
  private platformLayer!: Node;
  private fighterLayer!: Node;
  private tagLayer!: Node;
  private fxLayer!: Node;
  private fxScreen!: Node;
  private juice!: BattleFx;
  private pads: Pad[] = [];
  private scoreLabel!: Label;
  private skullRow: Node | null = null;
  private skullLabel: Label | null = null;
  private pauseButton!: Node;
  private readonly fighterNodes = new Map<Fighter, FighterNode>();
  private readonly platformNodes = new Map<Platform, PlatformNode>();
  /** Face of each human's tower below the archer, scene coordinates (bars, and the jump button in the column). */
  private readonly towerAreas: FollowRect[] = [];
  private readonly fx = new Rng(11);
  private halted = false;
  private shownSkulls = 0;

  override get kind(): string {
    return 'DuoScene';
  }

  override onEnter(params?: DuoParams): void {
    this.mode = params?.mode === 'coop' ? 'coop' : 'versus';
    const save = archerSave();
    this.shownSkulls = save.data.skulls;
    const seed = params?.seed ?? ((Math.floor(platform().now()) ^ (save.data.games * 7919) ^ 0x2f6b) >>> 0);
    this.model = new BattleModel({ seed, mode: this.mode, stats: currentStats(), loadout: loadout() });
    this.layout = screenLayout(this.game.view, this.game.safe);

    this.backdrop = this.add(new Backdrop({ id: 'backdrop' }));
    this.field = this.add(new Node({ id: 'field', tags: ['lint-ignore'] }));
    this.platformLayer = this.field.add(new Node({ id: 'platforms' }));
    this.field.add(new AppleLayer(() => this.model.apples, { id: 'apples' }));
    this.fighterLayer = this.field.add(new Node({ id: 'fighters' }));
    this.tagLayer = this.field.add(new Node({ id: 'tags' }));
    this.field.add(new ArrowLayer(() => this.model.arrows, { id: 'arrows' }));
    const previews = this.model.humans.map((h) => this.field.add(new TrajectoryPreview({ id: `trajectory-p${h.who + 1}`, visible: false })));
    this.fxLayer = this.field.add(new Node({ id: 'fx' }));
    this.syncWorld();

    const zones = this.model.humans.map((h) => this.add(new Node({ id: `aim-p${h.who + 1}`, tags: ['lint-surface'] })));
    this.pads = this.model.humans.map((h, i) => this.buildPad(h, zones[i]!, previews[i]!));
    this.buildTopHud();
    for (const p of this.pads) this.add(p.indicator);
    this.fxScreen = this.add(new Node({ id: 'fx-screen' }));
    this.juice = new BattleFx(this, this.field, this.fxLayer, this.fxScreen);
    this.relayout();
    this.sync();

    for (const p of this.pads) {
      onAim(
        p.zone,
        {
          start: (a) => this.aimStart(p, a),
          move: (a) => this.aimMove(p, a),
          release: (a) => this.aimRelease(p, a),
          cancel: () => this.aimCancel(p),
        },
        { space: this, enabled: () => !this.halted && this.model.state !== 'over' },
      );
    }
    const input = createInputActions(this, {
      jump1: ['Space', 'KeyW'],
      jump2: ['Enter', 'NumpadEnter', 'ArrowUp'],
    });
    input.bindHold('jump1', this.pads[0]!.jump);
    input.bindHold('jump2', this.pads[1]!.jump);
    input.onPress('jump1', () => this.doJump(0), this);
    input.onPress('jump2', () => this.doJump(1), this);

    fixedUpdate(this, 60, (step) => {
      if (!this.halted) this.handle(this.model.step(step));
    });
    playSong('bgm', { fadeMs: 800 });
  }

  override onExit(): void {
    archerSave().flush();
  }

  override onResize(): void {
    if (this.field) this.relayout();
  }

  // ---------------------------------------------------------------- layout / HUD

  private relayout(): void {
    this.layout = screenLayout(this.game.view, this.game.safe);
    const { field } = this.layout;
    this.backdrop.width = this.width;
    this.backdrop.height = this.height;
    this.field.x = field.x;
    this.field.y = field.y;
    this.field.scaleX = this.field.scaleY = field.scale;
    const half = this.width / 2;
    for (const p of this.pads) {
      p.zone.x = p.who === 0 ? 0 : half;
      p.zone.y = 0;
      p.zone.width = half;
      p.zone.height = this.height;
    }
  }

  private get safeBottom(): number {
    return Math.min(this.game.safe.y + this.game.safe.h, this.height);
  }

  /**
   * Co-op P2 stands on the front tower, inside P1's half: its jump button and arrow switch sit in the bottom-right
   * corner of its own half instead.
   */
  private get p2Corner(): boolean {
    return this.mode === 'coop';
  }

  private cornerJumpRect(): Rect {
    const safe = this.game.safe;
    return { x: safe.x + safe.w - 20 - JUMP_W, y: this.safeBottom - 14 - JUMP_H, w: JUMP_W, h: JUMP_H };
  }

  /** Co-op P2's jump button with its 'P2' label above it. */
  private cornerControlsRect(): Rect {
    const j = this.cornerJumpRect();
    return { x: j.x, y: j.y - 38, w: j.w, h: j.h + 38 };
  }

  /** Arrow switch: beside the jump button on the outer side (versus), under it (co-op P1), left of it (co-op P2). */
  private swapRect(who: Who): Rect {
    if (who === 1 && this.p2Corner) {
      const j = this.cornerJumpRect();
      return { x: j.x - 14 - SWAP_W, y: j.y + (JUMP_H - SWAP_H) / 2, w: SWAP_W, h: SWAP_H };
    }
    const r = this.towerAreas[who]!();
    if (this.mode === 'coop') return { x: r.x + (r.w - SWAP_W) / 2, y: r.y + JUMP_TOP + JUMP_H + 12, w: SWAP_W, h: SWAP_H };
    const y = r.y + JUMP_TOP + (JUMP_H - SWAP_H) / 2;
    return { x: who === 0 ? r.x - 14 - SWAP_W : r.x + r.w + 14, y, w: SWAP_W, h: SWAP_H };
  }

  private buildPad(human: Human, zone: Node, preview: TrajectoryPreview): Pad {
    const who = human.who;
    const color = PLAYER_COLORS[who];
    const tag = this.tagLayer.add(
      new Text(`P${who + 1}`, { fontSize: 32, fontWeight: 'bold', color, stroke: { color: '#1f1f22', width: 7 } }, { id: `tag-p${who + 1}`, anchor: 0.5 }),
    );
    const hp = new StatBar(COLORS.hp, { id: `hp-p${who + 1}` });
    const stamina = new StatBar(COLORS.stamina, { id: `stamina-p${who + 1}` });
    const jump = ui.view(
      {
        id: `jump-p${who + 1}`,
        width: JUMP_W,
        height: JUMP_H,
        radius: 14,
        fill: COLORS.button,
        border: { color, width: 4 },
        align: 'center',
        justify: 'center',
        lintRole: 'control',
        hitPadding: 10,
        interactive: true,
      },
      [
        ui.text('跳', { size: 28, weight: 'bold', color: COLORS.buttonText, align: 'center' }),
        ui.text(`${JUMP_COST} 体力`, { size: 20, weight: 'bold', color: '#2563eb', align: 'center' }),
      ],
    );
    const corner = who === 1 && this.p2Corner;
    const hud = this.add(new Node({ id: `tower-hud-p${who + 1}` }));
    const bars: Node[] = [ui.node(hp, { width: BAR_W, height: BAR_H }), ui.node(stamina, { width: BAR_W, height: BAR_H })];
    const area = (this.towerAreas[who] = followNode(this.platformNodes.get(human.tower)!, { ...TOWER_HUD_AREA, space: this }));
    mountScreen(hud, ui.column({ align: 'center', gap: 8 }, corner ? bars : [...bars, ui.spacer(4), jump]), { area });
    if (corner) {
      mountScreen(
        this.add(new Node({ id: 'controls-p2' })),
        ui.column({ align: 'center', justify: 'end', gap: 4 }, [ui.text('P2', { size: 26, weight: 'bold', color }), jump]),
        { area: () => this.cornerControlsRect() },
      );
    }

    let swap: Node | null = null;
    let swapImage: UIImage | null = null;
    if (human.loadout.length > 1) {
      const iw = SWAP_W - 16;
      swapImage = ui.image(ART_KEYS.arrow(human.selected), { width: iw, height: Math.round((iw * 56) / 300) });
      swap = ui.view(
        {
          id: `swap-p${who + 1}`,
          width: SWAP_W,
          height: SWAP_H,
          radius: 14,
          fill: COLORS.card,
          border: { color, width: 3 },
          align: 'center',
          justify: 'center',
          gap: 2,
          lintRole: 'control',
          hitPadding: 14,
          onTap: () => this.cycleArrow(who),
        },
        [swapImage, ui.text('换箭', { size: 20, weight: 'bold', color: COLORS.buttonText, align: 'center' })],
      );
      mountScreen(this.add(new Node({ id: `swap-layer-p${who + 1}` })), swap, { area: () => this.swapRect(who) });
    }
    const indicator = new AimIndicator({ id: `aim-indicator-p${who + 1}` });
    return { who, human, zone, indicator, preview, tag, hud, hp, stamina, jump, swap, swapImage, aiming: false };
  }

  private buildTopHud(): void {
    this.pauseButton = ui.iconButton({
      id: 'pause',
      icon: 'pause',
      label: '暂停',
      variant: 'neutral',
      size: 88,
      shape: 'rounded',
      color: '#5a5a5f',
      textColor: '#dcdce0',
      onTap: () => this.openPause(),
    });
    let top: Node;
    if (this.mode === 'versus') {
      this.scoreLabel = ui.text(this.roundText(), { id: 'round-score', size: 46, weight: 'bold', color: COLORS.text });
      const side = (who: Who) => ui.text(`P${who + 1}`, { size: 32, weight: 'bold', color: PLAYER_COLORS[who] });
      top = ui.row({ gap: 22, align: 'center' }, [side(0), this.scoreLabel, side(1)]);
    } else {
      this.skullLabel = ui.text(String(this.shownSkulls), { id: 'skull-count', size: 32, weight: 'bold', color: COLORS.text });
      this.skullRow = ui.row({ id: 'skulls', gap: 10, align: 'center' }, [ui.icon(ART_KEYS.skull, { size: 40 }), this.skullLabel]);
      this.scoreLabel = ui.text(this.scoreText(), { id: 'score', size: 32, weight: 'bold', color: COLORS.text });
      top = ui.row({ gap: 36, align: 'center' }, [this.skullRow, this.scoreLabel]);
    }
    mountScreen(this.add(new Node({ id: 'hud' })), ui.column({ align: 'center', gap: 6, padding: [10, 24, 0, 24] }, [top, this.pauseButton]));
  }

  private roundText(): string {
    const [a, b] = this.model.roundScore;
    return `${a} : ${b}`;
  }

  private scoreText(): string {
    return `得分 ${this.model.score}`;
  }

  // ---------------------------------------------------------------- input

  private aimStart(p: Pad, a: AimInfo): void {
    p.aiming = this.model.beginDraw(p.who);
    if (!p.aiming) return;
    p.indicator.active = true;
    p.indicator.start = { x: a.startX, y: a.startY };
    p.indicator.finger = { x: a.x, y: a.y };
    p.indicator.power = 0;
  }

  private aimMove(p: Pad, a: AimInfo): void {
    if (!p.aiming) return;
    p.indicator.finger = { x: a.x, y: a.y };
    this.applyAim(p, a);
  }

  private aimRelease(p: Pad, a: AimInfo): void {
    if (!p.aiming) return;
    this.applyAim(p, a);
    p.aiming = false;
    p.indicator.active = false;
    this.model.release(p.who);
  }

  private aimCancel(p: Pad): void {
    p.aiming = false;
    p.indicator.active = false;
    this.model.cancelDraw(p.who);
  }

  /** Pull back away from the shot, like the solo game (mirrored automatically by the drag direction). */
  private applyAim(p: Pad, a: AimInfo): void {
    if (a.distance < DEAD_ZONE) {
      this.model.aim(p.human.fighter.aimAngle, 0, p.who);
      return;
    }
    this.model.aim(Math.atan2(-a.dy, -a.dx), Math.min(1, a.distance / PULL_DISTANCE), p.who);
  }

  private doJump(who: Who): void {
    if (this.halted) return;
    if (this.model.jump(who)) punch(this.pads[who]!.jump, 1.1, 0.2);
  }

  private cycleArrow(who: Who): void {
    if (this.halted || this.model.state !== 'playing') return;
    const h = this.model.human(who);
    const next = h.loadout[(h.loadout.indexOf(h.selected) + 1) % h.loadout.length];
    if (next) this.model.selectArrow(next, who);
  }

  // ---------------------------------------------------------------- per frame

  override update(): void {
    this.sync();
  }

  private sync(): void {
    const m = this.model;
    this.syncWorld();
    for (const p of this.pads) {
      const h = p.human;
      const f = h.fighter;
      p.hp.setValue(f.hp, f.maxHp);
      p.stamina.setValue(h.stamina, h.maxStamina);
      p.stamina.low = m.state === 'playing' && f.alive && h.stamina < SHOT_COST;
      const head = f.body.pos[J.head]!;
      p.tag.x = head.x;
      p.tag.y = head.y - 84;
      p.tag.visible = f.alive;
      const drawing = h.drawing && p.aiming;
      p.preview.visible = drawing;
      if (drawing) {
        const angle = f.aimAngle;
        p.preview.angle = angle;
        p.preview.speed = launchSpeed(Math.max(0.2, f.draw));
        p.preview.origin = m.muzzle(f, angle);
        p.preview.strength = f.draw >= 0.2 ? 1 : 0.4;
        p.indicator.power = f.draw;
      }
      if (p.swapImage) p.swapImage.src = ART_KEYS.arrow(h.selected);
    }
  }

  /** Fighter and platform nodes for the model's current bodies. */
  private syncWorld(): void {
    const m = this.model;
    const alive = new Set<Fighter>(m.fighters);
    for (const [f, n] of this.fighterNodes) {
      if (!alive.has(f)) {
        n.destroy();
        this.fighterNodes.delete(f);
      }
    }
    for (const f of m.fighters) {
      if (!this.fighterNodes.has(f)) this.fighterNodes.set(f, this.fighterLayer.add(new FighterNode(f, { id: f.human ? `p${f.human.who + 1}` : '' })));
    }
    const plats = new Set<Platform>(m.platforms);
    for (const [p, n] of this.platformNodes) {
      if (!plats.has(p)) {
        n.destroy();
        this.platformNodes.delete(p);
      }
    }
    for (const p of m.platforms) {
      if (this.platformNodes.has(p)) continue;
      const owner = m.humans.find((h) => h.tower === p);
      this.platformNodes.set(p, this.platformLayer.add(new PlatformNode(p, { id: owner ? `tower-p${owner.who + 1}` : '' })));
    }
  }

  // ---------------------------------------------------------------- events

  private handle(events: BattleEvent[]): void {
    for (const e of events) {
      if (this.juice.world(e)) continue;
      switch (e.type) {
        case 'draw':
          playSound('draw', { rate: this.fx.float(0.9, 1.1), volume: e.who !== null ? 0.8 : 0.35 });
          break;
        case 'shoot':
          playSound('shoot', { rate: 0.85 + 0.3 * e.power, volume: e.who !== null ? 1 : 0.6 });
          break;
        case 'hit':
          this.onHit(e);
          break;
        case 'apple':
          this.onApple(e);
          break;
        case 'heal':
          playSound('heal', { volume: 0.8 });
          this.juice.popupWorld(`+${Math.round(e.amount)}`, e.x, e.y - 60, 36, COLORS.heal, '#1d4d23');
          break;
        case 'kill':
          this.onKill(e);
          break;
        case 'arrive':
          if (e.boss) {
            playSound('boss');
            shake(this.field, 8, 0.4);
            this.juice.banner('首领来袭', COLORS.hp);
          } else playSound('arrive', { volume: 0.7 });
          break;
        case 'jump':
          playSound('jump');
          break;
        case 'land': {
          const p = this.model.human(e.who).fighter.body.pos[J.footF]!;
          spawnParticles(this.fxLayer, 'dust', { x: p.x, y: p.y, maxParticles: 10 });
          break;
        }
        case 'noStamina': {
          const bar = this.pads[e.who]!.stamina;
          playSound('deny');
          bar.flashTime = 0.3;
          shake(bar, 5, 0.25);
          this.juice.popupScreen('体力不足', bar, COLORS.labelBlue);
          break;
        }
        case 'equip':
          playSound('equip');
          if (this.pads[e.who]?.swap) punch(this.pads[e.who]!.swap!, 1.08, 0.2);
          break;
        case 'lifeLost': {
          playSound('hurt', { rate: 0.8 });
          shake(this.field, 12, 0.4);
          this.popupOver(e.who, '生命 -1', COLORS.hp);
          const f = this.model.human(e.who).fighter;
          f.body.push(J.head, -500 * f.facing, -150);
          this.cancelAim(e.who);
          break;
        }
        case 'respawn':
          playSound('revive');
          this.popupOver(e.who, '复活!', COLORS.heal);
          break;
        case 'out':
          playSound('hurt', { rate: 0.65 });
          shake(this.field, 12, 0.4);
          this.popupOver(e.who, `P${e.who + 1} 倒下了`, COLORS.hp);
          this.cancelAim(e.who);
          this.pads[e.who]!.hud.alpha = 0.45;
          break;
        case 'roundStart':
          this.onRoundStart(e.round);
          break;
        case 'roundOver':
          this.onRoundOver(e.winner);
          break;
        case 'matchOver':
          void this.onMatchOver(e.winner);
          break;
        case 'gameover':
          void this.onGameOver();
          break;
      }
    }
  }

  private onHit(e: Extract<BattleEvent, { type: 'hit' }>): void {
    const fx = this.juice;
    if (e.corpse) {
      playSound('hit', { volume: 0.4, pitchJitter: 1 });
      fx.sparks(e.x, e.y, 6, [COLORS.spark]);
      return;
    }
    fx.sparks(e.x, e.y, e.head ? 18 : 11, [COLORS.spark, COLORS.spark, '#ffd27a']);
    if (e.armor > 0) playSound('clank', { pitchJitter: 1 });
    const dmg = Math.max(1, Math.round(e.damage));
    if (e.who === null) {
      playSound(e.head ? 'headshot' : 'hit', { pitchJitter: 1 });
      fx.popupWorld(`-${dmg}`, e.x, e.y - 30, e.head ? 44 : 36, '#ffffff', '#b45309');
      if (e.head) fx.popupWorld('爆头!', e.x, e.y - 90, 46, '#ffe066', '#c2410c');
      if (e.boss || e.head) shake(this.field, e.head ? 6 : 4, 0.18);
      return;
    }
    playSound(e.head ? 'headshot' : 'hurt', { pitchJitter: 1 });
    this.pads[e.who]!.hp.flashTime = 0.25;
    fx.popupWorld(`-${dmg}`, e.x, e.y - 30, e.head ? 44 : 36, '#ff8a8a', '#7f1d1d');
    if (e.head) fx.popupWorld('爆头!', e.x, e.y - 90, 44, '#ffe066', '#c2410c');
    shake(this.field, e.head ? 10 : 6, 0.25);
  }

  private onApple(e: Extract<BattleEvent, { type: 'apple' }>): void {
    playSound('apple');
    this.juice.appleBurst(e.kind, e.x, e.y);
    const parts = [e.hp > 0 ? `生命 +${Math.round(e.hp)}` : '', e.stamina > 0 ? `体力 +${Math.round(e.stamina)}` : ''].filter(Boolean);
    if (parts.length > 0) this.juice.popupWorld(parts.join('  '), e.x, e.y - 40, 32, '#ffffff', e.kind === 'green' ? '#2d6a1f' : '#9b2c2c');
    if (e.stamina > 0) this.pads[e.who]!.stamina.flashTime = 0.2;
  }

  private onKill(e: Extract<BattleEvent, { type: 'kill' }>): void {
    playSound('kill');
    addSkulls(e.reward);
    this.scoreLabel.text = this.scoreText();
    punch(this.scoreLabel, 1.15, 0.25);
    if (e.boss) {
      shake(this.field, 16, 0.5);
      this.juice.popupWorld('击败首领!', e.x, e.y - 120, 52, '#ffe066', '#9a3412');
    }
    this.juice.flySkulls(e.reward, e.x, e.y, this.skullRow?.children[0], () => {
      this.shownSkulls += e.reward;
      if (this.skullLabel) this.skullLabel.text = String(this.shownSkulls);
      if (this.skullRow) punch(this.skullRow, 1.2, 0.25);
      playSound('coin');
    });
  }

  private onRoundStart(round: number): void {
    this.scoreLabel.text = this.roundText();
    playSound('arrive', { volume: 0.7 });
    this.juice.banner(`第${round}回合`, '#3b3b3d', { id: 'round-banner', hold: 1.1 });
  }

  private onRoundOver(winner: Who): void {
    for (const p of this.pads) this.cancelAim(p.who);
    this.scoreLabel.text = this.roundText();
    punch(this.scoreLabel, 1.25, 0.3);
    playSound('kill');
    shake(this.field, 12, 0.4);
    this.juice.banner(`P${winner + 1} 胜利`, PLAYER_COLORS[winner], { id: 'winner-banner', hold: 1.3 });
  }

  private popupOver(who: Who, text: string, color: string): void {
    const h = this.model.human(who).fighter.body.pos[J.head]!;
    this.juice.popupWorld(text, h.x, h.y - 60, 44, color, '#1f1f22');
  }

  private cancelAim(who: Who): void {
    const p = this.pads[who];
    if (p?.aiming) this.aimCancel(p);
  }

  // ---------------------------------------------------------------- pause / end

  private openPause(): void {
    if (this.halted || this.model.state !== 'playing') return;
    playSound('click');
    this.halted = true;
    for (const p of this.pads) this.cancelAim(p.who);
    const modal = showModal({ id: 'duo-pause', title: '暂停', closeButton: false, closeOnBackdrop: false }, [
      ui.row({ justify: 'between', align: 'center', width: 440 }, [
        ui.text('音效', { variant: 'body' }),
        ui.toggle({ id: 'sfx-toggle', value: !isAudioMuted('sfx'), onChange: (on) => setAudioMuted('sfx', !on) }),
      ]),
      ui.row({ justify: 'between', align: 'center', width: 440 }, [
        ui.text('音乐', { variant: 'body' }),
        ui.toggle({ id: 'music-toggle', value: !isAudioMuted('music'), onChange: (on) => setAudioMuted('music', !on) }),
      ]),
      ui.row({ gap: 'md', justify: 'center', width: 440 }, [
        ui.button({ id: 'quit', text: '返回菜单', variant: 'danger', grow: 1, basis: 0, onTap: () => modal.close('quit') }),
        ui.button({ id: 'resume', text: '继续', variant: 'success', grow: 1, basis: 0, onTap: () => modal.close('resume') }),
      ]),
    ]);
    void modal.closed.then((r) => {
      playSound('click');
      if (r === 'quit') {
        this.leave();
        return;
      }
      this.halted = false;
    });
  }

  private async onMatchOver(winner: Who): Promise<void> {
    this.pauseButton.visible = false;
    stopSong(600);
    await wait(1.6, { owner: this });
    playSound('record');
    const [a, b] = this.model.roundScore;
    await this.endDialog('对战结束', [
      ui.text(`P${winner + 1} 获胜!`, { id: 'duo-winner', variant: 'h2', align: 'center', color: PLAYER_COLORS[winner] }),
      ui.text(`比分 ${a} : ${b}`, { id: 'duo-final', variant: 'body', align: 'center' }),
    ]);
  }

  /** Co-op: both archers are out. Skulls were banked on every kill; co-op runs stay off the solo leaderboard. */
  private async onGameOver(): Promise<void> {
    for (const p of this.pads) this.cancelAim(p.who);
    this.pauseButton.visible = false;
    stopSong(600);
    playSound('gameover');
    archerSave().flush();
    await wait(1.2, { owner: this });
    await this.endDialog('游戏结束', [
      ui.text(`合作得分 ${this.model.score}`, { id: 'final-score', variant: 'h2', align: 'center' }),
      ui.row({ gap: 'xs', justify: 'center', align: 'center' }, [
        ui.icon(ART_KEYS.skull, { size: 36 }),
        ui.text(`获得骷髅币 ${this.model.skullsEarned}`, { id: 'final-skulls', variant: 'body' }),
      ]),
    ]);
  }

  /** Match / game end: 再来一局 restarts the same mode, 返回 goes back to the start menu. */
  private async endDialog(title: string, body: Node[]): Promise<void> {
    const dialog = showDialog(
      {
        id: 'duo-over',
        title,
        closeOnBackdrop: false,
        maxWidth: 640,
        buttons: [
          { id: 'again', text: '再来一局', action: 'again', variant: 'primary' },
          { id: 'back', text: '返回', action: 'back', variant: 'success' },
        ],
      },
      [ui.column({ gap: 'xs', align: 'center' }, body)],
    );
    const r = await dialog.closed;
    playSound('click');
    if (r === 'again') void this.game.scenes.restart({ transition: 'fade', duration: 0.3 });
    else this.leave();
  }

  private leave(): void {
    archerSave().flush();
    void this.game.scenes.go('play', undefined, { transition: 'fade' });
  }
}
