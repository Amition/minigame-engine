import type { Node } from './node';

export interface DumpOptions {
  /** Max depth below the root (default unlimited). */
  maxDepth?: number;
  /** Include the subtrees of hidden nodes (default false: shown as one "(hidden)" line). */
  showHidden?: boolean;
  /** Only print nodes for which this returns true (ancestors of matches are kept). */
  filter?: (n: Node) => boolean;
}

/**
 * Text outline of a node tree with stage-space bounds, so layouts can be checked without looking at pixels:
 *
 *     Scene#menu [0,0 750x1624]
 *       Text#title [175,200 400x60] text="Hello" size=48
 *       Box#play.button [225,700 300x96] interactive fill=#3b82f6
 *
 * Bounds are `[x,y wxh]` in stage (design) units; zero-size nodes print `@x,y` (their origin).
 * Flags: hidden, alpha=, interactive, clip, paused, z=.
 */
export function dumpTree(root: Node, opts: DumpOptions = {}): string {
  const lines: string[] = [];
  const keep = opts.filter ? collectKept(root, opts.filter) : null;
  const visit = (n: Node, depth: number) => {
    if (keep && !keep.has(n)) return;
    const indent = '  '.repeat(depth);
    const hidden = !n.visible || n.alpha <= 0;
    lines.push(indent + describeLine(n));
    if (hidden && !opts.showHidden) {
      if (n.children.length) lines.push(`${indent}  (${n.children.length} hidden children)`);
      return;
    }
    if (opts.maxDepth !== undefined && depth >= opts.maxDepth) {
      if (n.children.length) lines.push(`${indent}  (${n.children.length} children)`);
      return;
    }
    n.sortChildren();
    for (const c of n.children) visit(c, depth + 1);
  };
  visit(root, 0);
  return lines.join('\n');
}

/** One-line description of a node, as used by dumpTree. */
export function describeLine(n: Node): string {
  let s = n.kind;
  if (n.id) s += '#' + n.id;
  for (const t of n.tags) s += '.' + t;
  if (n.width > 0 || n.height > 0) {
    const b = n.worldBounds();
    s += ` [${r(b.x)},${r(b.y)} ${r(b.w)}x${r(b.h)}]`;
  } else {
    const p = n.toWorld(0, 0);
    s += ` @${r(p.x)},${r(p.y)}`;
  }
  const flags: string[] = [];
  if (!n.visible) flags.push('hidden');
  if (n.alpha < 1) flags.push(`alpha=${+n.alpha.toFixed(2)}`);
  if (n.interactive) flags.push('interactive');
  if (n.clip) flags.push('clip');
  if (n.paused) flags.push('paused');
  if (n.zIndex !== 0) flags.push(`z=${n.zIndex}`);
  if (n.rotation !== 0) flags.push(`rot=${+((n.rotation * 180) / Math.PI).toFixed(1)}°`);
  if (flags.length) s += ' ' + flags.join(' ');
  for (const [k, v] of Object.entries(n.describe())) {
    if (v === undefined || v === '') continue;
    s += ` ${k}=${typeof v === 'string' ? fmtStr(v) : typeof v === 'number' ? +v.toFixed(2) : v}`;
  }
  return s;
}

const r = (v: number) => Math.round(v);

function fmtStr(v: string): string {
  const one = v.replace(/\n/g, '\\n');
  const cut = one.length > 60 ? one.slice(0, 57) + '...' : one;
  return /[\s"=]/.test(cut) || cut === '' ? JSON.stringify(cut) : cut;
}

function collectKept(root: Node, filter: (n: Node) => boolean): Set<Node> {
  const keep = new Set<Node>();
  root.walk((n) => {
    if (filter(n)) for (let p: Node | null = n; p && !keep.has(p); p = p.parent) keep.add(p);
  });
  keep.add(root);
  return keep;
}
