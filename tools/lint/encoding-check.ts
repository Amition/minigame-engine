// Detects encoding damage in source/text files (pure functions; the CLI is tools/lint/encoding.ts).
// Typical damage on Windows: PowerShell 5 writing a BOM or the ANSI code page (GBK bytes = invalid UTF-8),
// an editor turning every CJK character into a question mark, or UTF-8 read as CP1252/GBK and saved again (mojibake).

export type EncodingRule = 'bom' | 'invalid-utf8' | 'replacement-char' | 'mangled-cjk' | 'mojibake';

export interface EncodingIssue {
  rule: EncodingRule;
  /** 1-based line. */
  line: number;
  /** 1-based column (UTF-16 units; bytes for invalid-utf8). */
  column: number;
  message: string;
}

/** Extensions the lint checks. */
export const ENCODING_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.html', '.css', '.yaml', '.yml'];

const CODE_EXT = /\.(ts|tsx|js|mjs|cjs|json)$/i;
const MAX_PER_RULE = 20;

export function isEncodingCandidate(path: string): boolean {
  const p = path.replace(/\\/g, '/');
  if (/(^|\/)(node_modules|dist|\.shots|\.git)\//.test(p)) return false;
  const dot = p.lastIndexOf('.');
  return dot >= 0 && ENCODING_EXTENSIONS.includes(p.slice(dot).toLowerCase());
}

// ---------------------------------------------------------------- bytes

/** Byte offsets (with line/column) of invalid UTF-8 sequences; at most one per line. */
export function findInvalidUtf8(b: Uint8Array): { line: number; column: number }[] {
  const out: { line: number; column: number }[] = [];
  let line = 1;
  let lineStart = 0;
  let lastLine = 0;
  const cont = (i: number, lo = 0x80, hi = 0xbf) => i < b.length && b[i]! >= lo && b[i]! <= hi;
  for (let i = 0; i < b.length; ) {
    const c = b[i]!;
    if (c === 0x0a) {
      line++;
      lineStart = ++i;
      continue;
    }
    let n = 0;
    if (c < 0x80) n = 1;
    else if (c >= 0xc2 && c <= 0xdf) n = cont(i + 1) ? 2 : 0;
    else if (c >= 0xe0 && c <= 0xef) {
      const lo = c === 0xe0 ? 0xa0 : 0x80;
      const hi = c === 0xed ? 0x9f : 0xbf;
      n = cont(i + 1, lo, hi) && cont(i + 2) ? 3 : 0;
    } else if (c >= 0xf0 && c <= 0xf4) {
      const lo = c === 0xf0 ? 0x90 : 0x80;
      const hi = c === 0xf4 ? 0x8f : 0xbf;
      n = cont(i + 1, lo, hi) && cont(i + 2) && cont(i + 3) ? 4 : 0;
    }
    if (n === 0) {
      if (line !== lastLine && out.length < MAX_PER_RULE) out.push({ line, column: i - lineStart + 1 });
      lastLine = line;
      i++;
    } else i += n;
  }
  return out;
}

// ---------------------------------------------------------------- text segments

/** A string literal or comment of a code file: `text` is its content, starting at line/column. */
export interface TextSegment {
  kind: 'string' | 'comment';
  text: string;
  line: number;
  column: number;
}

const REGEX_AFTER = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_AFTER_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await']);

/**
 * Splits TS/JS/JSON source into string-literal and comment segments (template literals: only the text parts,
 * `${...}` is code). One segment per line, so multi-line comments/templates keep accurate line numbers.
 * Approximate (regex literals are recognised by the preceding token), which is enough for a lint.
 */
export function codeSegments(src: string): TextSegment[] {
  const segs: TextSegment[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  let prev = '';
  let word = '';
  /** Brace depth of each open `${` (innermost last). */
  const templates: number[] = [];
  let seg: TextSegment | null = null;

  const open = (kind: TextSegment['kind']) => {
    seg = { kind, text: '', line, column: i - lineStart + 1 };
  };
  const close = () => {
    if (seg && seg.text !== '') segs.push(seg);
    seg = null;
  };
  const newline = (kind: TextSegment['kind'] | null) => {
    close();
    line++;
    i++;
    lineStart = i;
    if (kind) open(kind);
  };

  /** Scans template text from i (after ` or }) until the closing ` or a ${. */
  const templateText = () => {
    open('string');
    while (i < src.length) {
      const ch = src[i]!;
      if (ch === '\\') {
        seg!.text += src.slice(i, i + 2);
        if (src[i + 1] === '\n') {
          i++;
          newline('string');
        } else i += 2;
      } else if (ch === '`') {
        close();
        i++;
        prev = '`';
        return;
      } else if (ch === '$' && src[i + 1] === '{') {
        close();
        i += 2;
        templates.push(0);
        prev = '{';
        return;
      } else if (ch === '\n') newline('string');
      else {
        seg!.text += ch;
        i++;
      }
    }
    close();
  };

  while (i < src.length) {
    const ch = src[i]!;
    const next = src[i + 1];
    if (ch === '\n') {
      line++;
      i++;
      lineStart = i;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      i += 2;
      open('comment');
      while (i < src.length && src[i] !== '\n') seg!.text += src[i++];
      close();
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      open('comment');
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') newline('comment');
        else seg!.text += src[i++];
      }
      close();
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i++;
      open('string');
      while (i < src.length && src[i] !== ch && src[i] !== '\n') {
        if (src[i] === '\\') {
          seg!.text += src.slice(i, i + 2);
          i += 2;
        } else seg!.text += src[i++];
      }
      close();
      if (src[i] === ch) i++;
      prev = ch;
      word = '';
      continue;
    }
    if (ch === '`') {
      i++;
      templateText();
      word = '';
      continue;
    }
    if (ch === '/' && (REGEX_AFTER.has(prev) || REGEX_AFTER_WORDS.has(word))) {
      i++;
      let cls = false;
      while (i < src.length && src[i] !== '\n') {
        const c = src[i]!;
        if (c === '\\') i += 2;
        else {
          i++;
          if (c === '[') cls = true;
          else if (c === ']') cls = false;
          else if (c === '/' && !cls) break;
        }
      }
      while (i < src.length && /[a-z]/i.test(src[i]!)) i++;
      prev = '/';
      word = '';
      continue;
    }
    if (templates.length) {
      if (ch === '{') templates[templates.length - 1]!++;
      else if (ch === '}') {
        if (templates[templates.length - 1] === 0) {
          templates.pop();
          i++;
          templateText();
          word = '';
          continue;
        }
        templates[templates.length - 1]!--;
      }
    }
    if (/[\w$]/.test(ch)) {
      let j = i;
      while (j < src.length && /[\w$]/.test(src[j]!)) j++;
      word = src.slice(i, j);
      prev = 'a';
      i = j;
      continue;
    }
    prev = ch;
    word = '';
    i++;
  }
  return segs;
}

// ---------------------------------------------------------------- heuristics

const QMARKS = /\?{2,}/g;

/**
 * Runs of '?' that look like CJK turned into question marks: 2+ '?' not directly after a letter ('Really??' is
 * fine), not the `a ?? b` / `a ??= b` operator (operands on both sides) and not a lone `??` code span.
 */
export function mangledRuns(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(QMARKS)) {
    const at = m.index;
    const end = at + m[0].length;
    const before = text[at - 1] ?? '';
    const after = text[end] ?? '';
    if (/[A-Za-z]/.test(before)) continue;
    if (m[0].length === 2 && before === ' ' && /[^\s?]/.test(text[at - 2] ?? '')) {
      if (after === '=' || (after === ' ' && /[^\s?]/.test(text[end + 1] ?? ''))) continue;
    }
    if (before === '`' && after === '`') continue;
    out.push(at);
  }
  return out;
}

/** A UTF-8 continuation byte (0x80-0xBF) as shown by Latin-1 / Windows-1252. */
const C = '[\\u0080-\\u00BF\\u0152\\u0153\\u0160\\u0161\\u0178\\u017D\\u017E\\u0192\\u02C6\\u02DC\\u2013\\u2014\\u2018-\\u201A\\u201C-\\u201E\\u2020-\\u2022\\u2026\\u2030\\u2039\\u203A\\u20AC\\u2122]';
/**
 * UTF-8 bytes decoded as Windows-1252 (a CJK character becomes three Latin-1 letters starting with U+00E0..U+00EF,
 * U+00E9 becomes U+00C3 U+00A9) or as GBK (odd CJK characters next to U+20AC).
 */
const MOJIBAKE = new RegExp(`[\\u00E0-\\u00EF]${C}{2}|[\\u00F0-\\u00F4]${C}{3}|[\\u00C2\\u00C3]${C}|[\\u4E00-\\u9FFF]\\u20AC|\\u20AC[\\u4E00-\\u9FFF]`, 'g');

export function mojibakeRuns(text: string): number[] {
  return [...text.matchAll(MOJIBAKE)].map((m) => m.index);
}

// ---------------------------------------------------------------- file check

/** All encoding issues of one file (path decides code vs text heuristics). */
export function checkEncoding(path: string, bytes: Uint8Array): EncodingIssue[] {
  const issues: EncodingIssue[] = [];
  const counts = new Map<EncodingRule, number>();
  const add = (rule: EncodingRule, line: number, column: number, message: string) => {
    const n = counts.get(rule) ?? 0;
    counts.set(rule, n + 1);
    if (n < MAX_PER_RULE) issues.push({ rule, line, column, message });
  };

  let body = bytes;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    add('bom', 1, 1, 'UTF-8 BOM (write files without BOM; `pnpm lint:encoding --fix` strips it)');
    body = bytes.subarray(3);
  }
  const invalid = findInvalidUtf8(body);
  for (const p of invalid) add('invalid-utf8', p.line, p.column, 'invalid UTF-8 (file saved in a legacy code page such as GBK?)');
  const badLines = new Set(invalid.map((p) => p.line));

  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(body);
  const lines = text.split('\n');
  lines.forEach((l, idx) => {
    if (badLines.has(idx + 1)) return;
    const at = l.indexOf('\uFFFD');
    if (at >= 0) add('replacement-char', idx + 1, at + 1, 'U+FFFD replacement character (text was decoded with the wrong encoding)');
    for (const col of mojibakeRuns(l)) add('mojibake', idx + 1, col + 1, 'looks like UTF-8 decoded as CP1252/GBK (mojibake)');
  });

  const report = (line: number, column: number, where: string) =>
    add('mangled-cjk', line, column, `run of '?' in ${where}: CJK text replaced by question marks? (use \\u escapes if a tool mangles CJK)`);
  if (CODE_EXT.test(path)) {
    for (const s of codeSegments(text)) {
      if (badLines.has(s.line)) continue;
      for (const at of mangledRuns(s.text)) report(s.line, s.column + at, s.kind === 'string' ? 'a string literal' : 'a comment');
    }
  } else {
    lines.forEach((l, idx) => {
      if (badLines.has(idx + 1)) return;
      for (const at of mangledRuns(l)) report(idx + 1, at + 1, 'text');
    });
  }
  return issues.sort((a, b) => a.line - b.line || a.column - b.column);
}
