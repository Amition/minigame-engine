import { Rng } from '@engine';
import {
  APPLES,
  appleDef,
  arrowDef,
  damageTaken,
  JUMP_COST,
  NO_UPGRADES,
  playerStats,
  SHOT_COST,
  type AppleKind,
  type ArrowId,
  type PlayerStats,
} from './config';
import { MENU_ENEMY_TOP, MENU_ENEMY_X, TOWER_TOP, TOWER_X } from './layout';
import { fromPlatform, GRAVITY, Ragdoll, segCircle, segRect, toPlatform, type BodyHit } from './ragdoll';
import {
  BODY,
  J,
  WORLD_H,
  WORLD_W,
  type AppleView,
  type ArrowView,
  type FighterView,
  type PlatformView,
  type StuckArrowView,
  type Vec,
} from './types';

/**
 * 布偶弓箭手 battle rules (pure: no rendering, no platform, seeded Rng, fixed step). The scene feeds input
 * (beginDraw / aim / release / jump / selectArrow) and turns the events returned by step() into visuals and sounds.
 */

// ---------------------------------------------------------------- tuning

export const ARROW_GRAVITY = GRAVITY;
/** Shots below this draw are cancelled instead of fired. */
export const MIN_DRAW = 0.2;
export const MIN_SPEED = 700;
export const MAX_SPEED = 1650;
export const TOWER_W = 230;
export const TOWER_H = 1000;
export const BLOCK_SIZE = 110;
/** Block half-diagonal: the top corner is this far above the block centre. */
export const BLOCK_DIAG = (BLOCK_SIZE * Math.SQRT2) / 2;
export const HEADSHOT_MUL = 1.8;
export const ENEMY_HEADSHOT_MUL = 1.5;
export const STUN_TIME = 1.5;
export const POISON_DPS = 6;
export const POISON_TIME = 5;
export const EXPLOSION_RADIUS = 130;
export const MISSILE_RADIUS = 70;
export const SPLIT_AFTER = 0.25;
export const SPLIT_SPREAD = (6 * Math.PI) / 180;
export const MISSILE_AFTER = 0.2;
export const MISSILE_TURN = 3.2;
export const VAMPIRE_SHARE = 0.5;
export const JUMP_SPEED = 640;
export const BALLOON_LIFT = 260;
export const RESPAWN_DELAY = 1.2;
export const ENEMY_ARROW_SPEED = 1350;
export const GLIDE_TIME = 1;
export const NEXT_ENEMY_DELAY = 1;
export const APPLE_GRAVITY = 650;
export const APPLE_R = 24;
/** Seconds between apples. */
export const APPLE_EVERY: readonly [number, number] = [6, 10];
export const MAX_STUCK_BODY = 16;
export const MAX_STUCK_PLATFORM = 40;
export const MAX_ARROWS = 48;
/** Player aim limits (radians, y down): nearly straight up to steeply down. */
export const AIM_MIN = -1.5;
export const AIM_MAX = 1.3;
/**
 * Enemy formulas: value = base + step * index, clamped at the limit (see enemyFor). Tuned with bots in model.test.ts:
 * an un-upgraded player gets about 5-9 kills in a 1-1.5 minute run; the bosses (index 4, 9) are the walls.
 */
export const ENEMY = {
  hp: [50, 12],
  damage: [8, 0.9],
  aimError: [0.18, -0.008, 0.035],
  drawTime: [1.5, -0.04, 0.7],
  cooldown: [2.8, -0.08, 0.9],
  reward: [5, 2],
} as const;
/** Boss multipliers on the normal enemy formulas. */
export const BOSS = { hp: 2, damage: 1.2, aim: 0.6, scale: 1.6, reward: 5 } as const;

/** Versus: round wins that take the match (best of 5). */
export const ROUNDS_TO_WIN = 3;
/** Versus: seconds from a round's deciding death to the next round. */
export const ROUND_PAUSE = 2.4;
/** Versus: P2's tower, the mirror of the player's. */
export const VERSUS_TOWER_X = WORLD_W - TOWER_X;
/**
 * Co-op: P1 on a taller, narrower back tower, P2 on the solo tower in front (centre x, top y, width). The back
 * archer shoots over the front one's head; arrows pass through teammates anyway.
 */
export const COOP_TOWERS: readonly { x: number; top: number; w: number }[] = [
  { x: 190, top: 500, w: 200 },
  { x: 440, top: TOWER_TOP, w: TOWER_W },
];

const IMPULSE = 300;
const ARROW_OUT = 300;
const SPECIAL_ARROWS: readonly ArrowId[] = ['poison', 'electric', 'explosive'];

export function launchSpeed(draw: number): number {
  return MIN_SPEED + (MAX_SPEED - MIN_SPEED) * clamp01(draw);
}

// ---------------------------------------------------------------- enemies

export interface EnemySpec {
  /** 0-based enemy count in the run. */
  index: number;
  boss: boolean;
  hp: number;
  /** Raw damage of a body hit on the player (before headshot and armor). */
  damage: number;
  /** Std-dev of the launch angle error, radians. */
  aimError: number;
  /** Seconds to draw the bow. */
  drawTime: number;
  /** Seconds between shots (after the draw). */
  cooldown: number;
  scale: number;
  /** Skulls for the kill. */
  reward: number;
  arrow: ArrowId;
  /** Launch speed of its arrows. */
  speed: number;
  /** Armor points: the player's arrows deal damageTaken(raw, armor). */
  armor: number;
}

/**
 * Armor of the index-th enemy: every 3rd regular enemy from the 4th on wears gear that grows with the index; bosses
 * wear it from the second boss on. Capped at 10 (half damage).
 */
function enemyArmor(index: number, boss: boolean): number {
  if (boss) return index >= 9 ? Math.min(10, 2 + Math.floor(index / 5)) : 0;
  return index >= 3 && index % 3 === 0 ? Math.min(10, 2 + Math.floor(index / 3)) : 0;
}

/** The index-th enemy of a run; every 5th is a boss. Pure (no randomness). */
export function enemyFor(index: number): EnemySpec {
  const boss = (index + 1) % 5 === 0;
  const special = index >= 6 && (boss || index % 2 === 0);
  const E = ENEMY;
  return {
    index,
    boss,
    armor: enemyArmor(index, boss),
    hp: Math.round((E.hp[0] + E.hp[1] * index) * (boss ? BOSS.hp : 1)),
    damage: Math.round((E.damage[0] + E.damage[1] * index) * (boss ? BOSS.damage : 1) * 10) / 10,
    aimError: Math.max(E.aimError[2], E.aimError[0] + E.aimError[1] * index) * (boss ? BOSS.aim : 1),
    drawTime: Math.max(E.drawTime[2], E.drawTime[0] + E.drawTime[1] * index),
    cooldown: Math.max(E.cooldown[2], E.cooldown[0] + E.cooldown[1] * index),
    scale: boss ? BOSS.scale : 1,
    reward: Math.round((E.reward[0] + E.reward[1] * index) * (boss ? BOSS.reward : 1)),
    arrow: special ? SPECIAL_ARROWS[Math.floor(index / 2) % SPECIAL_ARROWS.length]! : 'normal',
    speed: ENEMY_ARROW_SPEED + Math.min(150, index * 10),
  };
}

/**
 * Launch angle (radians, y down) that hits (dx, dy) from the origin at speed v under gravity g: the lower arc, or the
 * higher one with `high`. Null when the target is out of range.
 */
export function solveLaunchAngle(dx: number, dy: number, v: number, g = ARROW_GRAVITY, high = false): number | null {
  const x = Math.abs(dx);
  const y = -dy;
  if (x < 1e-6) return dy < 0 ? -Math.PI / 2 : Math.PI / 2;
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * x * x + 2 * y * v2);
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const up = Math.atan((v2 + (high ? root : -root)) / (g * x));
  return dx >= 0 ? -up : Math.PI + up;
}

// ---------------------------------------------------------------- events

export type Side = 'player' | 'enemy';
/**
 * solo: one human vs the AI enemy series (starts in the menu). versus: human 0 on the left tower vs human 1 on the
 * mirrored right tower (side 'enemy', no AI), best of 5 rounds. coop: two humans on side 'player' vs the enemy series.
 */
export type BattleMode = 'solo' | 'versus' | 'coop';
/** Index of a human archer: 0 = P1 (the solo player), 1 = P2. */
export type Who = 0 | 1;

/**
 * `who` names the human concerned (the actor for draw / shoot / jump..., the victim for hit / dot) and is null for
 * the AI enemies; `by` on hits is the human who shot the arrow.
 */
export type BattleEvent =
  | { type: 'start' }
  | { type: 'draw'; side: Side; who: Who | null }
  | { type: 'shoot'; side: Side; arrow: ArrowId; power: number; x: number; y: number; who: Who | null }
  /**
   * An arrow (or blast) hit a body. side = the victim. corpse = it was already dead (no damage). armor = the victim's
   * armor points (damage is already reduced by it).
   */
  | {
      type: 'hit';
      side: Side;
      x: number;
      y: number;
      damage: number;
      head: boolean;
      arrow: ArrowId;
      kill: boolean;
      boss: boolean;
      corpse: boolean;
      blast: boolean;
      armor: number;
      who: Who | null;
      by: Who | null;
    }
  /** Damage over time (poison), reported about once per second. */
  | { type: 'dot'; side: Side; x: number; y: number; damage: number; who: Who | null }
  | { type: 'thunk'; x: number; y: number; arrow: ArrowId; platform: 'tower' | 'block' }
  | { type: 'explode'; x: number; y: number; radius: number; side: Side }
  | { type: 'zap'; side: Side; x: number; y: number }
  | { type: 'poison'; side: Side; x: number; y: number }
  | { type: 'balloon'; side: Side; x: number; y: number; count: number; lifted: boolean }
  | { type: 'saw'; side: Side; x: number; y: number }
  | { type: 'split'; x: number; y: number }
  /** An apple was shot; hp / stamina went to its shooter `who`. */
  | { type: 'apple'; kind: AppleKind; x: number; y: number; hp: number; stamina: number; who: Who }
  | { type: 'heal'; amount: number; x: number; y: number; who: Who }
  | { type: 'kill'; reward: number; boss: boolean; x: number; y: number; index: number; balloon: boolean }
  | { type: 'arrive'; boss: boolean; index: number }
  | { type: 'jump'; who: Who }
  | { type: 'land'; who: Who }
  | { type: 'noStamina'; who: Who }
  | { type: 'equip'; arrow: ArrowId; who: Who }
  | { type: 'lifeLost'; livesLeft: number; who: Who }
  | { type: 'respawn'; who: Who }
  /** Co-op: a human lost the last life while the partner fights on. */
  | { type: 'out'; who: Who }
  | { type: 'gameover'; score: number; skulls: number }
  | { type: 'revive' }
  /** Versus: a round begins (1-based); both archers are fresh. */
  | { type: 'roundStart'; round: number }
  /** Versus: `winner` took the round; score = round wins [P1, P2] after it. */
  | { type: 'roundOver'; round: number; winner: Who; score: [number, number] }
  /** Versus: the match is decided (state is 'over'). */
  | { type: 'matchOver'; winner: Who; score: [number, number] };

export type BattleState = 'menu' | 'playing' | 'over';

// ---------------------------------------------------------------- world objects

interface BodyPin {
  bone: number;
  u: number;
  v: number;
  rel: number;
}

interface PlatformPin {
  lx: number;
  ly: number;
  rel: number;
}

export class Fighter implements FighterView {
  readonly stuck: StuckArrowView[] = [];
  readonly pins: BodyPin[] = [];
  hp: number;
  maxHp: number;
  /** Armor points (player: from the upgrade; enemies: from their spec). */
  armor = 0;
  alive = true;
  nocked: ArrowId | null;
  poison = 0;
  stun = 0;
  flash = 0;
  /** Enemy AI. */
  cooldown = 0;
  drawing = false;
  aimTarget = Math.PI;
  arrived = true;
  removed = false;
  /** Seconds left of the player's knock-down after losing a life. */
  knocked = 0;
  poisonAcc = 0;
  poisonTick = 0;
  /** The controller of a human archer; null for AI enemies. */
  human: Human | null = null;
  /** Enemy AI: the human it draws on (picked at each draw). */
  target: Human | null = null;

  constructor(
    readonly id: number,
    readonly side: Side,
    readonly body: Ragdoll,
    hp: number,
    readonly boss: boolean,
    readonly spec: EnemySpec | null,
    public platform: Platform,
    nocked: ArrowId,
  ) {
    this.hp = this.maxHp = hp;
    this.nocked = nocked;
  }

  get scale(): number {
    return this.body.scale;
  }
  get joints(): readonly Vec[] {
    return this.body.pos;
  }
  get facing(): 1 | -1 {
    return this.body.facing;
  }
  get aimAngle(): number {
    return this.body.aimAngle;
  }
  get draw(): number {
    return this.body.draw;
  }
  get balloons(): number {
    return this.body.balloons;
  }
  /** Floating away on balloons. */
  get lifted(): boolean {
    return this.body.balloons >= this.body.liftAt;
  }
  get hpBar(): boolean {
    return this.human === null;
  }
}

export class Platform implements PlatformView {
  readonly stuck: StuckArrowView[] = [];
  readonly pins: PlatformPin[] = [];
  vy = 0;
  falling = false;
  fallDelay = 0;
  removed = false;
  glideFrom = 0;
  glideTo = 0;
  glideT = 1;

  constructor(
    readonly id: number,
    readonly kind: 'tower' | 'block',
    public x: number,
    public y: number,
    readonly w: number,
    readonly h: number,
    readonly angle: number,
  ) {}

  /** Stand point on top (tower top centre / block top corner). */
  get standX(): number {
    return this.x;
  }
  get standY(): number {
    return this.kind === 'tower' ? this.y - this.h / 2 : this.y - BLOCK_DIAG;
  }
}

export class Arrow implements ArrowView {
  age = 0;
  angle: number;
  dead = false;
  splitDone = false;
  /** Fighters a chainsaw arrow already cut. */
  readonly cut = new Set<number>();

  constructor(
    readonly id: number,
    readonly type: ArrowId,
    readonly owner: Side,
    public x: number,
    public y: number,
    public vx: number,
    public vy: number,
    /** 0..1 draw at release. */
    readonly power: number,
    /** Damage of a body hit before the headshot multiplier (and the player's armor for enemy arrows). */
    readonly base: number,
    /** The human who shot it; null for AI arrows. */
    readonly who: Who | null = null,
  ) {
    this.angle = Math.atan2(vy, vx);
  }

  get flightAngle(): number {
    return Math.atan2(this.vy, this.vx);
  }
}

export class Apple implements AppleView {
  angle = 0;
  readonly r = APPLE_R;

  constructor(
    readonly id: number,
    readonly kind: AppleKind,
    public x: number,
    public y: number,
    public vx: number,
    public vy: number,
    readonly spin: number,
  ) {}
}

/** Controller state of one human archer: its fighter and tower, stats, loadout, stamina, lives and bow. */
export class Human {
  stats: PlayerStats;
  loadout: ArrowId[];
  selected: ArrowId;
  stamina: number;
  livesLeft: number;
  /** Bow state: drawing toward pullTarget (0..1). */
  drawing = false;
  pullTarget = 0;
  /** Seconds until the next arrow is nocked after a shot. */
  renock = 0;
  /** Shots fired and hits landed (stats / tests). */
  shots = 0;
  hits = 0;

  constructor(
    readonly who: Who,
    readonly fighter: Fighter,
    readonly tower: Platform,
    stats: PlayerStats,
    loadout: readonly ArrowId[],
  ) {
    this.stats = stats;
    this.loadout = [...loadout];
    this.selected = this.loadout[0]!;
    this.stamina = stats.maxStamina;
    this.livesLeft = stats.lives;
    fighter.human = this;
  }

  get maxStamina(): number {
    return this.stats.maxStamina;
  }
}

// ---------------------------------------------------------------- model

export interface BattleOptions {
  seed?: number;
  /** Default 'solo'. */
  mode?: BattleMode;
  /** Stats and loadout of every human (versus / co-op: both use the same). */
  stats?: PlayerStats;
  loadout?: readonly ArrowId[];
}

export class BattleModel {
  readonly rng: Rng;
  readonly mode: BattleMode;
  state: BattleState = 'menu';
  readonly fighters: Fighter[] = [];
  readonly platforms: Platform[] = [];
  arrows: Arrow[] = [];
  apples: Apple[] = [];
  /** Human archers: [P1] in solo, [P1, P2] in versus and co-op. */
  readonly humans: Human[] = [];
  /** Human 0's fighter and tower. */
  readonly player: Fighter;
  readonly tower: Platform;
  /** The current AI opponent (alive or dying), null between enemies and in versus. */
  enemy: Fighter | null = null;
  /** Kills (solo / co-op, shared). */
  score = 0;
  skullsEarned = 0;
  enemyIndex = 0;
  time = 0;
  /** Versus: current round (1-based) and round wins [P1, P2]; winner once the match is over. */
  round = 0;
  readonly roundScore: [number, number] = [0, 0];
  winner: Who | null = null;
  private nextId = 1;
  private pending: BattleEvent[] = [];
  private appleTimer: number;
  private nextEnemyIn = -1;
  /** Versus: seconds until the next round starts (> 0 between rounds; nobody acts or takes damage). */
  private intermission = 0;

  constructor(opts: BattleOptions = {}) {
    this.rng = new Rng(opts.seed ?? 1);
    this.mode = opts.mode ?? 'solo';
    const stats = opts.stats ?? playerStats(NO_UPGRADES);
    const loadout: readonly ArrowId[] = opts.loadout && opts.loadout.length > 0 ? opts.loadout : ['normal'];
    if (this.mode === 'versus') {
      this.addHuman(0, 'player', TOWER_X, TOWER_TOP, TOWER_W, 1, stats, loadout);
      this.addHuman(1, 'enemy', VERSUS_TOWER_X, TOWER_TOP, TOWER_W, -1, stats, loadout);
    } else if (this.mode === 'coop') {
      for (const who of [0, 1] as const) {
        const t = COOP_TOWERS[who]!;
        this.addHuman(who, 'player', t.x, t.top, t.w, 1, stats, loadout);
      }
    } else {
      this.addHuman(0, 'player', TOWER_X, TOWER_TOP, TOWER_W, 1, stats, loadout);
    }
    this.player = this.humans[0]!.fighter;
    this.tower = this.humans[0]!.tower;
    if (this.mode === 'solo') this.spawnEnemy(0, MENU_ENEMY_X, MENU_ENEMY_TOP, false);
    this.appleTimer = this.rng.float(APPLE_EVERY[0], APPLE_EVERY[1]) * 0.6;
    if (this.mode === 'versus') {
      this.state = 'playing';
      this.emit({ type: 'start' });
      this.round = 1;
      this.emit({ type: 'roundStart', round: 1 });
    } else if (this.mode === 'coop') {
      this.state = 'playing';
      this.emit({ type: 'start' });
      this.spawnEnemy(0, MENU_ENEMY_X, MENU_ENEMY_TOP, true);
      this.emit({ type: 'arrive', boss: false, index: 0 });
    }
  }

  // ---------------------------------------------------------------- solo accessors (human 0)

  get stats(): PlayerStats {
    return this.humans[0]!.stats;
  }
  set stats(v: PlayerStats) {
    this.humans[0]!.stats = v;
  }
  get loadout(): ArrowId[] {
    return this.humans[0]!.loadout;
  }
  set loadout(v: ArrowId[]) {
    this.humans[0]!.loadout = v;
  }
  get selected(): ArrowId {
    return this.humans[0]!.selected;
  }
  set selected(v: ArrowId) {
    this.humans[0]!.selected = v;
  }
  get stamina(): number {
    return this.humans[0]!.stamina;
  }
  set stamina(v: number) {
    this.humans[0]!.stamina = v;
  }
  get livesLeft(): number {
    return this.humans[0]!.livesLeft;
  }
  set livesLeft(v: number) {
    this.humans[0]!.livesLeft = v;
  }
  /** Player bow state. */
  get drawing(): boolean {
    return this.humans[0]!.drawing;
  }
  set drawing(v: boolean) {
    this.humans[0]!.drawing = v;
  }
  get pullTarget(): number {
    return this.humans[0]!.pullTarget;
  }
  set pullTarget(v: number) {
    this.humans[0]!.pullTarget = v;
  }
  /** Shots fired and hits landed by the player (stats / tests). */
  get shots(): number {
    return this.humans[0]!.shots;
  }
  get hits(): number {
    return this.humans[0]!.hits;
  }

  // ---------------------------------------------------------------- views

  /** The controller of human `who` (P2 exists in versus and co-op only). */
  human(who: Who = 0): Human {
    const h = this.humans[who];
    if (!h) throw new Error(`no human ${who} in ${this.mode} mode`);
    return h;
  }
  get hp(): number {
    return this.player.hp;
  }
  get maxHp(): number {
    return this.player.maxHp;
  }
  get maxStamina(): number {
    return this.stats.maxStamina;
  }
  get draw(): number {
    return this.player.body.draw;
  }
  /** Versus: between rounds (the round is decided, the next one starts soon). */
  get betweenRounds(): boolean {
    return this.intermission > 0;
  }
  get fighterViews(): readonly FighterView[] {
    return this.fighters;
  }
  get arrowViews(): readonly ArrowView[] {
    return this.arrows;
  }
  get appleViews(): readonly AppleView[] {
    return this.apples;
  }
  get platformViews(): readonly PlatformView[] {
    return this.platforms;
  }
  /** The player can act (not knocked down, stunned or dead). */
  get canAct(): boolean {
    return this.canActFor(0);
  }

  /** Human `who` can act: alive, not knocked down or stunned, the game not over and (versus) the round live. */
  canActFor(who: Who): boolean {
    const f = this.humans[who]?.fighter;
    return !!f && this.state !== 'over' && f.alive && f.knocked <= 0 && f.stun <= 0 && this.intermission <= 0;
  }

  // ---------------------------------------------------------------- input

  /** Loadout for the next run (menu only). */
  setLoadout(stats: PlayerStats, arrows: readonly ArrowId[]): void {
    if (this.state !== 'menu') return;
    this.stats = stats;
    this.loadout = arrows.length > 0 ? [...arrows] : ['normal'];
    if (!this.loadout.includes(this.selected)) this.selected = this.loadout[0]!;
    this.player.maxHp = this.player.hp = stats.maxHp;
    this.player.armor = stats.armor;
    this.stamina = stats.maxStamina;
    this.livesLeft = stats.lives;
    this.player.nocked = this.selected;
  }

  /** Starts drawing the bow; the first draw in the menu starts the run. Returns false when it can't. */
  beginDraw(who: Who = 0): boolean {
    const h = this.humans[who];
    if (!h || !this.canActFor(who) || h.drawing) return false;
    if (h.stamina < SHOT_COST) {
      this.emit({ type: 'noStamina', who });
      return false;
    }
    if (this.state === 'menu') this.startRun();
    h.drawing = true;
    h.pullTarget = 0;
    h.fighter.body.draw = 0;
    this.emit({ type: 'draw', side: h.fighter.side, who });
    return true;
  }

  /**
   * Aim angle (radians, y down) and pull 0..1 (the draw grows toward it). The angle is clamped to AIM_MIN..AIM_MAX,
   * mirrored for an archer facing left.
   */
  aim(angle: number, pull: number, who: Who = 0): void {
    const h = this.humans[who];
    if (!h || this.state === 'over' || !h.fighter.alive) return;
    h.fighter.body.aimAngle = clampAim(angle, h.fighter.facing);
    h.pullTarget = clamp01(pull);
  }

  /** Lets go: fires when drawn at least MIN_DRAW, else cancels. Returns true when an arrow flew. */
  release(who: Who = 0): boolean {
    const h = this.humans[who];
    if (!h || !h.drawing) return false;
    h.drawing = false;
    const body = h.fighter.body;
    const draw = body.draw;
    body.draw = 0;
    if (draw < MIN_DRAW || !this.canActFor(who) || h.stamina < SHOT_COST) return false;
    h.stamina -= SHOT_COST;
    const type = h.selected;
    const base = h.stats.damage * arrowDef(type).damageMul * (0.5 + 0.5 * draw);
    this.fire(h.fighter, type, body.aimAngle, launchSpeed(draw), draw, base, who);
    h.shots++;
    h.renock = 0.25;
    return true;
  }

  cancelDraw(who: Who = 0): void {
    const h = this.humans[who];
    if (!h) return;
    h.drawing = false;
    h.fighter.body.draw = 0;
  }

  /** Hop to dodge (JUMP_COST stamina). */
  jump(who: Who = 0): boolean {
    const h = this.humans[who];
    if (!h || this.state !== 'playing' || !this.canActFor(who) || !h.fighter.body.grounded) return false;
    if (h.stamina < JUMP_COST) {
      this.emit({ type: 'noStamina', who });
      return false;
    }
    h.stamina -= JUMP_COST;
    h.fighter.body.jump(JUMP_SPEED);
    this.emit({ type: 'jump', who });
    return true;
  }

  /** Switches the arrow type (only types in the loadout). */
  selectArrow(id: ArrowId, who: Who = 0): boolean {
    const h = this.humans[who];
    if (!h || !h.loadout.includes(id) || id === h.selected) return false;
    h.selected = id;
    if (h.fighter.nocked) h.fighter.nocked = id;
    this.emit({ type: 'equip', arrow: id, who });
    return true;
  }

  /** Rewarded-ad revive after a solo game over: full HP and stamina, back to playing. */
  revive(): boolean {
    if (this.state !== 'over' || this.mode !== 'solo') return false;
    const p = this.player;
    this.state = 'playing';
    p.alive = true;
    p.hp = p.maxHp;
    p.poison = p.stun = p.knocked = 0;
    p.body.stiffness = 1;
    p.body.grounded = true;
    p.body.balloons = 0;
    p.body.reset();
    p.nocked = this.selected;
    this.stamina = this.stats.maxStamina;
    this.livesLeft = 1;
    if (this.enemy?.alive) this.enemy.cooldown = Math.max(this.enemy.cooldown, 2);
    this.emit({ type: 'revive' });
    return true;
  }

  /** Gives up (pause menu): solo / co-op end like a death of every human; a versus match just stops undecided. */
  forfeit(): void {
    if (this.state === 'over') return;
    if (this.mode === 'versus') {
      for (const h of this.humans) this.cancelDraw(h.who);
      this.state = 'over';
      return;
    }
    for (const h of this.humans) {
      h.livesLeft = Math.min(h.livesLeft, 1);
      h.fighter.knocked = 0;
      this.humanDies(h);
    }
  }

  /** Launch angle for a human's bow to hit (x, y) at the given draw, or null when out of range. */
  aimAt(x: number, y: number, draw = 1, who: Who = 0): number | null {
    return this.aimFrom(this.human(who).fighter, x, y, launchSpeed(draw));
  }

  /** Where an arrow shot by this fighter at `angle` starts (tip position). */
  muzzle(f: Fighter, angle: number): Vec {
    const n = f.body.target[J.neck]!;
    const reach = (BODY.upperArm + BODY.foreArm) * 0.96 * f.scale + 22 * f.scale;
    return { x: n.x + Math.cos(angle) * reach, y: n.y + Math.sin(angle) * reach };
  }

  /** Head centre of the current living enemy (bot target), or null. */
  enemyHead(): Vec | null {
    const e = this.enemy;
    if (!e || !e.alive) return null;
    const h = e.body.pos[J.head]!;
    return { x: h.x, y: h.y };
  }

  // ---------------------------------------------------------------- step

  step(dt: number): BattleEvent[] {
    this.time += dt;
    for (const h of this.humans) this.updateHuman(h, dt);
    for (const f of this.fighters) {
      if (f.removed) continue;
      if (!f.human) this.updateEnemy(f, dt);
      this.updateStatus(f, dt);
      if (f.removed) continue;
      if (f.body.step(dt, this.platforms, BALLOON_LIFT) && f.human) this.emit({ type: 'land', who: f.human.who });
      this.syncStuck(f);
    }
    this.stepArrows(dt);
    this.stepApples(dt);
    this.stepPlatforms(dt);
    this.cleanup();
    if (this.state === 'playing') {
      if (this.nextEnemyIn > 0) {
        this.nextEnemyIn -= dt;
        if (this.nextEnemyIn <= 0) this.nextEnemy();
      }
      if (this.intermission > 0) {
        this.intermission -= dt;
        if (this.intermission <= 0) this.startRound();
      } else {
        this.appleTimer -= dt;
        if (this.appleTimer <= 0) {
          this.spawnApple();
          this.appleTimer = this.rng.float(APPLE_EVERY[0], APPLE_EVERY[1]);
        }
      }
    }
    const events = this.pending;
    this.pending = [];
    return events;
  }

  // ---------------------------------------------------------------- humans / enemies

  private addHuman(who: Who, side: Side, x: number, top: number, w: number, facing: 1 | -1, stats: PlayerStats, loadout: readonly ArrowId[]): Human {
    const tower = this.addPlatform('tower', x, top + TOWER_H / 2, w, TOWER_H, 0);
    const body = new Ragdoll({ x, y: top, facing, aimAngle: facing === 1 ? 0 : Math.PI });
    const f = new Fighter(this.id(), side, body, stats.maxHp, false, null, tower, loadout[0]!);
    f.armor = stats.armor;
    this.fighters.push(f);
    const h = new Human(who, f, tower, stats, loadout);
    this.humans.push(h);
    return h;
  }

  private startRun(): void {
    this.state = 'playing';
    if (this.enemy) this.enemy.cooldown = 1.6;
    this.emit({ type: 'start' });
  }

  /** Versus: both archers fresh on their towers, no arrows in the air or stuck anywhere. */
  private startRound(): void {
    this.intermission = 0;
    this.round++;
    for (const h of this.humans) {
      const p = h.fighter;
      p.alive = true;
      p.hp = p.maxHp;
      p.poison = p.stun = p.knocked = p.flash = 0;
      p.poisonAcc = p.poisonTick = 0;
      p.pins.length = 0;
      p.stuck.length = 0;
      p.body.stiffness = 1;
      p.body.grounded = true;
      p.body.balloons = 0;
      p.body.draw = 0;
      p.body.aimAngle = p.facing === 1 ? 0 : Math.PI;
      p.body.reset();
      p.nocked = h.selected;
      h.stamina = h.stats.maxStamina;
      h.drawing = false;
      h.pullTarget = 0;
      h.renock = 0;
    }
    for (const pl of this.platforms) {
      pl.pins.length = 0;
      pl.stuck.length = 0;
    }
    this.arrows = [];
    this.apples = [];
    this.appleTimer = this.rng.float(APPLE_EVERY[0], APPLE_EVERY[1]) * 0.6;
    this.emit({ type: 'roundStart', round: this.round });
  }

  private updateHuman(h: Human, dt: number): void {
    const p = h.fighter;
    const who = h.who;
    if (!p.alive) return;
    if (p.knocked > 0) {
      p.knocked -= dt;
      p.body.stiffness = 0.22;
      if (p.knocked <= 0) {
        p.knocked = 0;
        p.body.stiffness = 1;
        p.hp = p.maxHp;
        h.stamina = h.stats.maxStamina;
        this.emit({ type: 'respawn', who });
      }
      return;
    }
    if (h.drawing) {
      const b = p.body;
      if (!this.canActFor(who)) {
        this.cancelDraw(who);
      } else if (b.draw < h.pullTarget) {
        b.draw = Math.min(h.pullTarget, b.draw + dt / h.stats.drawTime);
      } else {
        b.draw = h.pullTarget;
      }
    }
    if (this.state !== 'over') {
      h.stamina = Math.min(h.stats.maxStamina, h.stamina + h.stats.regen * dt * (h.drawing ? 0.5 : 1));
    }
    if (h.renock > 0) {
      h.renock -= dt;
      p.nocked = h.renock > 0 ? null : h.selected;
    }
  }

  /** A human the AI may shoot at: alive and not knocked down. */
  private targetable(h: Human): boolean {
    return h.fighter.alive && h.fighter.knocked <= 0;
  }

  private updateEnemy(e: Fighter, dt: number): void {
    const spec = e.spec!;
    const b = e.body;
    const pool = this.humans.filter((h) => this.targetable(h));
    const look = (e.target && e.target.fighter.alive ? e.target : (pool[0] ?? this.humans[0]!)).fighter;
    const ready = this.state === 'playing' && e.alive && e.arrived && b.grounded && !e.lifted && e.stun <= 0;
    const canShoot = ready && (e.drawing ? !!e.target && this.targetable(e.target) : pool.length > 0);
    if (!canShoot) {
      e.drawing = false;
      b.draw = Math.max(0, b.draw - dt * 3);
      if (e.alive) b.aimAngle += (restAngle(this.state, e, look) - b.aimAngle) * Math.min(1, dt * 4);
      return;
    }
    if (!e.drawing) {
      e.cooldown -= dt;
      b.aimAngle += (restAngle(this.state, e, look) - b.aimAngle) * Math.min(1, dt * 4);
      if (e.cooldown <= 0) {
        const target = pool.length === 1 ? pool[0]! : pool[this.rng.int(0, pool.length - 1)]!;
        e.target = target;
        const chest = target.fighter.body.chest();
        const ideal = this.aimFrom(e, chest.x, chest.y, spec.speed) ?? Math.PI + 0.6;
        e.aimTarget = ideal + this.rng.gauss(0, spec.aimError);
        e.drawing = true;
        b.draw = 0;
        this.emit({ type: 'draw', side: 'enemy', who: null });
      }
      return;
    }
    b.aimAngle += (e.aimTarget - b.aimAngle) * Math.min(1, dt * 7);
    b.draw = Math.min(1, b.draw + dt / spec.drawTime);
    if (b.draw >= 1) {
      b.aimAngle = e.aimTarget;
      this.fire(e, spec.arrow, e.aimTarget, spec.speed, 1, spec.damage * arrowDef(spec.arrow).damageMul);
      e.drawing = false;
      b.draw = 0;
      e.cooldown = spec.cooldown * this.rng.float(0.8, 1.2);
    }
  }

  private updateStatus(f: Fighter, dt: number): void {
    f.flash = Math.max(0, f.flash - dt * 3);
    f.stun = Math.max(0, f.stun - dt);
    if (f.poison > 0) {
      f.poison = Math.max(0, f.poison - dt);
      if (f.alive && f.knocked <= 0) {
        const dmg = damageTaken(POISON_DPS * dt, f.armor);
        const killed = this.hurt(f, dmg);
        f.poisonAcc += dmg;
        f.poisonTick += dt;
        const c = f.body.chest();
        if (f.poisonTick >= 1 || killed || f.poison <= 0) {
          this.emit({ type: 'dot', side: f.side, x: c.x, y: c.y, damage: f.poisonAcc, who: f.human?.who ?? null });
          f.poisonAcc = 0;
          f.poisonTick = 0;
        }
        if (killed) this.die(f, false);
      }
    }
    if (f.alive && f.lifted && f.body.bottom() < -40) {
      f.hp = 0;
      this.die(f, true);
      if (!f.human) f.removed = true;
    }
  }

  /** Applies damage; returns true when it killed (the caller emits its event, then calls die()). */
  private hurt(f: Fighter, amount: number): boolean {
    if (!f.alive || amount <= 0) return false;
    if (f.human && (f.knocked > 0 || this.state !== 'playing' || this.intermission > 0)) return false;
    f.hp = Math.max(0, f.hp - amount);
    f.flash = 1;
    return f.hp <= 0;
  }

  private die(f: Fighter, balloon: boolean): void {
    if (f.human) {
      this.humanDies(f.human);
      return;
    }
    if (!f.alive) return;
    f.alive = false;
    f.drawing = false;
    f.nocked = null;
    f.poison = 0;
    f.stun = 0;
    f.body.kill();
    f.body.draw = 0;
    const spec = f.spec!;
    this.score++;
    this.skullsEarned += spec.reward;
    const c = f.body.chest();
    this.emit({ type: 'kill', reward: spec.reward, boss: spec.boss, x: c.x, y: c.y, index: spec.index, balloon });
    f.platform.fallDelay = 0.8;
    f.platform.falling = true;
    if (this.state === 'playing') this.nextEnemyIn = NEXT_ENEMY_DELAY;
  }

  private humanDies(h: Human): void {
    const p = h.fighter;
    if (!p.alive) return;
    this.cancelDraw(h.who);
    p.hp = 0;
    p.poison = 0;
    p.stun = 0;
    if (this.mode === 'versus') {
      this.endRound(h);
      return;
    }
    const e = this.enemy;
    if (h.livesLeft > 1) {
      h.livesLeft--;
      p.knocked = RESPAWN_DELAY;
      this.emit({ type: 'lifeLost', livesLeft: h.livesLeft, who: h.who });
      if (e?.alive && this.mode === 'solo') {
        e.drawing = false;
        e.cooldown = RESPAWN_DELAY + 1;
      } else if (e?.alive && e.target === h) {
        e.drawing = false;
        e.cooldown = Math.max(e.cooldown, 1);
      }
      return;
    }
    h.livesLeft = 0;
    p.alive = false;
    p.nocked = null;
    p.body.kill();
    if (this.humans.some((o) => o.fighter.alive)) {
      this.emit({ type: 'out', who: h.who });
      return;
    }
    this.state = 'over';
    this.emit({ type: 'gameover', score: this.score, skulls: this.skullsEarned });
  }

  /** Versus: `loser` died; the other archer takes the round (and maybe the match). */
  private endRound(loser: Human): void {
    const p = loser.fighter;
    p.alive = false;
    p.nocked = null;
    p.body.kill();
    const winner: Who = loser.who === 0 ? 1 : 0;
    this.cancelDraw(winner);
    this.roundScore[winner]++;
    const score: [number, number] = [this.roundScore[0], this.roundScore[1]];
    this.emit({ type: 'roundOver', round: this.round, winner, score });
    if (this.roundScore[winner] >= ROUNDS_TO_WIN) {
      this.state = 'over';
      this.winner = winner;
      this.emit({ type: 'matchOver', winner, score });
    } else {
      this.intermission = ROUND_PAUSE;
    }
  }

  private spawnEnemy(index: number, x: number, top: number, glide: boolean): Fighter {
    const spec = enemyFor(index);
    const startX = glide ? WORLD_W + 160 : x;
    const block = this.addPlatform('block', startX, top + BLOCK_DIAG, BLOCK_SIZE, BLOCK_SIZE, Math.PI / 4);
    if (glide) {
      block.glideFrom = startX;
      block.glideTo = x;
      block.glideT = 0;
    }
    const body = new Ragdoll({ x: block.standX, y: block.standY, facing: -1, scale: spec.scale, aimAngle: Math.PI, slope: 1 });
    body.liftAt = spec.boss ? 3 : 2;
    const e = new Fighter(this.id(), 'enemy', body, spec.hp, spec.boss, spec, block, spec.arrow);
    e.armor = spec.armor;
    e.arrived = !glide;
    e.cooldown = 1 + spec.cooldown * 0.5;
    this.fighters.push(e);
    this.enemy = e;
    return e;
  }

  private nextEnemy(): void {
    this.nextEnemyIn = -1;
    this.enemyIndex++;
    const spec = enemyFor(this.enemyIndex);
    const x = this.rng.float(1050, 1400);
    const top = this.rng.float(spec.boss ? 420 : 300, 650);
    this.spawnEnemy(this.enemyIndex, x, top, true);
    this.emit({ type: 'arrive', boss: spec.boss, index: this.enemyIndex });
  }

  private aimFrom(f: Fighter, x: number, y: number, speed: number): number | null {
    const n = f.body.target[J.neck]!;
    let angle = Math.atan2(y - n.y, x - n.x);
    let ok = false;
    for (let i = 0; i < 4; i++) {
      const m = this.muzzle(f, angle);
      const a = solveLaunchAngle(x - m.x, y - m.y, speed);
      if (a === null) break;
      angle = a;
      ok = true;
    }
    return ok ? angle : null;
  }

  // ---------------------------------------------------------------- arrows

  private fire(f: Fighter, type: ArrowId, angle: number, speed: number, power: number, base: number, who: Who | null = null): void {
    const m = this.muzzle(f, angle);
    const a = new Arrow(this.id(), type, f.side, m.x, m.y, Math.cos(angle) * speed, Math.sin(angle) * speed, power, base, who);
    this.arrows.push(a);
    if (this.arrows.length > MAX_ARROWS) this.arrows.shift();
    this.emit({ type: 'shoot', side: f.side, arrow: type, power, x: m.x, y: m.y, who });
  }

  /** What a missile homes in on: the opposing archer in versus, else the AI enemy / the nearest living human. */
  private homingTarget(a: Arrow): Fighter | null {
    if (this.mode === 'versus') return this.humans[a.owner === 'player' ? 1 : 0]!.fighter;
    if (a.owner === 'player') return this.enemy;
    let best: Fighter | null = null;
    let bestD = Infinity;
    for (const h of this.humans) {
      if (!h.fighter.alive) continue;
      const c = h.fighter.body.chest();
      const d = Math.hypot(c.x - a.x, c.y - a.y);
      if (d < bestD) {
        bestD = d;
        best = h.fighter;
      }
    }
    return best;
  }

  private stepArrows(dt: number): void {
    const born: Arrow[] = [];
    for (const a of this.arrows) {
      if (a.dead) continue;
      a.age += dt;
      if (a.type === 'split' && !a.splitDone && a.age >= SPLIT_AFTER) {
        a.splitDone = true;
        for (const k of [-1, 1]) {
          const c = Math.cos(SPLIT_SPREAD * k);
          const s = Math.sin(SPLIT_SPREAD * k);
          const b = new Arrow(this.id(), a.type, a.owner, a.x, a.y, a.vx * c - a.vy * s, a.vx * s + a.vy * c, a.power, a.base, a.who);
          b.splitDone = true;
          b.age = a.age;
          born.push(b);
        }
        this.emit({ type: 'split', x: a.x, y: a.y });
      }
      let g = ARROW_GRAVITY * (a.type === 'axe' ? 1.3 : 1);
      if (a.type === 'missile' && a.age >= MISSILE_AFTER) {
        const t = this.homingTarget(a);
        if (t && t.alive && !t.removed) {
          const h = t.body.pos[J.head]!;
          const speed = clamp(Math.hypot(a.vx, a.vy), 800, 1150);
          const cur = Math.atan2(a.vy, a.vx);
          const want = Math.atan2(h.y - a.y, h.x - a.x);
          const rate = MISSILE_TURN * (1 + 3 * (a.age - MISSILE_AFTER));
          const turn = clamp(normalizeAngle(want - cur), -rate * dt, rate * dt);
          a.vx = Math.cos(cur + turn) * speed;
          a.vy = Math.sin(cur + turn) * speed;
          g = 0;
        }
      }
      a.vy += g * dt;
      const speed = Math.hypot(a.vx, a.vy);
      const n = Math.max(1, Math.ceil((speed * dt) / 24));
      const h = dt / n;
      for (let i = 0; i < n && !a.dead; i++) {
        const x1 = a.x + a.vx * h;
        const y1 = a.y + a.vy * h;
        if (!this.collideArrow(a, a.x, a.y, x1, y1)) {
          a.x = x1;
          a.y = y1;
        }
      }
      const fa = a.flightAngle;
      a.angle = a.type === 'axe' && !a.dead ? fa + a.age * 15 : fa;
      if (a.x < -ARROW_OUT || a.x > WORLD_W + ARROW_OUT || a.y > WORLD_H + ARROW_OUT) a.dead = true;
    }
    for (const b of born) this.arrows.push(b);
    if (this.arrows.some((a) => a.dead)) this.arrows = this.arrows.filter((a) => !a.dead);
    while (this.arrows.length > MAX_ARROWS) this.arrows.shift();
  }

  /** Tests one sub-step; returns true when the arrow stopped (its tip is left at the impact point). */
  private collideArrow(a: Arrow, x0: number, y0: number, x1: number, y1: number): boolean {
    if (a.who !== null) {
      for (const ap of this.apples) {
        if (segCircle(x0, y0, x1 - x0, y1 - y0, ap.x, ap.y, ap.r + 4) !== null) this.burstApple(ap, a.who);
      }
    }
    let bestT = Infinity;
    let bestFighter: Fighter | null = null;
    let bestHit: BodyHit | null = null;
    let bestPlatform: Platform | null = null;
    for (const f of this.fighters) {
      if (f.removed || f.side === a.owner || a.cut.has(f.id)) continue;
      const hit = f.body.sweep(x0, y0, x1, y1);
      if (hit && hit.param < bestT) {
        bestT = hit.param;
        bestFighter = f;
        bestHit = hit;
      }
    }
    for (const pl of this.platforms) {
      if (pl.removed) continue;
      const t = segRect(x0, y0, x1, y1, pl);
      if (t !== null && t < bestT) {
        bestT = t;
        bestPlatform = pl;
        bestFighter = null;
      }
    }
    if (bestT === Infinity) return false;
    a.x = x0 + (x1 - x0) * bestT;
    a.y = y0 + (y1 - y0) * bestT;
    if (bestFighter && bestHit) return this.hitBody(a, bestFighter, bestHit);
    this.hitPlatform(a, bestPlatform!);
    return true;
  }

  private hitBody(a: Arrow, f: Fighter, hit: BodyHit): boolean {
    const speed = Math.hypot(a.vx, a.vy) || 1;
    const dx = a.vx / speed;
    const dy = a.vy / speed;
    if (a.type === 'explosive' || a.type === 'missile') {
      this.explode(a, a.type === 'explosive' ? EXPLOSION_RADIUS : MISSILE_RADIUS, f, hit.head);
      a.dead = true;
      return true;
    }
    const corpse = !f.alive;
    let dealt = 0;
    let killed = false;
    if (!corpse) {
      const before = f.hp;
      killed = this.hurt(f, this.bodyDamage(a, f, hit.head));
      dealt = before - f.hp;
    }
    const k = IMPULSE * (0.6 + 0.4 * a.power) * (a.type === 'axe' ? 3 : a.type === 'chainsaw' ? 0.5 : 1);
    if (hit.head) {
      f.body.push(J.head, dx * k, dy * k);
      f.body.push(J.neck, dx * k * 0.3, dy * k * 0.3);
    } else {
      f.body.pushBone(hit.bone, f.body.boneParam(hit.bone, hit.x, hit.y), dx * k, dy * k);
    }
    if (!corpse && a.who !== null) this.humans[a.who]!.hits++;
    if (!corpse) this.applyEffect(a, f, hit, dealt);
    this.emit({
      type: 'hit',
      side: f.side,
      x: hit.x,
      y: hit.y,
      damage: dealt,
      head: hit.head,
      arrow: a.type,
      kill: killed,
      boss: f.boss,
      corpse,
      blast: false,
      armor: f.armor,
      who: f.human?.who ?? null,
      by: a.who,
    });
    if (killed) {
      if (!f.human || this.mode === 'versus') f.body.push(hit.head ? J.head : J.neck, dx * k, dy * k);
      this.die(f, false);
    }
    if (a.type === 'chainsaw') {
      a.cut.add(f.id);
      this.emit({ type: 'saw', side: f.side, x: hit.x, y: hit.y });
      return false;
    }
    this.stickBody(f, a, hit, dx, dy);
    a.dead = true;
    return true;
  }

  private bodyDamage(a: Arrow, victim: Fighter, head: boolean): number {
    const mul = head ? headshotMul(a) : 1;
    return damageTaken(a.base * mul, victim.armor);
  }

  private applyEffect(a: Arrow, f: Fighter, hit: BodyHit, dealt: number): void {
    switch (a.type) {
      case 'electric':
        f.stun = STUN_TIME;
        if (f.human) this.cancelDraw(f.human.who);
        else {
          f.drawing = false;
          f.body.draw = 0;
        }
        this.emit({ type: 'zap', side: f.side, x: hit.x, y: hit.y });
        break;
      case 'poison':
        f.poison += POISON_TIME;
        this.emit({ type: 'poison', side: f.side, x: hit.x, y: hit.y });
        break;
      case 'balloon':
        if (!f.alive) break;
        f.body.balloons++;
        this.emit({ type: 'balloon', side: f.side, x: hit.x, y: hit.y, count: f.body.balloons, lifted: f.lifted });
        if (f.lifted) f.drawing = false;
        break;
      case 'vampire':
        if (a.who !== null && dealt > 0) this.healHuman(this.humans[a.who]!, dealt * VAMPIRE_SHARE);
        break;
      default:
        break;
    }
  }

  private healHuman(h: Human, amount: number): void {
    const p = h.fighter;
    if (!p.alive || p.knocked > 0) return;
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + amount);
    if (p.hp > before) {
      const c = p.body.chest();
      this.emit({ type: 'heal', amount: p.hp - before, x: c.x, y: c.y, who: h.who });
    }
  }

  private explode(a: Arrow, radius: number, direct: Fighter | null, head: boolean): void {
    const x = a.x;
    const y = a.y;
    this.emit({ type: 'explode', x, y, radius, side: a.owner });
    for (const f of this.fighters) {
      if (f.removed) continue;
      const d = f === direct ? 0 : f.body.distanceTo(x, y);
      if (d >= radius * 1.4) continue;
      f.body.blast(x, y, radius * 1.6, 950);
      if (f.side === a.owner || !f.alive || d >= radius) continue;
      const fall = 1 - d / radius;
      const raw = a.base * fall * (f === direct && head ? headshotMul(a) : 1);
      const before = f.hp;
      const killed = this.hurt(f, damageTaken(raw, f.armor));
      if (a.who !== null && f === direct) this.humans[a.who]!.hits++;
      const c = f.body.chest();
      this.emit({
        type: 'hit',
        side: f.side,
        x: c.x,
        y: c.y,
        damage: before - f.hp,
        head: f === direct && head,
        arrow: a.type,
        kill: killed,
        boss: f.boss,
        corpse: false,
        blast: true,
        armor: f.armor,
        who: f.human?.who ?? null,
        by: a.who,
      });
      if (killed) this.die(f, false);
    }
    if (a.who !== null) {
      const who = a.who;
      for (const ap of this.apples) if (Math.hypot(ap.x - x, ap.y - y) < radius + ap.r) this.burstApple(ap, who);
    }
  }

  private hitPlatform(a: Arrow, pl: Platform): void {
    if (a.type === 'explosive' || a.type === 'missile') {
      this.explode(a, a.type === 'explosive' ? EXPLOSION_RADIUS : MISSILE_RADIUS, null, false);
      a.dead = true;
      return;
    }
    const angle = a.flightAngle;
    const tip = toPlatform(pl, a.x + Math.cos(angle) * 10, a.y + Math.sin(angle) * 10);
    pl.pins.push({ lx: tip.x, ly: tip.y, rel: angle - pl.angle });
    pl.stuck.push({ type: a.type, x: 0, y: 0, angle });
    if (pl.pins.length > MAX_STUCK_PLATFORM) {
      pl.pins.shift();
      pl.stuck.shift();
    }
    this.syncPlatformStuck(pl);
    a.dead = true;
    this.emit({ type: 'thunk', x: a.x, y: a.y, arrow: a.type, platform: pl.kind });
  }

  private stickBody(f: Fighter, a: Arrow, hit: BodyHit, dx: number, dy: number): void {
    const pen = 12 * f.scale;
    const tx = hit.x + dx * pen;
    const ty = hit.y + dy * pen;
    const fr = f.body.boneFrame(hit.bone);
    const rx = tx - fr.ox;
    const ry = ty - fr.oy;
    f.pins.push({ bone: hit.bone, u: rx * fr.ux + ry * fr.uy, v: -rx * fr.uy + ry * fr.ux, rel: Math.atan2(dy, dx) - Math.atan2(fr.uy, fr.ux) });
    f.stuck.push({ type: a.type, x: tx, y: ty, angle: Math.atan2(dy, dx) });
    if (f.pins.length > MAX_STUCK_BODY) {
      f.pins.shift();
      f.stuck.shift();
    }
  }

  private syncStuck(f: Fighter): void {
    for (let i = 0; i < f.pins.length; i++) {
      const pin = f.pins[i]!;
      const fr = f.body.boneFrame(pin.bone);
      const st = f.stuck[i]!;
      st.x = fr.ox + pin.u * fr.ux - pin.v * fr.uy;
      st.y = fr.oy + pin.u * fr.uy + pin.v * fr.ux;
      st.angle = Math.atan2(fr.uy, fr.ux) + pin.rel;
    }
  }

  private syncPlatformStuck(pl: Platform): void {
    for (let i = 0; i < pl.pins.length; i++) {
      const pin = pl.pins[i]!;
      const w = fromPlatform(pl, pin.lx, pin.ly);
      const st = pl.stuck[i]!;
      st.x = w.x;
      st.y = w.y;
      st.angle = pl.angle + pin.rel;
    }
  }

  // ---------------------------------------------------------------- apples / platforms

  private spawnApple(): void {
    const weights = {} as Record<AppleKind, number>;
    for (const a of APPLES) weights[a.kind] = a.weight;
    const kind = this.rng.weighted(weights);
    const front = this.humans[this.mode === 'coop' ? 1 : 0]!.tower.x;
    const lo = front + 260;
    const far = this.mode === 'versus' ? this.humans[1]!.tower.x : this.enemy?.platform.glideTo || this.enemy?.platform.x || 1150;
    const hi = Math.max(lo + 60, far - 220);
    const x = this.rng.float(lo, hi);
    const y = WORLD_H + 50;
    const apex = this.rng.float(140, 360);
    const vy = -Math.sqrt(2 * APPLE_GRAVITY * (y - apex));
    this.apples.push(new Apple(this.id(), kind, x, y, this.rng.float(-110, 110), vy, this.rng.float(-3, 3)));
  }

  private stepApples(dt: number): void {
    for (const ap of this.apples) {
      ap.vy += APPLE_GRAVITY * dt;
      ap.x += ap.vx * dt;
      ap.y += ap.vy * dt;
      ap.angle += ap.spin * dt;
    }
    if (this.apples.some((ap) => ap.y > WORLD_H + 120 && ap.vy > 0)) this.apples = this.apples.filter((ap) => !(ap.y > WORLD_H + 120 && ap.vy > 0));
  }

  /** An apple shot by human `who`: its hp / stamina go to that archer. */
  private burstApple(ap: Apple, who: Who): void {
    if (!this.apples.includes(ap)) return;
    this.apples = this.apples.filter((a) => a !== ap);
    const def = appleDef(ap.kind);
    const h = this.humans[who]!;
    const p = h.fighter;
    let hp = 0;
    let st = 0;
    if (p.alive && p.knocked <= 0) {
      hp = Math.min(def.hp, p.maxHp - p.hp);
      st = Math.min(def.stamina, h.stats.maxStamina - h.stamina);
      p.hp += hp;
      h.stamina += st;
    }
    this.emit({ type: 'apple', kind: ap.kind, x: ap.x, y: ap.y, hp, stamina: st, who });
    if (hp > 0) {
      const c = p.body.chest();
      this.emit({ type: 'heal', amount: hp, x: c.x, y: c.y, who });
    }
  }

  private stepPlatforms(dt: number): void {
    for (const pl of this.platforms) {
      if (pl.removed) continue;
      const ox = pl.x;
      const oy = pl.y;
      if (pl.glideT < 1) {
        pl.glideT = Math.min(1, pl.glideT + dt / GLIDE_TIME);
        const k = 1 - Math.pow(1 - pl.glideT, 3);
        pl.x = pl.glideFrom + (pl.glideTo - pl.glideFrom) * k;
        if (pl.glideT >= 1) {
          const e = this.fighters.find((f) => f.platform === pl && f.alive);
          if (e) e.arrived = true;
        }
      }
      if (pl.falling) {
        if (pl.fallDelay > 0) pl.fallDelay -= dt;
        else {
          pl.vy += 900 * dt;
          pl.y += pl.vy * dt;
        }
        if (pl.y - BLOCK_DIAG > WORLD_H + 400) pl.removed = true;
      }
      if (pl.x !== ox || pl.y !== oy) {
        for (const f of this.fighters) if (f.platform === pl && f.body.grounded) f.body.moveStand(pl.standX, pl.standY);
        this.syncPlatformStuck(pl);
      }
    }
  }

  private cleanup(): void {
    for (const f of this.fighters) {
      if (f.human || f.removed || f.alive) continue;
      if (f.body.top() > WORLD_H + 300 || f.body.bottom() < -300) f.removed = true;
    }
    if (this.fighters.some((f) => f.removed)) {
      for (let i = this.fighters.length - 1; i >= 0; i--) {
        const f = this.fighters[i]!;
        if (!f.removed) continue;
        this.fighters.splice(i, 1);
        if (this.enemy === f) this.enemy = null;
      }
    }
    if (this.platforms.some((p) => p.removed)) {
      for (let i = this.platforms.length - 1; i >= 0; i--) if (this.platforms[i]!.removed) this.platforms.splice(i, 1);
    }
  }

  private addPlatform(kind: 'tower' | 'block', x: number, y: number, w: number, h: number, angle: number): Platform {
    const p = new Platform(this.id(), kind, x, y, w, h, angle);
    this.platforms.push(p);
    return p;
  }

  private id(): number {
    return this.nextId++;
  }

  private emit(e: BattleEvent): void {
    this.pending.push(e);
  }
}

function restAngle(state: BattleState, e: Fighter, target: Fighter): number {
  if (state === 'menu' || !target.alive) return Math.PI;
  const c = target.body.chest();
  const n = e.body.pos[J.neck]!;
  return clamp(normalizeAngle(Math.atan2(c.y - n.y, c.x - n.x) - Math.PI) * 0.5, -0.5, 0.5) + Math.PI;
}

/** Human arrows use the player headshot multiplier, AI arrows the enemy one. */
function headshotMul(a: Arrow): number {
  return a.who !== null ? HEADSHOT_MUL : ENEMY_HEADSHOT_MUL;
}

/** Clamps a human's aim to AIM_MIN..AIM_MAX, mirrored around vertical for an archer facing left (angles near PI). */
export function clampAim(angle: number, facing: 1 | -1): number {
  if (facing === 1) return clamp(normalizeAngle(angle), AIM_MIN, AIM_MAX);
  return Math.PI - clamp(normalizeAngle(Math.PI - angle), AIM_MIN, AIM_MAX);
}

export function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
