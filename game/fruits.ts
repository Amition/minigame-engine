/**
 * The 11 fruits of 合成大西瓜, smallest to largest. Two touching fruits of the same level merge into the next one.
 * Radii are in design units (the jar is JAR_WIDTH wide); physics bodies are exact circles of this radius.
 */
export interface FruitDef {
  level: number;
  key: string;
  /** Chinese display name. */
  name: string;
  radius: number;
  /** Dominant skin colour (UI accents, fallback art). */
  color: string;
  /** Juice / flesh colour for merge splashes. */
  juice: string;
  /** Points for creating this fruit by a merge. */
  points: number;
}

const defs: Omit<FruitDef, 'level' | 'points'>[] = [
  { key: 'grape', name: '葡萄', radius: 26, color: '#7b3fa0', juice: '#b77ad6' },
  { key: 'cherry', name: '樱桃', radius: 38, color: '#e0233c', juice: '#ff5a6e' },
  { key: 'orange', name: '橘子', radius: 52, color: '#ff8a1c', juice: '#ffb347' },
  { key: 'lemon', name: '柠檬', radius: 60, color: '#ffd92e', juice: '#fff07a' },
  { key: 'kiwi', name: '猕猴桃', radius: 76, color: '#8cc63f', juice: '#b6e36a' },
  { key: 'tomato', name: '西红柿', radius: 92, color: '#ef3b2c', juice: '#ff7a5c' },
  { key: 'peach', name: '桃子', radius: 104, color: '#ffa8a0', juice: '#ffd0c4' },
  { key: 'pineapple', name: '菠萝', radius: 124, color: '#f5c02a', juice: '#ffe270' },
  { key: 'coconut', name: '椰子', radius: 146, color: '#f3eee2', juice: '#ffffff' },
  { key: 'half-melon', name: '半个西瓜', radius: 170, color: '#f2545b', juice: '#ff8a8f' },
  { key: 'watermelon', name: '大西瓜', radius: 204, color: '#3aa845', juice: '#ff5c6c' },
];

export const FRUITS: readonly FruitDef[] = defs.map((d, level) => ({
  ...d,
  level,
  points: ((level + 1) * (level + 2)) / 2,
}));

export const MAX_LEVEL = FRUITS.length - 1;

/** Levels the dropper can hand out (grape .. kiwi). */
export const SPAWN_LEVELS = [0, 1, 2, 3, 4] as const;

/** Bonus for merging two watermelons (both vanish). */
export const WATERMELON_PAIR_BONUS = 100;

/**
 * Baked fruit textures are square, FRUIT_TEX_PAD * 2r wide, with the circle centred, so stems and leaves can stick
 * out past the physics circle. Sprites are placed at the fruit centre with anchor 0.5.
 */
export const FRUIT_TEX_PAD = 1.3;

/** Inner width of the jar in design units. */
export const JAR_WIDTH = 710;

export function fruit(level: number): FruitDef {
  const f = FRUITS[level];
  if (!f) throw new Error(`no fruit level ${level} (0..${MAX_LEVEL})`);
  return f;
}
