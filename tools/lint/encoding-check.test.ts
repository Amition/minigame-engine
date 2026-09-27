import { describe, expect, it } from 'vitest';
import { checkEncoding, codeSegments, findInvalidUtf8, isEncodingCandidate, mangledRuns, mojibakeRuns } from './encoding-check';

// Damaged samples are built from escapes so this file itself passes `pnpm lint:encoding`.
const Q2 = '?'.repeat(2);
const utf8 = (s: string) => new TextEncoder().encode(s);
const rules = (path: string, src: string | Uint8Array) =>
  checkEncoding(path, typeof src === 'string' ? utf8(src) : src).map((i) => `${i.rule}@${i.line}:${i.column}`);

describe('encoding check: bytes', () => {
  it('flags a BOM and nothing else in a clean file', () => {
    expect(rules('a.ts', new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('export const a = 1;\n')]))).toEqual(['bom@1:1']);
    expect(rules('a.ts', 'export const a = "\u5f00\u59cb";\n')).toEqual([]);
  });

  it('finds invalid UTF-8 with line and byte column (GBK bytes, overlong, surrogates)', () => {
    const gbk = new Uint8Array([...utf8('const a = 1;\nconst t = "'), 0xbf, 0xaa, 0xca, 0xbc, ...utf8('";\n')]);
    expect(rules('a.ts', gbk)).toEqual(['invalid-utf8@2:12']);
    expect(findInvalidUtf8(new Uint8Array([0xc0, 0x80]))).toHaveLength(1);
    expect(findInvalidUtf8(new Uint8Array([0xed, 0xa0, 0x80]))).toHaveLength(1);
    expect(findInvalidUtf8(new Uint8Array([0xf0, 0x9f, 0x98, 0x80, 0xe5, 0xbc, 0x80]))).toEqual([]);
    expect(findInvalidUtf8(new Uint8Array([0xe5, 0xbc]))).toHaveLength(1);
  });

  it('flags U+FFFD', () => {
    expect(rules('a.md', '# ok\nbroken \uFFFD text\n')).toEqual(['replacement-char@2:8']);
  });
});

describe('encoding check: mangled CJK', () => {
  it('flags runs of ? in string literals and comments of code files', () => {
    expect(rules('a.ts', `const s = '${Q2} 2';\n`)).toEqual(['mangled-cjk@1:12']);
    expect(rules('a.ts', `ui.button({ text: "\u2190 ${Q2}" });\n`)).toEqual(['mangled-cjk@1:22']);
    expect(rules('a.ts', `// ${Q2}${Q2}\nconst a = 1;\n`)).toEqual(['mangled-cjk@1:4']);
    expect(rules('a.json', `{ "title": "233${Q2}" }\n`)).toEqual(['mangled-cjk@1:16']);
  });

  it('ignores the ?? operator, regex quantifiers and English punctuation', () => {
    const src = [
      `const a = b ${Q2} c;`,
      `x ${Q2}= 1;`,
      `const t = \`\${a ${Q2} 'x'} and \${ {k: 1}.k }\`;`,
      `const r = /['"]${Q2}x/g.test(s) ? 'y' : "n";`,
      `const q = 'Really${Q2}';`,
      `// falls back with a ${Q2} b`,
      `const n = (m ${Q2} 0) / 2; const s2 = "ok";`,
    ].join('\n');
    expect(rules('a.ts', src)).toEqual([]);
  });

  it('finds damage inside template text but not inside ${...}', () => {
    expect(rules('a.ts', `const t = \`\${a ${Q2} b} ${Q2}\`;\n`)).toEqual(['mangled-cjk@1:22']);
    expect(rules('a.ts', `const t = \`line one\n  ${Q2} two\`;\n`)).toEqual(['mangled-cjk@2:3']);
  });

  it('uses line-based rules for text files', () => {
    expect(rules('README.md', `# 233${Q2}\n\nWhy${Q2} Use \`${Q2}\` or \`a ${Q2} b\`.\n`)).toEqual(['mangled-cjk@1:6']);
    expect(rules('index.html', `<title>${Q2}</title>\n`)).toEqual(['mangled-cjk@1:8']);
    expect(mangledRuns(`${Q2}${Q2} ok`)).toEqual([0]);
  });
});

describe('encoding check: mojibake', () => {
  it('flags UTF-8 decoded as CP1252 or GBK, not real accented text', () => {
    expect(mojibakeRuns('\u00e5\u00bc\u20ac\u00e5\u00a7\u2039')).toEqual([0, 3]);
    expect(mojibakeRuns('caf\u00c3\u00a9')).toEqual([3]);
    expect(mojibakeRuns('\u5bee\u20ac\u6fee')).toEqual([0]);
    expect(mojibakeRuns('caf\u00e9 na\u00efve \u00a9 2026 \u20ac5 \u5f00\u59cb')).toEqual([]);
    expect(rules('a.ts', `const s = '\u00e5\u00bc\u20ac';\n`)).toEqual(['mojibake@1:12']);
  });
});

describe('encoding check: helpers', () => {
  it('splits code into string and comment segments with positions', () => {
    const segs = codeSegments(`/* a\n b */ const x = "s1"; // c\nconst y = \`t\${1}u\`;\n`);
    expect(segs.map((s) => [s.kind, s.text, s.line, s.column])).toEqual([
      ['comment', ' a', 1, 3],
      ['comment', ' b ', 2, 1],
      ['string', 's1', 2, 18],
      ['comment', ' c', 2, 25],
      ['string', 't', 3, 12],
      ['string', 'u', 3, 17],
    ]);
  });

  it('selects text files outside node_modules/dist/.shots', () => {
    expect(isEncodingCandidate('engine/core/game.ts')).toBe(true);
    expect(isEncodingCandidate('.agents/skills/x/SKILL.md')).toBe(true);
    expect(isEncodingCandidate('game/assets/audio/manifest.json')).toBe(true);
    expect(isEncodingCandidate('node_modules/x/index.ts')).toBe(false);
    expect(isEncodingCandidate('dist/web/game.js')).toBe(false);
    expect(isEncodingCandidate('.shots/a.png')).toBe(false);
    expect(isEncodingCandidate('game/assets/a.mp3')).toBe(false);
  });
});
