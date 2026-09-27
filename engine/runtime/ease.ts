export type EaseFn = (t: number) => number;
type EaseFamily = 'quad' | 'cubic' | 'quart' | 'quint' | 'sine' | 'expo' | 'circ' | 'back' | 'elastic' | 'bounce';
/** 'linear' or a family with In/Out/InOut, e.g. 'quadOut', 'backOut', 'elasticInOut'. */
export type EaseName = 'linear' | `${EaseFamily}${'In' | 'Out' | 'InOut'}`;
/** An easing name or a custom function mapping 0..1 → 0..1 (may overshoot). */
export type Ease = EaseName | EaseFn;

const BACK = 1.70158;
const ELASTIC = (2 * Math.PI) / 3;

function bounceOut(t: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

const ins: Record<EaseFamily, EaseFn> = {
  quad: (t) => t * t,
  cubic: (t) => t * t * t,
  quart: (t) => t * t * t * t,
  quint: (t) => t * t * t * t * t,
  sine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  expo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  circ: (t) => 1 - Math.sqrt(1 - t * t),
  back: (t) => (BACK + 1) * t * t * t - BACK * t * t,
  elastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * ELASTIC)),
  bounce: (t) => 1 - bounceOut(1 - t),
};

const exact =
  (f: EaseFn): EaseFn =>
  (t) =>
    t <= 0 ? 0 : t >= 1 ? 1 : f(t);

function buildEasings(): Record<EaseName, EaseFn> {
  const out = { linear: exact((t) => t) } as Record<EaseName, EaseFn>;
  for (const [name, fin] of Object.entries(ins) as [EaseFamily, EaseFn][]) {
    out[`${name}In`] = exact(fin);
    out[`${name}Out`] = exact((t) => 1 - fin(1 - t));
    out[`${name}InOut`] = exact((t) => (t < 0.5 ? fin(2 * t) / 2 : 1 - fin(2 - 2 * t) / 2));
  }
  return out;
}

/** Every named easing. Endpoints are exact: f(0) = 0, f(1) = 1. */
export const easings: Readonly<Record<EaseName, EaseFn>> = buildEasings();

/** Resolves an easing name or function (default 'quadOut'). */
export function getEase(e: Ease | undefined, fallback: EaseName = 'quadOut'): EaseFn {
  if (typeof e === 'function') return e;
  const f = easings[e ?? fallback];
  if (!f) throw new Error(`unknown easing "${e}" (use ${Object.keys(easings).join(', ')})`);
  return f;
}
