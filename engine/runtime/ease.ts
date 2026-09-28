export type EaseFn = (t: number) => number;
type EaseFamily = 'quad' | 'cubic' | 'quart' | 'quint' | 'sine' | 'expo' | 'circ' | 'back' | 'elastic' | 'bounce';
/** 'linear' or a family with In/Out/InOut, e.g. 'quadOut', 'backOut', 'elasticInOut'. */
export type EaseName = 'linear' | `${EaseFamily}${'In' | 'Out' | 'InOut'}`;
/** An easing name or a custom function mapping 0..1 → 0..1 (may overshoot). */
export type Ease = EaseName | EaseFn;

const BACK = 1.70158;
const BACK1 = BACK + 1;
const ELASTIC = (2 * Math.PI) / 3;
const HALF_PI = Math.PI / 2;

function bounce(t: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

// One flat function per easing (no wrapper closures: every extra call boxes the double it returns). Out and InOut
// forms are In mirrored: out(t) = 1 - in(1 - t), inOut(t) = in(2t) / 2 below 0.5, else 1 - in(2 - 2t) / 2.
// Endpoints are exact: t <= 0 → 0, t >= 1 → 1.

/** Every named easing. Endpoints are exact: f(0) = 0, f(1) = 1. */
export const easings: Readonly<Record<EaseName, EaseFn>> = {
  linear: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t),

  quadIn: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t),
  quadOut: (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const u = 1 - t;
    return 1 - u * u;
  },
  quadInOut: (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const u = t < 0.5 ? 2 * t : 2 - 2 * t;
    return t < 0.5 ? (u * u) / 2 : 1 - (u * u) / 2;
  },

  cubicIn: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t),
  cubicOut: (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const u = 1 - t;
    return 1 - u * u * u;
  },
  cubicInOut: (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const u = t < 0.5 ? 2 * t : 2 - 2 * t;
    return t < 0.5 ? (u * u * u) / 2 : 1 - (u * u * u) / 2;
  },

  quartIn: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * t),
  quartOut: (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const u = 1 - t;
    return 1 - u * u * u * u;
  },
  quartInOut: (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const u = t < 0.5 ? 2 * t : 2 - 2 * t;
    return t < 0.5 ? (u * u * u * u) / 2 : 1 - (u * u * u * u) / 2;
  },

  quintIn: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * t * t),
  quintOut: (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const u = 1 - t;
    return 1 - u * u * u * u * u;
  },
  quintInOut: (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const u = t < 0.5 ? 2 * t : 2 - 2 * t;
    return t < 0.5 ? (u * u * u * u * u) / 2 : 1 - (u * u * u * u * u) / 2;
  },

  sineIn: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.cos(t * HALF_PI)),
  sineOut: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : Math.sin(t * HALF_PI)),
  sineInOut: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : (1 - Math.cos(t * Math.PI)) / 2),

  expoIn: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, 10 * t - 10)),
  expoOut: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(2, 10 * (1 - t) - 10)),
  expoInOut: (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : 1 - Math.pow(2, 10 * (2 - 2 * t) - 10) / 2;
  },

  circIn: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.sqrt(1 - t * t)),
  circOut: (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const u = 1 - t;
    return Math.sqrt(1 - u * u);
  },
  circInOut: (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const u = t < 0.5 ? 2 * t : 2 - 2 * t;
    const c = 1 - Math.sqrt(1 - u * u);
    return t < 0.5 ? c / 2 : 1 - c / 2;
  },

  backIn: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : BACK1 * t * t * t - BACK * t * t),
  backOut: (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const u = 1 - t;
    return 1 - (BACK1 * u * u * u - BACK * u * u);
  },
  backInOut: (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const u = t < 0.5 ? 2 * t : 2 - 2 * t;
    const b = BACK1 * u * u * u - BACK * u * u;
    return t < 0.5 ? b / 2 : 1 - b / 2;
  },

  elasticIn: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * ELASTIC)),
  elasticOut: (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const u = 1 - t;
    // 1 - t rounds to 1 for tiny t: in(1) is exactly 1 there.
    return u === 1 ? 0 : 1 + Math.pow(2, 10 * u - 10) * Math.sin((u * 10 - 10.75) * ELASTIC);
  },
  elasticInOut: (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    if (t < 0.5) {
      const u = 2 * t;
      return (-Math.pow(2, 10 * u - 10) * Math.sin((u * 10 - 10.75) * ELASTIC)) / 2;
    }
    const u = 2 - 2 * t;
    return u === 1 ? 0.5 : 1 + (Math.pow(2, 10 * u - 10) * Math.sin((u * 10 - 10.75) * ELASTIC)) / 2;
  },

  bounceIn: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - bounce(1 - t)),
  bounceOut: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : bounce(t)),
  bounceInOut: (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t < 0.5 ? (1 - bounce(1 - 2 * t)) / 2 : (1 + bounce(2 * t - 1)) / 2;
  },
};

/** Resolves an easing name or function (default 'quadOut'). */
export function getEase(e: Ease | undefined, fallback: EaseName = 'quadOut'): EaseFn {
  if (typeof e === 'function') return e;
  const f = easings[e ?? fallback];
  if (!f) throw new Error(`unknown easing "${e}" (use ${Object.keys(easings).join(', ')})`);
  return f;
}
