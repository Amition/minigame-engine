import type { Node } from './node';

interface AttrTest {
  key: string;
  op: '=' | '*=' | '^=' | 'exists';
  value: string;
}

interface Compound {
  kind: string | null;
  id: string | null;
  tags: string[];
  attrs: AttrTest[];
}

/** Compounds from left to right; `combinators[i]` joins compound i and i+1. */
export interface SelectorChain {
  compounds: Compound[];
  combinators: (' ' | '>')[];
}

const cache = new Map<string, SelectorChain>();

export function parseSelector(sel: string): SelectorChain {
  const hit = cache.get(sel);
  if (hit) return hit;
  const compounds: Compound[] = [];
  const combinators: (' ' | '>')[] = [];
  let i = 0;
  const s = sel.trim();
  let pendingComb: ' ' | '>' | null = null;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === ' ' || ch === '>') {
      if (ch === '>') pendingComb = '>';
      else if (pendingComb === null) pendingComb = ' ';
      i++;
      continue;
    }
    if (compounds.length > 0) combinators.push(pendingComb ?? ' ');
    pendingComb = null;
    const c: Compound = { kind: null, id: null, tags: [], attrs: [] };
    while (i < s.length && s[i] !== ' ' && s[i] !== '>') {
      const t = s[i]!;
      if (t === '#' || t === '.') {
        i++;
        const start = i;
        while (i < s.length && /[\w\-\u00c0-\uffff]/.test(s[i]!)) i++;
        const name = s.slice(start, i);
        if (t === '#') c.id = name;
        else c.tags.push(name);
      } else if (t === '[') {
        const end = s.indexOf(']', i);
        if (end < 0) throw new Error(`bad selector "${sel}": missing ]`);
        const body = s.slice(i + 1, end);
        i = end + 1;
        const m = /^([\w-]+)\s*(\*=|\^=|=)?\s*(.*)$/.exec(body);
        if (!m) throw new Error(`bad selector "${sel}": [${body}]`);
        const raw = (m[3] ?? '').trim().replace(/^["']|["']$/g, '');
        c.attrs.push({ key: m[1]!, op: (m[2] as AttrTest['op']) ?? 'exists', value: raw });
      } else if (t === '*') {
        i++;
      } else {
        const start = i;
        while (i < s.length && /[\w-]/.test(s[i]!)) i++;
        if (start === i) throw new Error(`bad selector "${sel}" at ${i}`);
        c.kind = s.slice(start, i);
      }
    }
    compounds.push(c);
  }
  const chain = { compounds, combinators };
  cache.set(sel, chain);
  return chain;
}

function attrValue(n: Node, key: string): unknown {
  switch (key) {
    case 'id':
      return n.id;
    case 'kind':
      return n.kind;
    case 'visible':
      return n.visible;
    case 'interactive':
      return n.interactive;
    default:
      return n.describe()[key];
  }
}

function matchCompound(n: Node, c: Compound): boolean {
  if (c.kind && n.kind !== c.kind) return false;
  if (c.id && n.id !== c.id) return false;
  for (const t of c.tags) if (!n.tags.has(t)) return false;
  for (const a of c.attrs) {
    const v = attrValue(n, a.key);
    if (a.op === 'exists') {
      if (v === undefined || v === '' || v === false) return false;
      continue;
    }
    if (v === undefined) return false;
    const sv = String(v);
    if (a.op === '=' && sv !== a.value) return false;
    if (a.op === '*=' && !sv.includes(a.value)) return false;
    if (a.op === '^=' && !sv.startsWith(a.value)) return false;
  }
  return true;
}

/** Matches `n` against the chain; ancestors are searched up to (not including) `scope`. */
export function matchesSelector(n: Node, chain: SelectorChain, scope: Node | null): boolean {
  const { compounds, combinators } = chain;
  if (compounds.length === 0) return false;
  return matchFrom(n, compounds.length - 1, compounds, combinators, scope);
}

function matchFrom(
  n: Node,
  idx: number,
  compounds: Compound[],
  combinators: (' ' | '>')[],
  scope: Node | null,
): boolean {
  if (!matchCompound(n, compounds[idx]!)) return false;
  if (idx === 0) return true;
  const comb = combinators[idx - 1]!;
  let p = n.parent;
  if (comb === '>') return !!p && p !== scope && matchFrom(p, idx - 1, compounds, combinators, scope);
  while (p && p !== scope) {
    if (matchFrom(p, idx - 1, compounds, combinators, scope)) return true;
    p = p.parent;
  }
  return false;
}
