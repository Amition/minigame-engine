import {
  canShowAd,
  createInputActions,
  fixedUpdate,
  isAudioMuted,
  mountScreen,
  Node,
  onAim,
  platform,
  playSong,
  playSound,
  popIn,
  punch,
  Rng,
  Scene,
  setAudioMuted,
  shake,
  showDialog,
  showModal,
  showRewardedAd,
  showToast,
  spawnParticles,
  Sprite,
  stopSong,
  Text,
  tween,
  ui,
  wait,
  type AimInfo,
  type Label,
  type Rect,
} from '@engine';
import { ART_KEYS } from '../art/index';
import { arrowDef, COLORS, JUMP_COST, SHOT_COST, type ArrowId } from '../config';
import { screenLayout, TOWER_TOP, TOWER_X, type ScreenLayout } from '../layout';
import { BattleModel, launchSpeed, TOWER_W, type BattleEvent, type Fighter, type Platform } from '../model';
import { addSkulls, archerSave, currentStats, loadout, recordRun, trials } from '../save';
import { J } from '../types';
import {
  AimIndicator,
  AppleLayer,
  ArrowLayer,
  Backdrop,
  ExplosionNode,
  FighterNode,
  LightningNode,
  PlatformNode,
  StatBar,
  TrajectoryPreview,
} from './battle-view';
import { mountMenu, type MenuHandle } from './menu';

export interface PlayParams {
  seed?: number;
}

/** Drag distance (scene units) for a full pull. */
const PULL_DISTANCE = 220;
const DEAD_ZONE = 10;
const TOWER_HUD_W = 150;
const SWITCH_W = 132;
const SWITCH_H = 88;

/** The battle: live ragdoll duel under the start menu, aiming, HUD, juice, pause and game over. */
export class PlayScene extends Scene {
  model!: BattleModel;
  menu: MenuHandle | null = null;
  private layout!: ScreenLayout;
  private backdrop!: Backdrop;
  private field!: Node;
  private platformLayer!: Node;
  private fighterLayer!: Node;
  private fxLayer!: Node;
  private preview!: TrajectoryPreview;
  private zone!: Node;
  private indicator!: AimIndicator;
  private fxScreen!: Node;
  private towerHud!: Node;
  private switcher!: Node;
  private hpBar!: StatBar;
  private staminaBar!: StatBar;
  private skullRow!: Node;
  private skullLabel!: Label;
  private scoreLabel!: Label;
  private pauseButton!: Node;
  private readonly fighterNodes = new Map<Fighter, FighterNode>();
  private readonly platformNodes = new Map<Platform, PlatformNode>();
  private readonly fx = new Rng(7);
  private aiming = false;
  private halted = false;
  private revived = false;
  private forfeited = false;
  private recorded = false;
  private best = 0;
  private shownSkulls = 0;
  private switcherKey = '';

  override get kind(): string {
    return 'PlayScene';
  }

  override onEnter(params?: PlayParams): void {
    const save = archerSave();
    this.best = save.data.best;
    this.shownSkulls = save.data.skulls;
    const seed = params?.seed ?? ((Math.floor(platform().now()) ^ (save.data.games * 7919)) >>> 0);
    this.model = new BattleModel({ seed, stats: currentStats(), loadout: loadout() });
    this.layout = screenLayout(this.game.view, this.game.safe);

    this.backdrop = this.add(new Backdrop({ id: 'backdrop' }));
    this.field = this.add(new Node({ id: 'field', tags: ['lint-ignore'] }));
    this.platformLayer = this.field.add(new Node({ id: 'platforms' }));
    this.field.add(new AppleLayer(() => this.model.apples, { id: 'apples' }));
    this.fighterLayer = this.field.add(new Node({ id: 'fighters' }));
    this.field.add(new ArrowLayer(() => this.model.arrows, { id: 'arrows' }));
    this.preview = this.field.add(new TrajectoryPreview({ id: 'trajectory', visible: false }));
    this.fxLayer = this.field.add(new Node({ id: 'fx' }));

    this.zone = this.add(new Node({ id: 'aim-zone', tags: ['lint-surface'] }));
    this.buildTowerHud();
    this.buildHud();
    this.switcher = this.add(new Node({ id: 'switcher-layer' }));
    this.indicator = this.add(new AimIndicator({ id: 'aim-indicator' }));
    this.fxScreen = this.add(new Node({ id: 'fx-screen' }));
    this.relayout();
    this.sync();

    onAim(
      this.zone,
      {
        start: (a) => this.aimStart(a),
        move: (a) => this.aimMove(a),
        release: (a) => this.aimRelease(a),
        cancel: () => this.aimCancel(),
      },
      { space: this, enabled: () => !this.halted && this.model.state !== 'over' },
    );
    const input = createInputActions(this, {
      jump: ['Space', 'PadA'],
      arrow1: ['Digit1'],
      arrow2: ['Digit2'],
      arrow3: ['Digit3'],
      arrow4: ['Digit4'],
      arrow5: ['Digit5'],
    });
    input.bindHold('jump', this.find('#jump')!);
    input.onPress('jump', () => this.doJump(), this);
    for (let i = 1; i <= 5; i++) {
      input.onPress(`arrow${i}` as 'arrow1', () => this.pickArrow(this.model.loadout[i - 1]), this);
    }

    fixedUpdate(this, 60, (step) => {
      if (!this.halted) this.handle(this.model.step(step));
    });

    const { zone, hudBottom } = this.layout;
    this.menu = mountMenu(this, { zone, hudBottom, onChange: () => this.onMenuChange() });
    playSong('menu', { fadeMs: 800 });
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
    const { field, zone } = this.layout;
    this.backdrop.width = this.width;
    this.backdrop.height = this.height;
    this.field.x = field.x;
    this.field.y = field.y;
    this.field.scaleX = this.field.scaleY = field.scale;
    this.zone.x = zone.x;
    this.zone.y = zone.y;
    this.zone.width = zone.w;
    this.zone.height = zone.h;
  }

  /** Tower face below the player, scene coordinates. */
  private towerRect(): Rect {
    const { field } = this.layout;
    const cx = field.x + TOWER_X * field.scale;
    const top = field.y + TOWER_TOP * field.scale;
    const w = Math.max(TOWER_HUD_W, TOWER_W * field.scale - 20);
    const bottom = Math.min(this.game.safe.y + this.game.safe.h, this.height) - 8;
    return { x: cx - w / 2, y: top + 18, w, h: Math.max(160, bottom - top - 18) };
  }

  /** Arrow switcher strip: right of the operation zone, along the top. */
  private switcherRect(): Rect {
    const safe = this.game.safe;
    const x = this.layout.zone.x + this.layout.zone.w + 16;
    const right = safe.x + safe.w - 280;
    return { x, y: safe.y + 10, w: Math.max(SWITCH_W, right - x), h: SWITCH_H + 8 };
  }

  private buildHud(): void {
    this.skullLabel = ui.text(String(this.shownSkulls), { id: 'skull-count', size: 32, weight: 'bold', color: COLORS.text });
    this.skullRow = ui.row({ id: 'skulls', gap: 10, align: 'center' }, [ui.icon(ART_KEYS.skull, { size: 40 }), this.skullLabel]);
    this.scoreLabel = ui.text(this.scoreText(), { id: 'score', size: 32, weight: 'bold', color: COLORS.text });
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
    this.pauseButton.visible = false;
    const hud = ui.column({ justify: 'between', padding: [10, 24, 16, 24] }, [
      ui.row({ justify: 'between', align: 'center' }, [this.skullRow, this.scoreLabel]),
      ui.row({ justify: 'end' }, [this.pauseButton]),
    ]);
    mountScreen(this.add(new Node({ id: 'hud' })), hud);
  }

  private buildTowerHud(): void {
    this.hpBar = new StatBar(COLORS.hp, { id: 'hp-bar' });
    this.staminaBar = new StatBar(COLORS.stamina, { id: 'stamina-bar' });
    const jump = ui.view(
      { id: 'jump', width: 124, height: 72, radius: 14, fill: COLORS.button, align: 'center', justify: 'center', lintRole: 'control', hitPadding: 10, interactive: true },
      [
        ui.text('跳', { size: 28, weight: 'bold', color: COLORS.buttonText, align: 'center' }),
        ui.text(`${JUMP_COST} 体力`, { size: 20, weight: 'bold', color: '#2563eb', align: 'center' }),
      ],
    );
    this.towerHud = this.add(new Node({ id: 'tower-hud' }));
    mountScreen(
      this.towerHud,
      ui.column({ align: 'center', gap: 8 }, [
        ui.node(this.hpBar, { width: 120, height: 26 }),
        ui.node(this.staminaBar, { width: 120, height: 26 }),
        ui.spacer(4),
        jump,
      ]),
      { area: () => this.towerRect() },
    );
  }

  private rebuildSwitcher(): void {
    const list = this.model.loadout;
    const show = this.model.state === 'playing' && list.length > 1;
    const key = show ? `${list.join(',')}|${this.model.selected}` : '';
    if (key === this.switcherKey) return;
    this.switcherKey = key;
    if (!show) {
      this.switcher.removeChildren();
      return;
    }
    const buttons = list.map((id) => {
      const on = id === this.model.selected;
      return ui.view(
        {
          id: `switch-${id}`,
          width: SWITCH_W,
          height: SWITCH_H,
          radius: 14,
          fill: on ? COLORS.cardTrial : COLORS.card,
          border: on ? { color: '#ffffff', width: 4 } : { color: COLORS.cardLocked, width: 2 },
          align: 'center',
          justify: 'center',
          lintRole: 'control',
          onTap: () => this.pickArrow(id),
          data: { arrow: id },
        },
        [ui.image(ART_KEYS.arrow(id), { width: SWITCH_W - 16, height: Math.round(((SWITCH_W - 16) * 56) / 300) })],
      );
    });
    mountScreen(this.switcher, ui.row({ gap: 8, align: 'start', justify: 'start' }, buttons), { area: () => this.switcherRect() });
  }

  private scoreText(): string {
    const score = this.model?.score ?? 0;
    return `得分 ${score}/${Math.max(this.best, score)}`;
  }

  private onMenuChange(): void {
    this.model.setLoadout(currentStats(), loadout());
    this.shownSkulls = archerSave().data.skulls;
    this.skullLabel.text = String(this.shownSkulls);
  }

  // ---------------------------------------------------------------- input

  private aimStart(a: AimInfo): void {
    this.aiming = this.model.beginDraw();
    if (!this.aiming) return;
    this.indicator.active = true;
    this.indicator.start = { x: a.startX, y: a.startY };
    this.indicator.finger = { x: a.x, y: a.y };
    this.indicator.power = 0;
  }

  private aimMove(a: AimInfo): void {
    if (!this.aiming) return;
    this.indicator.finger = { x: a.x, y: a.y };
    this.applyAim(a);
  }

  private aimRelease(a: AimInfo): void {
    if (!this.aiming) return;
    this.applyAim(a);
    this.aiming = false;
    this.indicator.active = false;
    this.model.release();
  }

  private aimCancel(): void {
    this.aiming = false;
    this.indicator.active = false;
    this.model.cancelDraw();
  }

  private applyAim(a: AimInfo): void {
    if (a.distance < DEAD_ZONE) {
      this.model.aim(this.model.player.aimAngle, 0);
      return;
    }
    this.model.aim(Math.atan2(-a.dy, -a.dx), Math.min(1, a.distance / PULL_DISTANCE));
  }

  private doJump(): void {
    if (this.halted) return;
    if (this.model.jump()) {
      const jump = this.find('#jump');
      if (jump) punch(jump, 1.1, 0.2);
    }
  }

  private pickArrow(id: ArrowId | undefined): void {
    if (!id || this.halted || this.model.state !== 'playing') return;
    this.model.selectArrow(id);
  }

  // ---------------------------------------------------------------- per frame

  override update(): void {
    this.sync();
  }

  private sync(): void {
    const m = this.model;
    const alive = new Set<Fighter>(m.fighters);
    for (const [f, n] of this.fighterNodes) {
      if (!alive.has(f)) {
        n.destroy();
        this.fighterNodes.delete(f);
      }
    }
    for (const f of m.fighters) {
      if (!this.fighterNodes.has(f)) this.fighterNodes.set(f, this.fighterLayer.add(new FighterNode(f, { id: f.side === 'player' ? 'player' : '' })));
    }
    const plats = new Set<Platform>(m.platforms);
    for (const [p, n] of this.platformNodes) {
      if (!plats.has(p)) {
        n.destroy();
        this.platformNodes.delete(p);
      }
    }
    for (const p of m.platforms) {
      if (!this.platformNodes.has(p)) this.platformNodes.set(p, this.platformLayer.add(new PlatformNode(p, { id: p.kind === 'tower' ? 'tower' : '' })));
    }

    this.hpBar.setValue(m.hp, m.maxHp);
    this.staminaBar.setValue(m.stamina, m.maxStamina);
    this.staminaBar.low = m.state === 'playing' && m.stamina < SHOT_COST;

    const drawing = m.drawing && this.aiming;
    this.preview.visible = drawing;
    if (drawing) {
      const angle = m.player.aimAngle;
      this.preview.angle = angle;
      this.preview.speed = launchSpeed(Math.max(0.2, m.draw));
      this.preview.origin = m.muzzle(m.player, angle);
      this.preview.strength = m.draw >= 0.2 ? 1 : 0.4;
      this.indicator.power = m.draw;
    }
    this.rebuildSwitcher();
  }

  // ---------------------------------------------------------------- events

  private handle(events: BattleEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'start':
          this.onStart();
          break;
        case 'draw':
          playSound('draw', { rate: this.fx.float(0.9, 1.1), volume: e.side === 'player' ? 0.8 : 0.35 });
          break;
        case 'shoot':
          playSound('shoot', { rate: 0.85 + 0.3 * e.power, volume: e.side === 'player' ? 1 : 0.6 });
          break;
        case 'hit':
          this.onHit(e);
          break;
        case 'dot':
          this.popupWorld(`-${Math.max(1, Math.round(e.damage))}`, e.x, e.y - 40, 34, COLORS.poison, '#1f3d12');
          break;
        case 'thunk':
          playSound('thunk', { volume: 0.7, pitchJitter: 1 });
          this.sparks(e.x, e.y, 6, [COLORS.stoneLight, COLORS.dustLight]);
          break;
        case 'explode':
          this.explosion(e.x, e.y, e.radius);
          break;
        case 'zap':
          playSound('zap');
          this.fxLayer.add(new LightningNode(46, { x: e.x, y: e.y }));
          break;
        case 'poison':
          playSound('poison');
          this.sparks(e.x, e.y, 10, [COLORS.poison, '#b6f09c']);
          break;
        case 'balloon':
          playSound('balloon', { rate: 0.9 + e.count * 0.1 });
          if (e.lifted) this.popupWorld('飞走啦!', e.x, e.y - 80, 38, '#ffd166', '#7a3b00');
          break;
        case 'saw':
          playSound('saw');
          this.sparks(e.x, e.y, 14, [COLORS.spark, '#ffffff']);
          break;
        case 'split':
          playSound('shoot', { rate: 1.4, volume: 0.35 });
          break;
        case 'apple':
          this.onApple(e);
          break;
        case 'heal':
          playSound('heal', { volume: 0.8 });
          this.popupWorld(`+${Math.round(e.amount)}`, e.x, e.y - 60, 36, COLORS.heal, '#1d4d23');
          break;
        case 'kill':
          this.onKill(e);
          break;
        case 'arrive':
          this.onArrive(e.boss);
          break;
        case 'jump':
          playSound('jump');
          break;
        case 'land': {
          const p = this.model.player.body.pos[J.footF]!;
          spawnParticles(this.fxLayer, 'dust', { x: p.x, y: p.y, maxParticles: 10 });
          break;
        }
        case 'noStamina':
          playSound('deny');
          this.staminaBar.flashTime = 0.3;
          shake(this.staminaBar, 5, 0.25);
          this.popupScreen('体力不足', this.staminaBar, COLORS.labelBlue);
          break;
        case 'equip':
          playSound('equip');
          break;
        case 'lifeLost':
          playSound('hurt', { rate: 0.8 });
          shake(this.field, 12, 0.4);
          this.popupPlayer('生命 -1', COLORS.hp);
          this.model.player.body.push(J.head, -500, -150);
          break;
        case 'respawn':
          playSound('revive');
          this.popupPlayer('复活!', COLORS.heal);
          break;
        case 'gameover':
          void this.onGameOver();
          break;
        case 'revive':
          playSound('revive');
          break;
      }
    }
  }

  private onStart(): void {
    this.menu?.close();
    this.menu = null;
    this.pauseButton.visible = true;
    popIn(this.pauseButton, 0.3);
    playSong('bgm', { fadeMs: 800 });
  }

  private onHit(e: Extract<BattleEvent, { type: 'hit' }>): void {
    if (e.corpse) {
      playSound('hit', { volume: 0.4, pitchJitter: 1 });
      this.sparks(e.x, e.y, 6, [COLORS.spark]);
      return;
    }
    this.sparks(e.x, e.y, e.head ? 18 : 11, [COLORS.spark, COLORS.spark, '#ffd27a']);
    const dmg = Math.max(1, Math.round(e.damage));
    if (e.side === 'enemy') {
      playSound(e.head ? 'headshot' : 'hit', { pitchJitter: 1 });
      this.popupWorld(`-${dmg}`, e.x, e.y - 30, e.head ? 44 : 36, '#ffffff', '#b45309');
      if (e.head) this.popupWorld('爆头!', e.x, e.y - 90, 46, '#ffe066', '#c2410c');
      if (e.boss || e.head) shake(this.field, e.head ? 6 : 4, 0.18);
    } else {
      playSound('hurt');
      this.hpBar.flashTime = 0.25;
      this.popupWorld(`-${dmg}`, e.x, e.y - 30, 36, '#ff8a8a', '#7f1d1d');
      shake(this.field, e.head ? 10 : 6, 0.25);
      if (e.head) this.popupWorld('爆头!', e.x, e.y - 90, 40, '#ff8a8a', '#7f1d1d');
    }
  }

  private onApple(e: Extract<BattleEvent, { type: 'apple' }>): void {
    playSound('apple');
    spawnParticles(
      this.fxLayer,
      {
        bursts: [{ count: 16 }],
        maxParticles: 20,
        shape: 'circle',
        speed: [150, 380],
        gravity: 900,
        drag: 1.5,
        lifetime: [0.35, 0.7],
        size: [6, 12],
        colors: [e.kind === 'red' ? COLORS.hp : e.kind === 'green' ? COLORS.poison : '#f5c542', '#ffffff'],
      },
      { x: e.x, y: e.y },
    );
    const parts = [e.hp > 0 ? `生命 +${Math.round(e.hp)}` : '', e.stamina > 0 ? `体力 +${Math.round(e.stamina)}` : ''].filter(Boolean);
    if (parts.length > 0) this.popupWorld(parts.join('  '), e.x, e.y - 40, 32, '#ffffff', e.kind === 'green' ? '#2d6a1f' : '#9b2c2c');
    if (e.stamina > 0) this.staminaBar.flashTime = 0.2;
  }

  private onKill(e: Extract<BattleEvent, { type: 'kill' }>): void {
    playSound('kill');
    addSkulls(e.reward);
    this.scoreLabel.text = this.scoreText();
    punch(this.scoreLabel, 1.15, 0.25);
    if (e.boss) {
      shake(this.field, 16, 0.5);
      this.popupWorld('击败首领!', e.x, e.y - 120, 52, '#ffe066', '#9a3412');
    }
    this.flySkulls(e.reward, e.x, e.y);
  }

  private onArrive(boss: boolean): void {
    if (!boss) {
      playSound('arrive', { volume: 0.7 });
      return;
    }
    playSound('boss');
    shake(this.field, 8, 0.4);
    const t = this.fxScreen.add(
      new Text('首领来袭', { fontSize: 76, fontWeight: 'bold', color: '#ffffff', stroke: { color: COLORS.hp, width: 12 } }, {
        x: this.width / 2,
        y: this.height * 0.3,
        anchor: 0.5,
      }),
    );
    popIn(t, 0.4);
    tween(t, { alpha: 0 }, 0.5, { delay: 1.5, owner: this, onComplete: () => t.destroy() });
  }

  // ---------------------------------------------------------------- juice

  private sparks(x: number, y: number, count: number, colors: string[]): void {
    spawnParticles(
      this.fxLayer,
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

  private explosion(x: number, y: number, radius: number): void {
    playSound('explode');
    const n = this.fxLayer.add(new ExplosionNode(radius, { x, y }));
    tween(n, { progress: 1 }, 0.45, { ease: 'quadOut', owner: this, onComplete: () => n.destroy() });
    spawnParticles(this.fxLayer, 'explosion', { x, y, maxParticles: 40 });
    this.sparks(x, y, 20, [COLORS.spark, '#ffb347', '#ffffff']);
    shake(this.field, radius > 100 ? 14 : 9, 0.35);
  }

  /** Floating text in world units (inside the field). */
  private popupWorld(text: string, x: number, y: number, size: number, color: string, stroke: string): void {
    const t = this.fxLayer.add(new Text(text, { fontSize: size, fontWeight: 'bold', color, stroke: { color: stroke, width: 7 } }, { x, y, anchor: 0.5 }));
    t.zIndex = 10;
    popIn(t, 0.18);
    tween(t, { y: y - 70, alpha: 0 }, 0.8, { delay: 0.35, ease: 'quadIn', owner: this, onComplete: () => t.destroy() });
  }

  private popupPlayer(text: string, color: string): void {
    const h = this.model.player.body.pos[J.head]!;
    this.popupWorld(text, h.x, h.y - 60, 44, color, '#1f1f22');
  }

  /** Floating text next to a HUD node (scene units). */
  private popupScreen(text: string, near: Node, color: string): void {
    const c = near.worldCenter();
    const p = this.fxScreen.toLocal(c.x, c.y);
    const t = this.fxScreen.add(new Text(text, { fontSize: 28, fontWeight: 'bold', color, stroke: { color: '#111114', width: 6 } }, { x: p.x, y: p.y - 44, anchor: 0.5 }));
    popIn(t, 0.15);
    tween(t, { y: p.y - 90, alpha: 0 }, 0.7, { delay: 0.3, owner: this, onComplete: () => t.destroy() });
  }

  /** '+N' skulls flying from the kill to the counter; the counter ticks up when they land. */
  private flySkulls(reward: number, wx: number, wy: number): void {
    const from = this.field.toWorld(wx, wy);
    const to = this.skullRow.children[0]?.worldCenter() ?? { x: 60, y: 40 };
    const a = this.fxScreen.toLocal(from.x, from.y);
    const b = this.fxScreen.toLocal(to.x, to.y);
    const g = this.fxScreen.add(new Node({ x: a.x, y: a.y - 40 }));
    g.add(new Sprite(ART_KEYS.skull, { anchor: 0.5, width: 44, height: 44 }));
    g.add(new Text(`+${reward}`, { fontSize: 34, fontWeight: 'bold', color: '#ffffff', stroke: { color: '#3b3b3d', width: 6 } }, { x: 28, y: 0, anchorY: 0.5 }));
    popIn(g, 0.25);
    tween(g, { x: b.x, y: b.y, scale: 0.6 }, 0.65, {
      delay: 0.5,
      ease: 'quadIn',
      owner: this,
      onComplete: () => {
        g.destroy();
        this.shownSkulls += reward;
        this.skullLabel.text = String(this.shownSkulls);
        punch(this.skullRow, 1.2, 0.25);
        playSound('coin');
      },
    });
  }

  // ---------------------------------------------------------------- pause / game over

  private openPause(): void {
    if (this.halted || this.model.state !== 'playing') return;
    playSound('click');
    this.halted = true;
    this.aimCancel();
    const modal = showModal({ title: '暂停', closeButton: false, closeOnBackdrop: false }, [
      ui.row({ justify: 'between', align: 'center', width: 440 }, [
        ui.text('音效', { variant: 'body' }),
        ui.toggle({ id: 'sfx-toggle', value: !isAudioMuted('sfx'), onChange: (on) => setAudioMuted('sfx', !on) }),
      ]),
      ui.row({ justify: 'between', align: 'center', width: 440 }, [
        ui.text('音乐', { variant: 'body' }),
        ui.toggle({ id: 'music-toggle', value: !isAudioMuted('music'), onChange: (on) => setAudioMuted('music', !on) }),
      ]),
      ui.row({ gap: 'md', justify: 'center', width: 440 }, [
        ui.button({ id: 'quit', text: '放弃本局', variant: 'danger', grow: 1, basis: 0, onTap: () => modal.close('quit') }),
        ui.button({ id: 'resume', text: '继续', variant: 'success', grow: 1, basis: 0, onTap: () => modal.close('resume') }),
      ]),
    ]);
    void modal.closed.then((r) => {
      playSound('click');
      this.halted = false;
      if (r === 'quit') {
        this.forfeited = true;
        this.model.forfeit();
      }
    });
  }

  private async onGameOver(): Promise<void> {
    this.aimCancel();
    this.pauseButton.visible = false;
    stopSong(600);
    playSound('gameover');
    const save = archerSave();
    const score = this.model.score;
    const skulls = this.model.skullsEarned;
    const record = score > save.data.best && score > 0;
    const canRevive = !this.revived && !this.forfeited && canShowAd('rewarded');
    if (!canRevive) this.finishRun();
    await wait(1.2, { owner: this });
    if (record) playSound('record');
    const best = Math.max(save.data.best, score);
    const dialog = showDialog(
      {
        title: '游戏结束',
        closeOnBackdrop: false,
        maxWidth: canRevive ? 760 : 640,
        buttons: [
          ...(canRevive ? [{ id: 'revive', text: '看广告复活', action: 'revive', variant: 'secondary' as const, icon: 'video' }] : []),
          { id: 'back', text: '返回', action: 'back', variant: 'success' as const },
        ],
      },
      [
        ui.column({ gap: 'xs', align: 'center' }, [
          ui.text(`本局得分 ${score}`, { id: 'final-score', variant: 'h2', align: 'center' }),
          ui.text(record ? '新纪录！' : `最高 ${best}`, { id: 'final-best', variant: 'body', align: 'center', color: record ? 'gold' : 'textDim' }),
          ui.row({ gap: 'xs', justify: 'center', align: 'center' }, [
            ui.icon(ART_KEYS.skull, { size: 36 }),
            ui.text(`获得骷髅币 ${skulls}`, { id: 'final-skulls', variant: 'body' }),
          ]),
        ]),
      ],
    );
    const r = await dialog.closed;
    playSound('click');
    if (r === 'revive') {
      if (await showRewardedAd('rewarded')) {
        this.revived = true;
        this.model.revive();
        this.pauseButton.visible = true;
        playSong('bgm', { fadeMs: 800 });
        return;
      }
      showToast('广告未看完，无法复活');
    }
    this.finishRun();
    void this.game.scenes.restart({ transition: 'fade', duration: 0.3 });
  }

  /** Records the run once (leaderboard, best, games) and drops the one-run trial arrows. */
  private finishRun(): void {
    if (this.recorded) return;
    this.recorded = true;
    recordRun(this.model.score, this.model.skullsEarned);
    trials.clear();
  }

  /** Display name of the selected arrow (tests / dumps). */
  get selectedName(): string {
    return arrowDef(this.model.selected).name;
  }
}
