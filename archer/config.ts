/**
 * 布偶弓箭手 (Ragdoll Archers) shared data contract: upgrades, arrow types, apples, colours and the derived player
 * stats. Every other file imports from here; ids, names and signatures are frozen. Only the lead edits this file.
 */

// ---------------------------------------------------------------- colours

export const COLORS = {
  /** Scene background (dark grey void). */
  bg: '#3b3b3d',
  /** Floating dust specks. */
  dust: '#5c5c60',
  dustLight: '#8d8d92',
  /** Figures (player and enemies are the same white stick men). */
  figure: '#f4f4f4',
  figureShade: '#cfcfd4',
  bow: '#f5a623',
  bowDark: '#c77c0e',
  bowString: '#e9e9e9',
  /** Player tower stone. */
  stone: '#8e8e93',
  stoneLight: '#a2a2a7',
  stoneDark: '#707075',
  /** Enemy floating block. */
  block: '#6d6d72',
  blockLight: '#7f7f84',
  hp: '#e5484d',
  stamina: '#4a8ff0',
  barTrack: '#2a2a2d',
  /** Upgrade label colours (red = survival, blue = stamina, orange = offence). */
  labelRed: '#f25555',
  labelBlue: '#5b9ef5',
  labelOrange: '#f5a623',
  /** Light menu buttons with dark text. */
  button: '#e4e4e7',
  buttonText: '#2f2f33',
  /** Arrow list cards. */
  card: '#f2f2f4',
  cardLocked: '#9c9ca1',
  cardTrial: '#f5b82e',
  text: '#ffffff',
  textDim: '#b8b8bd',
  /** Hit sparks / blood specks (the original uses orange dots). */
  spark: '#f5a623',
  heal: '#57d163',
  poison: '#7ed957',
  electric: '#7fd4ff',
} as const;

// ---------------------------------------------------------------- upgrades

export type UpgradeId = 'armor' | 'hp' | 'lives' | 'stamina' | 'regen' | 'drawSpeed' | 'damage' | 'slots';
export type LabelColor = 'red' | 'blue' | 'orange';

export interface UpgradeDef {
  id: UpgradeId;
  /** Chinese display name. */
  name: string;
  color: LabelColor;
  /** Bonus per level as shown in the menu ("+25"). */
  step: number;
  /** Cost of the first level in skulls; level n costs round(baseCost * growth^n). */
  baseCost: number;
  growth: number;
  /** Highest level (undefined = unlimited). */
  max?: number;
}

/** Menu order (top to bottom), as in the original. */
export const UPGRADES: readonly UpgradeDef[] = [
  { id: 'armor', name: '护甲', color: 'red', step: 1, baseCost: 10, growth: 2 },
  { id: 'hp', name: '生命', color: 'red', step: 25, baseCost: 10, growth: 2 },
  { id: 'lives', name: '生命数', color: 'red', step: 1, baseCost: 100, growth: 10, max: 3 },
  { id: 'stamina', name: '体力', color: 'blue', step: 25, baseCost: 10, growth: 2 },
  { id: 'regen', name: '体力恢复', color: 'blue', step: 0.1, baseCost: 10, growth: 2 },
  { id: 'drawSpeed', name: '拉弓速度', color: 'orange', step: 1, baseCost: 10, growth: 2 },
  { id: 'damage', name: '伤害', color: 'orange', step: 6, baseCost: 10, growth: 2.5 },
  { id: 'slots', name: '箭矢槽', color: 'orange', step: 1, baseCost: 50, growth: 10, max: 3 },
];

export type UpgradeLevels = Record<UpgradeId, number>;

export const NO_UPGRADES: UpgradeLevels = {
  armor: 0,
  hp: 0,
  lives: 0,
  stamina: 0,
  regen: 0,
  drawSpeed: 0,
  damage: 0,
  slots: 0,
};

export function upgrade(id: UpgradeId): UpgradeDef {
  const u = UPGRADES.find((d) => d.id === id);
  if (!u) throw new Error(`no upgrade "${id}"`);
  return u;
}

/** Skulls needed to buy the next level from `level`; Infinity when maxed. */
export function upgradeCost(id: UpgradeId, level: number): number {
  const u = upgrade(id);
  if (u.max !== undefined && level >= u.max) return Infinity;
  return Math.round(u.baseCost * Math.pow(u.growth, level));
}

/** Total bonus text for the menu: "+0", "+25", "+0.3". */
export function upgradeBonusText(id: UpgradeId, level: number): string {
  const v = upgrade(id).step * level;
  return `+${Math.round(v * 10) / 10}`;
}

export interface PlayerStats {
  maxHp: number;
  /** Armor points; see damageTaken(). */
  armor: number;
  /** Total lives per run (1 = no spare life). */
  lives: number;
  maxStamina: number;
  /** Stamina regained per second. */
  regen: number;
  /** Seconds from an empty to a fully drawn bow. */
  drawTime: number;
  /** Damage of a fully drawn normal arrow body hit (arrow multipliers, draw power and headshots scale it). */
  damage: number;
  /** Arrow types carried into a run (the normal arrow counts). */
  slots: number;
}

export function playerStats(levels: UpgradeLevels): PlayerStats {
  return {
    maxHp: 100 + 25 * levels.hp,
    armor: levels.armor,
    lives: 1 + levels.lives,
    maxStamina: 100 + 25 * levels.stamina,
    regen: 14 * (1 + 0.1 * levels.regen),
    drawTime: 0.9 / (1 + 0.15 * levels.drawSpeed),
    damage: 30 + 6 * levels.damage,
    slots: 2 + levels.slots,
  };
}

/** Damage after armor: each point removes a diminishing share (10 armor = half damage). */
export function damageTaken(raw: number, armor: number): number {
  return raw * (1 - armor / (armor + 10));
}

/** Stamina costs. */
export const SHOT_COST = 10;
export const JUMP_COST = 5;

// ---------------------------------------------------------------- arrows

export type ArrowId =
  | 'normal'
  | 'electric'
  | 'poison'
  | 'balloon'
  | 'explosive'
  | 'axe'
  | 'split'
  | 'chainsaw'
  | 'vampire'
  | 'missile';

export interface ArrowDef {
  id: ArrowId;
  /** Chinese display name. */
  name: string;
  /** One-line effect description (menu). */
  desc: string;
  /** Unlock price in skulls; 0 = owned from the start. */
  cost: number;
  /** Can be tried for one run by watching a rewarded ad (单次体验). */
  trial: boolean;
  /** Multiplier on PlayerStats.damage. */
  damageMul: number;
  /** Art accents: shaft, head (tip) and fletching colours. */
  shaft: string;
  head: string;
  fletch: string;
}

/** Menu order (top to bottom). */
export const ARROWS: readonly ArrowDef[] = [
  { id: 'normal', name: '普通箭', desc: '基础箭矢', cost: 0, trial: false, damageMul: 1, shaft: '#b98a55', head: '#9a9aa0', fletch: '#e5484d' },
  { id: 'electric', name: '电击箭', desc: '命中后麻痹敌人', cost: 100, trial: false, damageMul: 0.9, shaft: '#4b5563', head: '#7fd4ff', fletch: '#3b82f6' },
  { id: 'poison', name: '毒箭', desc: '命中后持续中毒掉血', cost: 120, trial: false, damageMul: 0.7, shaft: '#4d7c3a', head: '#7ed957', fletch: '#a3e635' },
  { id: 'balloon', name: '气球箭', desc: '挂上气球把敌人吊走', cost: 150, trial: false, damageMul: 0.5, shaft: '#d4a373', head: '#ff6b9a', fletch: '#ffd166' },
  { id: 'explosive', name: '爆破箭', desc: '命中后爆炸，范围伤害', cost: 170, trial: false, damageMul: 1.4, shaft: '#3f3f46', head: '#ef4444', fletch: '#f97316' },
  { id: 'axe', name: '斧头箭', desc: '沉重旋转，伤害翻倍', cost: 190, trial: false, damageMul: 2, shaft: '#8b5a2b', head: '#c0c4cc', fletch: '#6b7280' },
  { id: 'split', name: '分裂箭', desc: '飞行中一分为三', cost: 220, trial: true, damageMul: 0.8, shaft: '#a16207', head: '#facc15', fletch: '#22d3ee' },
  { id: 'chainsaw', name: '电锯箭', desc: '贯穿身体，连续切割', cost: 250, trial: false, damageMul: 1.2, shaft: '#52525b', head: '#d4d4d8', fletch: '#f97316' },
  { id: 'vampire', name: '吸血箭', desc: '伤害的一半回复生命', cost: 280, trial: true, damageMul: 1, shaft: '#7f1d1d', head: '#dc2626', fletch: '#991b1b' },
  { id: 'missile', name: '导弹箭', desc: '自动追踪敌人', cost: 320, trial: false, damageMul: 1.3, shaft: '#e5e7eb', head: '#ef4444', fletch: '#3b82f6' },
];

export function arrowDef(id: ArrowId): ArrowDef {
  const a = ARROWS.find((d) => d.id === id);
  if (!a) throw new Error(`no arrow "${id}"`);
  return a;
}

// ---------------------------------------------------------------- apples

export type AppleKind = 'red' | 'green' | 'gold';

export interface AppleDef {
  kind: AppleKind;
  name: string;
  hp: number;
  stamina: number;
  /** Spawn weight. */
  weight: number;
  color: string;
}

/** 红苹果 = 生命值, 绿苹果 = 体力值, 金苹果 = 生命值 + 体力值. */
export const APPLES: readonly AppleDef[] = [
  { kind: 'red', name: '红苹果', hp: 30, stamina: 0, weight: 45, color: '#e5484d' },
  { kind: 'green', name: '绿苹果', hp: 0, stamina: 50, weight: 40, color: '#7ed957' },
  { kind: 'gold', name: '金苹果', hp: 30, stamina: 50, weight: 15, color: '#f5c542' },
];

export function appleDef(kind: AppleKind): AppleDef {
  const a = APPLES.find((d) => d.kind === kind);
  if (!a) throw new Error(`no apple "${kind}"`);
  return a;
}

// ---------------------------------------------------------------- economy

/** Skulls a fresh save starts with (a demo build: enough to try a few upgrades and arrows). */
export const START_SKULLS = 500;
/** Skulls granted by the menu's rewarded-ad button. */
export const AD_SKULLS = 100;
