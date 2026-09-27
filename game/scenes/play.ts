import {
  canShowAd,
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
  Scene,
  setAudioMuted,
  shake,
  showDialog,
  showModal,
  showRewardedAd,
  showToast,
  spawnParticles,
  stopSong,
  Text,
  tween,
  ui,
  wait,
  type Label,
} from '@engine';
import { FruitNode, type FruitFace } from '../art/fruit-art';
import { FRUITS, JAR_WIDTH, MAX_LEVEL, fruit } from '../fruits';
import { SuikaModel, type SuikaEvent } from '../model';
import type { FruitBody } from '../physics';
import { suikaSave } from '../save';
import { AimGuide, Backdrop, DangerLine, Ring } from './play-view';

/** Jar-local y of the danger line. */
const DANGER_Y = 210;
const HUD_H = 190;
const FLOOR_BAND = 64;
const MAX_JAR_H = 1150;

export interface PlayParams {
  seed?: number;
}

/** The game: jar, dropper, HUD, merge effects, pause and game over. */
export class PlayScene extends Scene {
  model!: SuikaModel;
  private jar!: Node;
  private fruitLayer!: Node;
  private fxLayer!: Node;
  private guide!: AimGuide;
  private line!: DangerLine;
  private held: FruitNode | null = null;
  private readonly nodes = new Map<FruitBody, FruitNode>();
  private readonly happyUntil = new Map<FruitBody, number>();
  private readonly surprisedUntil = new Map<FruitBody, number>();
  private scoreLabel!: Label;
  private bestLabel!: Label;
  private nextSlot!: Node;
  private nextFruit: FruitNode | null = null;
  private aiming = false;
  private halted = false;
  private revived = false;
  private best = 0;
  private time = 0;
  private warnTimer = 0;

  override get kind(): string {
    return 'PlayScene';
  }

  override onEnter(params?: PlayParams): void {
    const g = this.game;
    const save = suikaSave();
    this.best = save.data.best;
    const safe = g.safe;
    const floorY = safe.y + safe.h - FLOOR_BAND;
    let jarTop = safe.y + HUD_H;
    if (floorY - jarTop > MAX_JAR_H) jarTop = floorY - MAX_JAR_H;
    const jarH = floorY - jarTop;
    const jarX = Math.round((this.width - JAR_WIDTH) / 2);
    const seed = params?.seed ?? ((Math.floor(platform().now()) ^ (save.data.games * 7919)) >>> 0);
    this.model = new SuikaModel({ width: JAR_WIDTH, height: jarH, dangerY: DANGER_Y, seed });

    const backdrop = this.add(new Backdrop({ id: 'backdrop', width: this.width, height: this.height }));
    backdrop.jar = { x: jarX, y: jarTop, w: JAR_WIDTH, h: jarH };

    const zone = this.add(new Node({ id: 'touch-zone', x: 0, y: jarTop - 120, width: this.width, height: this.height - jarTop + 120 }));
    zone.tags.add('lint-surface');

    this.jar = this.add(new Node({ id: 'jar', x: jarX, y: jarTop, width: JAR_WIDTH, height: jarH }));
    onAim(
      zone,
      {
        start: (a) => {
          this.aiming = true;
          this.model.setAim(a.x);
        },
        move: (a) => this.model.setAim(a.x),
        release: (a) => {
          this.aiming = false;
          this.model.setAim(a.x);
          this.model.drop();
        },
        cancel: () => {
          this.aiming = false;
        },
      },
      { space: this.jar, enabled: () => !this.halted && this.model.state === 'playing' },
    );
    fixedUpdate(this, 60, (step) => {
      if (!this.halted) this.handle(this.model.step(step));
    });
    this.line = this.jar.add(new DangerLine(JAR_WIDTH, { id: 'danger-line', y: DANGER_Y - 4 }));
    this.guide = this.jar.add(new AimGuide({ id: 'guide' }));
    this.fruitLayer = this.jar.add(new Node({ id: 'fruits' }));
    this.fxLayer = this.jar.add(new Node({ id: 'fx' }));

    this.buildHud();
    this.showHeld();
    this.updateNext();
    playSong('bgm', { fadeMs: 1200 });
  }

  override onExit(): void {
    suikaSave().flush();
  }

  // ---------------------------------------------------------------- HUD

  private buildHud(): void {
    this.scoreLabel = ui.text('0', { id: 'score', variant: 'title', size: 76, stroke: { color: '#b4541d', width: 12 } });
    this.bestLabel = ui.text(`最高分 ${this.best}`, { id: 'best', variant: 'h2', size: 28, color: '#8a4a1f' });
    this.nextSlot = new Node({ width: 96, height: 96 });
    const hud = ui.row({ justify: 'between', align: 'start', padding: [20, 28, 0, 28] }, [
      ui.column({ gap: 0, align: 'start' }, [this.scoreLabel, this.bestLabel]),
      ui.row({ gap: 'md', align: 'center' }, [
        ui.column({ align: 'center', gap: 2 }, [
          ui.text('下一个', { variant: 'caption', size: 22, color: '#8a4a1f' }),
          ui.panel({ id: 'next', width: 112, height: 112, radius: 'full', padding: 8, align: 'center', justify: 'center', fill: 'rgba(255,255,255,0.7)' }, [
            ui.node(this.nextSlot, { width: 96, height: 96 }),
          ]),
        ]),
        ui.iconButton({ id: 'pause', icon: 'pause', label: '暂停', variant: 'primary', onTap: () => this.openPause() }),
      ]),
    ]);
    mountScreen(this.add(new Node({ id: 'hud', width: this.width, height: this.height })), hud);
  }

  private updateNext(): void {
    this.nextFruit?.destroy();
    const level = this.model.next;
    const n = new FruitNode(level, { x: 48, y: 48 });
    n.radius = 20 + (level / 4) * 24;
    this.nextFruit = this.nextSlot.add(n);
    popIn(n, 0.3);
  }

  private setScore(): void {
    this.scoreLabel.text = String(this.model.score);
    punch(this.scoreLabel, 1.12, 0.2);
    if (this.model.score > this.best) this.bestLabel.text = `最高分 ${this.model.score}`;
  }

  // ---------------------------------------------------------------- simulation

  override update(dt: number): void {
    this.time += dt;
    this.sync(dt);
  }

  private handle(events: SuikaEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'drop': {
          const n = this.held ?? this.fruitLayer.add(new FruitNode(e.body.level));
          this.held = null;
          if (n.parent !== this.fruitLayer) this.fruitLayer.add(n);
          this.nodes.set(e.body, n);
          playSound('drop');
          break;
        }
        case 'spawn':
          this.showHeld();
          this.updateNext();
          playSound('spawn', { volume: 0.6 });
          break;
        case 'merge':
          this.onMerge(e);
          break;
        case 'impact':
          this.nodes.get(e.body)?.squash(Math.min(1, (e.strength - 300) / 1000));
          if (e.strength > 900) this.surprisedUntil.set(e.body, this.time + 0.3);
          break;
        case 'danger':
          break;
        case 'gameover':
          void this.onGameOver();
          break;
      }
    }
  }

  private showHeld(): void {
    const level = this.model.current;
    if (level === null || this.held) return;
    const n = this.jar.add(new FruitNode(level, { id: 'held', x: this.model.aimX, y: this.model.dropperY(level) }));
    n.zIndex = 5;
    this.held = n;
    popIn(n, 0.25);
  }

  private sync(dt: number): void {
    const m = this.model;
    const over = m.state === 'over';
    const danger = new Set(m.dangerTime > 0 ? m.bodiesOverLine() : []);
    for (const [body, n] of this.nodes) {
      n.x = body.x;
      n.y = body.y;
      n.rotation = body.angle;
      n.radius = body.r;
      let face: FruitFace = 'idle';
      if (over) face = 'worried';
      else if ((this.happyUntil.get(body) ?? 0) > this.time) face = 'happy';
      else if (danger.has(body)) face = 'worried';
      else if (!body.landed || (this.surprisedUntil.get(body) ?? 0) > this.time) face = 'surprised';
      n.face = face;
    }
    const held = this.held;
    if (held && m.current !== null) {
      held.x = m.aimX;
      held.y = m.dropperY(m.current);
      const top = held.y + fruit(m.current).radius;
      this.guide.visible = true;
      this.guide.x = m.aimX;
      this.guide.y = top + 10;
      this.guide.height = Math.max(0, this.jar.height - top - 10);
      this.guide.strength = this.aiming ? 1 : 0.35;
    } else {
      this.guide.visible = false;
    }
    if (m.dangerTime > 0 && !over) {
      this.line.alert = 0.5 + 0.5 * Math.sin(this.time * 14);
      this.warnTimer -= dt;
      if (this.warnTimer <= 0) {
        this.warnTimer = 0.5;
        playSound('warning', { volume: 0.7 });
      }
    } else {
      this.line.alert = over ? 1 : 0;
      this.warnTimer = 0;
    }
  }

  // ---------------------------------------------------------------- merges

  private onMerge(e: Extract<SuikaEvent, { type: 'merge' }>): void {
    for (const b of [e.a, e.b]) {
      this.nodes.get(b)?.destroy();
      this.nodes.delete(b);
      this.happyUntil.delete(b);
      this.surprisedUntil.delete(b);
    }
    const shown = fruit(Math.min(e.level, MAX_LEVEL));
    if (e.into) {
      const n = this.fruitLayer.add(new FruitNode(e.into.level, { x: e.x, y: e.y }));
      n.radius = e.into.r;
      n.squash(0.8);
      this.nodes.set(e.into, n);
      this.happyUntil.set(e.into, this.time + 0.7);
    }
    this.splash(e.x, e.y, e.level);
    this.popup(`+${e.points}`, e.x, e.y - shown.radius * 0.3, 34 + Math.min(24, e.level * 3), '#ffffff', '#d9480f');
    if (e.combo >= 2) {
      this.popup(`连击 ×${e.combo}`, e.x, e.y - shown.radius * 0.3 - 56, 34, '#fff3b0', '#b45309');
      playSound('combo', { rate: Math.min(1.5, 1 + 0.08 * (e.combo - 2)) });
    }
    playSound('merge', { rate: 1.25 - Math.min(e.level, 10) * 0.05 });
    if (e.level >= 7) playSound('merge-big');
    if (e.level >= 8) shake(this.jar, 6 + e.level, 0.35);
    if (e.level === MAX_LEVEL) this.celebrate();
    this.setScore();
  }

  private splash(x: number, y: number, level: number): void {
    const f = fruit(Math.min(level, MAX_LEVEL));
    const r = f.radius;
    spawnParticles(
      this.fxLayer,
      {
        bursts: [{ count: 12 + Math.min(level, 10) * 2 }],
        maxParticles: 48,
        shape: 'circle',
        radial: true,
        spawn: { type: 'circle', radius: r * 0.55 },
        speed: [160 + r * 2, 360 + r * 4],
        drag: 3.2,
        gravity: 1100,
        lifetime: [0.35, 0.75],
        size: [8 + r * 0.14, 14 + r * 0.26],
        scaleEnd: 0.15,
        colors: [f.juice, f.color, '#ffffff'],
        alpha: [
          [0, 1],
          [0.7, 0.9],
          [1, 0],
        ],
      },
      { x, y },
    );
    const ring = this.fxLayer.add(new Ring(r * 0.7, r * 1.45, 'rgba(255,255,255,0.9)', { x, y }));
    tween(ring, { progress: 1 }, 0.4, { ease: 'linear', onComplete: () => ring.destroy() });
  }

  private popup(text: string, x: number, y: number, size: number, color: string, stroke: string): void {
    x = Math.min(JAR_WIDTH - 90, Math.max(90, x));
    const t = this.fxLayer.add(
      new Text(text, { fontSize: size, fontWeight: 'bold', color, stroke: { color: stroke, width: 7 } }, { x, y, anchor: 0.5 }),
    );
    t.zIndex = 10;
    popIn(t, 0.2);
    tween(t, { y: y - 90, alpha: 0 }, 0.9, { delay: 0.25, ease: 'quadIn', onComplete: () => t.destroy() });
  }

  private celebrate(): void {
    const save = suikaSave();
    save.set({ watermelons: save.data.watermelons + 1 });
    playSound('watermelon');
    spawnParticles(this.fxLayer, 'confetti', { x: JAR_WIDTH / 2, y: DANGER_Y });
    const t = this.fxLayer.add(
      new Text('合成大西瓜！', { fontSize: 88, fontWeight: 'bold', color: '#ffffff', stroke: { color: '#2f9e44', width: 14 } }, {
        x: JAR_WIDTH / 2,
        y: this.jar.height * 0.38,
        anchor: 0.5,
      }),
    );
    t.zIndex = 20;
    popIn(t, 0.45);
    tween(t, { alpha: 0 }, 0.5, { delay: 1.6, onComplete: () => t.destroy() });
    shake(this, 16, 0.5);
  }

  // ---------------------------------------------------------------- pause / game over

  private openPause(): void {
    if (this.halted || this.model.state !== 'playing') return;
    playSound('click');
    this.halted = true;
    const modal = showModal({ title: '暂停', closeButton: false, closeOnBackdrop: false }, [
      ui.row({ justify: 'between', align: 'center', width: 440 }, [
        ui.text('音效', { variant: 'body' }),
        ui.toggle({ id: 'sfx-toggle', value: !isAudioMuted('sfx'), onChange: (on) => setAudioMuted('sfx', !on) }),
      ]),
      ui.row({ justify: 'between', align: 'center', width: 440 }, [
        ui.text('音乐', { variant: 'body' }),
        ui.toggle({ id: 'music-toggle', value: !isAudioMuted('music'), onChange: (on) => setAudioMuted('music', !on) }),
      ]),
      ui.button({ id: 'resume', text: '继续游戏', variant: 'success', size: 'lg', width: 440, onTap: () => modal.close('resume') }),
      ui.button({ id: 'restart', text: '重新开始', variant: 'secondary', size: 'lg', width: 440, onTap: () => modal.close('restart') }),
    ]);
    void modal.closed.then((r) => {
      playSound('click');
      if (r === 'restart') this.restart();
      else this.halted = false;
    });
  }

  private restart(): void {
    void this.game.scenes.restart({ transition: 'fade', duration: 0.3 });
  }

  private async onGameOver(): Promise<void> {
    stopSong(600);
    playSound('gameover');
    this.held?.destroy();
    this.held = null;
    const save = suikaSave();
    const score = this.model.score;
    const record = score > save.data.best;
    save.set({ best: Math.max(score, save.data.best), games: save.data.games + (this.revived ? 0 : 1) });
    save.flush();
    await wait(1.2, { owner: this });
    if (record && score > 0) playSound('record');
    const canRevive = !this.revived && canShowAd('rewarded');
    const buttons = [
      ...(canRevive ? [{ id: 'revive', text: '看广告复活', action: 'revive', variant: 'secondary' as const, icon: 'play' }] : []),
      { id: 'again', text: '再来一局', action: 'again', variant: 'success' as const },
    ];
    const dialog = showDialog({ title: '游戏结束', buttons, vertical: true, closeOnBackdrop: false }, [
      ui.text(String(score), { id: 'final-score', variant: 'title', size: 96, align: 'center', stroke: { color: '#b4541d', width: 12 } }),
      ui.text(record && score > 0 ? '新纪录！' : `最高分 ${save.data.best}`, {
        id: 'final-best',
        variant: 'h2',
        align: 'center',
        color: record && score > 0 ? '#e8590c' : 'textDim',
      }),
      ui.text(`最大水果：${FRUITS[this.model.bestLevel]!.name}`, { variant: 'body', align: 'center', color: 'textDim' }),
    ]);
    const r = await dialog.closed;
    playSound('click');
    if (r === 'revive') {
      if (await showRewardedAd('rewarded')) {
        this.revive();
        return;
      }
      showToast('广告未看完，无法复活');
    }
    this.restart();
  }

  private revive(): void {
    this.revived = true;
    for (const b of this.model.revive()) {
      const n = this.nodes.get(b);
      if (n) {
        this.splash(b.x, b.y, b.level);
        n.destroy();
      }
      this.nodes.delete(b);
    }
    playSong('bgm', { fadeMs: 800 });
    this.showHeld();
  }
}
