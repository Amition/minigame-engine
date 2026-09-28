import { afterEach, describe, expect, it } from 'vitest';
import {
  clearTextBitmaps,
  fontString,
  layoutText,
  Node,
  setTextBitmapBudget,
  Text,
  textBitmapStats,
  textMeasurer,
  textStyleFont,
  textureStats,
  tokenize,
  wrapText,
  type Ctx2D,
  type TextStyle,
} from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
  clearTextBitmaps();
  setTextBitmapBudget(1_500_000);
});

// The regex implementation before the fast paths: results must stay identical.
const CJK = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/;
const NO_LINE_START = /^[\uff0c\u3002\uff01\uff1f\u3001\uff1b\uff1a\uff09\u300d\u300f\u3011\u300b\u3009\u201d\u2019\u2026,.!?;:)\]}%]$/;
const NO_LINE_END = /^[\uff08\u300c\u300e\u3010\u300a\u3008\u201c\u2018(\[{]$/;
function refTokenize(text: string): string[] {
  const raw: string[] = [];
  let word = '';
  for (const ch of text) {
    if (ch === ' ' || ch === '\t') {
      if (word) raw.push(word);
      word = '';
      raw.push(ch);
    } else if (CJK.test(ch) || NO_LINE_START.test(ch) || NO_LINE_END.test(ch)) {
      if (word) raw.push(word);
      word = '';
      raw.push(ch);
    } else word += ch;
  }
  if (word) raw.push(word);
  const out: string[] = [];
  let carry = '';
  for (const tk of raw) {
    if (NO_LINE_START.test(tk) && out.length > 0 && !carry) out[out.length - 1] += tk;
    else if (NO_LINE_END.test(tk)) carry += tk;
    else {
      out.push(carry + tk);
      carry = '';
    }
  }
  if (carry) out.push(carry);
  return out;
}
function refWrap(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    if (maxWidth <= 0) {
      lines.push(para);
      continue;
    }
    let line = '';
    for (const tok of refTokenize(para)) {
      const candidate = line + tok;
      if (line === '' || measure(candidate) <= maxWidth) {
        if (line === '' && measure(tok) > maxWidth) {
          for (const ch of tok) {
            if (line !== '' && measure(line + ch) > maxWidth) {
              lines.push(line);
              line = '';
            }
            line += ch;
          }
        } else line = candidate;
      } else {
        lines.push(line.replace(/\s+$/, ''));
        line = tok.trim() === '' ? '' : tok;
      }
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines;
}

const SAMPLES = [
  '',
  '   ',
  'hello big world',
  'Hello, world! (test) [x] {y} 100% done; ok: yes?',
  '\u4e00\u4e8c\u4e09\u56db\uff0c\u4e94\u516d\u3002\u4e03\u516b\uff01',
  '\u300c\u4f60\u597d\u300d\u4ed6\u8bf4\uff1a\u201c\u5f00\u59cb\u6e38\u620f\u201d\u2026\u2026\u597d\u7684\u3002',
  '\uff08\u6ce8\u610f\uff09\u8fde\u7eed\u70b9\u51fb\u300a\u6309\u94ae\u300b\u83b7\u53d6\u3010\u5956\u52b1\u3011\u3001\u91d1\u5e01',
  'Mixed \u4e2d\u6587 and English \u6df7\u6392, with (\u62ec\u53f7) and "quotes".',
  'tabs\there\tand  double  spaces   end   ',
  'emoji \ud83c\udf49\ud83c\udf49 and \ud840\udc00 astral \ud83d\ude00!',
  'Supercalifragilisticexpialidocious-and-more-and-more-words',
  '\ud55c\uad6d\uc5b4 \ud14d\uc2a4\ud2b8\ub3c4 \uc904\ubc14\uafc8, \ud14c\uc2a4\ud2b8.',
  'line one\nline two is longer\n\n\u7b2c\u56db\u884c\uff0c\u7ed3\u675f\u3002',
  '\u3000\u5168\u89d2\u7a7a\u683c\u3000\u5f00\u5934 nbsp\u00a0inside',
  '((((nested)))) ,,, ... !!! \u201c\u201c\u2018x\u2019\u201d\u201d',
];

describe('tokenize / wrapText', () => {
  const fake = (s: string) => [...s].length * 10;
  const varying = (s: string) => {
    let w = 0;
    for (const ch of s) w += ch.charCodeAt(0) > 0x2e80 ? 20 : ch === ' ' ? 5 : ch === 'm' || ch === 'W' ? 14 : 9;
    return w;
  };

  it('matches the previous regex tokenizer', () => {
    for (const s of SAMPLES) expect(tokenize(s), s).toEqual(refTokenize(s));
  });

  it('matches the previous greedy wrapping at many widths', () => {
    for (const s of SAMPLES) {
      for (const w of [0, 1, 15, 25, 40, 60, 90, 130, 200, 400, 10000]) {
        expect(wrapText(s, w, fake), `${s} @${w}`).toEqual(refWrap(s, w, fake));
        expect(wrapText(s, w, varying), `${s} @${w} varying`).toEqual(refWrap(s, w, varying));
      }
    }
  });

  it('keeps CJK line-break rules', () => {
    expect(wrapText('\u4e00\u4e8c\u4e09\u56db\uff0c\u4e94\u516d', 40, fake)).toEqual(['\u4e00\u4e8c\u4e09', '\u56db\uff0c\u4e94\u516d']);
    // an opening bracket never ends a line, a closing one never starts one
    expect(wrapText('\u4e00\u4e8c\u4e09\u300c\u56db\u4e94\u300d\u516d', 40, fake)).toEqual(['\u4e00\u4e8c\u4e09', '\u300c\u56db\u4e94\u300d', '\u516d']);
    expect(wrapText('\u4e00\u4e8c\u300c\u56db\u300d\u4e94\u516d', 40, fake)).toEqual(['\u4e00\u4e8c', '\u300c\u56db\u300d\u4e94', '\u516d']);
    expect(wrapText('\u4e00\u4e8c\u4e09\u56db\u3002\u3002\u4e94', 40, fake)).toEqual(['\u4e00\u4e8c\u4e09', '\u56db\u3002\u3002\u4e94']);
    expect(tokenize('\u201c\u5f00\u59cb\u201d')).toEqual(['\u201c\u5f00', '\u59cb\u201d']);
    expect(tokenize('a (b) c')).toEqual(['a', ' ', '(b)', ' ', 'c']);
    // surrogate pairs stay inside their word and are never split by truncation
    expect(tokenize('go\ud83c\udf49go now')).toEqual(['go\ud83c\udf49go', ' ', 'now']);
  });

  it('cuts with an ellipsis on whole code points', async () => {
    t = await createTestGame({ render: 'none' });
    const label = new Text('\ud83c\udf49\ud83c\udf49\ud83c\udf49\ud83c\udf49\ud83c\udf49\ud83c\udf49 melon melon melon', { wrapWidth: 90, maxLines: 1 });
    expect(label.truncated).toBe(true);
    const line = label.lines[0]!;
    expect(line.endsWith('\u2026')).toBe(true);
    expect(/[\ud800-\udbff]\u2026$/.test(line)).toBe(false);
  });
});

describe('font string cache', () => {
  it('caches per style object and follows field changes', () => {
    const st = { fontStyle: 'normal' as const, fontWeight: 'bold' as const, fontSize: 28, fontFamily: 'sans-serif' };
    expect(textStyleFont(st)).toBe(fontString(st));
    expect(textStyleFont(st, 20)).toBe('bold 20px sans-serif');
    const mutable = { ...st } as { fontStyle: 'normal' | 'italic'; fontWeight: 'bold' | number; fontSize: number; fontFamily: string };
    textStyleFont(mutable);
    mutable.fontStyle = 'italic';
    mutable.fontWeight = 600;
    expect(textStyleFont(mutable)).toBe('italic 600 28px sans-serif');
  });

  it('returns one measurer per font', async () => {
    t = await createTestGame({ render: 'none' });
    expect(textMeasurer('bold 30px sans-serif')).toBe(textMeasurer('bold 30px sans-serif'));
    expect(textMeasurer('bold 30px sans-serif')('abc')).toBeGreaterThan(0);
  });

  it('draws with the new font after setStyle and autoFit', async () => {
    t = await createTestGame({ render: 'none' });
    const fonts: string[] = [];
    const ctx = recordingCtx(fonts);
    const label = new Text('Score 100', { fontSize: 30, cache: 'none' });
    label.draw(ctx);
    label.setStyle({ fontWeight: 'bold' });
    label.draw(ctx);
    label.autoFit(40, { minSize: 12 });
    label.draw(ctx);
    expect(fonts[0]).toContain('normal 30px');
    expect(fonts[1]).toContain('bold 30px');
    expect(label.fontSize).toBeLessThan(30);
    expect(fonts[2]).toContain(`bold ${label.fontSize}px`);
  });
});

describe('measurement memo', () => {
  it('memoizes per text and style and invalidates on change', async () => {
    t = await createTestGame({ render: 'none' });
    const label = new Text('Hello there general', { fontSize: 30 });
    const nat = label.measureNatural();
    expect(label.measureNatural()).toBe(nat);
    const w200 = label.measureWrapped(200);
    expect(label.measureWrapped(200)).toBe(w200);
    const min = label.minContentWidth();
    expect(nat.width).toBe(Math.ceil(layoutText('Hello there general', label.style as TextStyle, 0).contentWidth));
    expect(w200.lines).toBe(layoutText('Hello there general', label.style as TextStyle, 200).lines.length);

    // paint-only and wrap-width changes keep measurements
    label.setStyle({ color: '#ff0000', stroke: { color: '#000', width: 4 } });
    label.setStyle({ wrapWidth: 200 });
    expect(label.measureNatural()).toBe(nat);
    expect(label.lines.length).toBe(w200.lines);

    // text change
    label.text = 'Hello there generalissimo Kenobi';
    const nat2 = label.measureNatural();
    expect(nat2).not.toBe(nat);
    expect(nat2.width).toBeGreaterThan(nat.width);
    expect(label.minContentWidth()).toBeGreaterThan(min);

    // font change
    label.setStyle({ fontSize: 40 });
    const nat3 = label.measureNatural();
    expect(nat3.width).toBeGreaterThan(nat2.width);
    expect(nat3.height).toBeGreaterThan(nat2.height);
    expect(label.measureContentWidth()).toBeCloseTo(layoutText(label.text, label.style as TextStyle).contentWidth);

    // equal values are free: same style object, no relayout
    const style = label.style;
    label.setStyle({ fontSize: 40, stroke: { color: '#000', width: 4 } });
    expect(label.style).toBe(style);
  });

  it('keeps lines, truncated and fontSize in sync with layoutText', async () => {
    t = await createTestGame({ render: 'none' });
    const label = new Text('A very long label that cannot fit on one line', { wrapWidth: 200, maxLines: 1 });
    const ref = layoutText(label.text, label.style as TextStyle);
    expect(label.lines).toEqual(ref.lines);
    expect(label.truncated).toBe(true);
    expect(label.lines[0]!.endsWith('\u2026')).toBe(true);
    label.setStyle({ maxLines: 0 });
    expect(label.truncated).toBe(false);
    expect(label.lines.length).toBeGreaterThan(1);
    expect(label.describe()).toMatchObject({ text: label.text, size: 28, lines: label.lines.length });
  });
});

/** A context that records the font of every fillText. */
function recordingCtx(fonts: string[]): Ctx2D {
  let font = '';
  const noop = () => {};
  return {
    set font(v: string) {
      font = v;
    },
    get font() {
      return font;
    },
    fillText: () => fonts.push(font),
    strokeText: noop,
    drawImage: noop,
  } as unknown as Ctx2D;
}

function pixels(tg: TestGame): Uint8ClampedArray {
  const c = tg.platform.canvas;
  return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
}

function diffCount(a: Uint8ClampedArray, b: Uint8ClampedArray, threshold = 8): { diff: number; ink: number } {
  let diff = 0;
  let ink = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i + 1]! - b[i + 1]!), Math.abs(a[i + 2]! - b[i + 2]!), Math.abs(a[i + 3]! - b[i + 3]!));
    if (d > threshold) diff++;
    if (a[i]! + a[i + 1]! + a[i + 2]! > 150) ink++;
  }
  return { diff, ink };
}

describe('bitmap cache', () => {
  const stroked: Partial<TextStyle> = { fontSize: 40, fontWeight: 'bold', color: '#ffe066', stroke: { color: '#5b2bb5', width: 6 } };

  async function compareModes(device: string | undefined, pixelRatio: number | undefined, build: (layer: Node) => Text[], threshold = 8) {
    t = await createTestGame({ render: 'none', ...(device ? { device } : {}), ...(pixelRatio ? { pixelRatio } : {}) });
    t.game.background = '#10131c';
    const layer = t.game.sceneLayer.add(new Node({ width: 750, height: 1334 }));
    const texts = build(layer);
    for (const x of texts) x.setStyle({ cache: 'none' });
    t.game.render();
    const direct = pixels(t);
    const before = textBitmapStats().bakes;
    for (const x of texts) x.setStyle({ cache: 'bitmap' });
    t.game.render();
    const cached = pixels(t);
    expect(textBitmapStats().bakes - before).toBeGreaterThan(0);
    return diffCount(direct, cached, threshold);
  }

  it('places a stroked, shadowed label like fillText (fractional position, all aligns, several lines)', async () => {
    for (const [device, pr] of [
      ['iphone-14', undefined],
      ['iphone-se', 1],
      ['ipad', undefined],
    ] as const) {
      const r = await compareModes(device, pr, (layer) => [
        layer.add(new Text('Level 12 \u5b8c\u6210\uff01', stroked, { x: 40.37, y: 60.61 })),
        layer.add(new Text('Center\nTwo lines', { ...stroked, align: 'center', wrapWidth: 300 }, { x: 100.5, y: 260.2 })),
        layer.add(new Text('Right', { ...stroked, align: 'right', wrapWidth: 260, shadow: { color: 'rgba(0,0,0,0.6)', blur: 6, y: 4 } }, { x: 80.25, y: 460.8 })),
        layer.add(new Text('Plain small caption text', { fontSize: 24, color: '#cbd5e1' }, { x: 33.3, y: 620.45 })),
      ]);
      expect(r.ink).toBeGreaterThan(2000);
      expect(r.diff / r.ink, `${device}: ${r.diff} of ${r.ink}`).toBeLessThan(0.002);
      t!.destroy();
      t = null;
      clearTextBitmaps();
    }
  });

  it('bakes at the accumulated parent scale; rotated text stays close', async () => {
    const zoomed = await compareModes(undefined, undefined, (layer) => {
      const scaled = layer.add(new Node({ x: 100.3, y: 100.7, scale: 1.7 }));
      return [scaled.add(new Node({ scaleX: 1.2, scaleY: 1.2 })).add(new Text('Zoomed', stroked))];
    });
    expect(zoomed.diff / zoomed.ink).toBeLessThan(0.002);
    t!.destroy();
    t = null;
    const tilted = await compareModes(
      undefined,
      undefined,
      (layer) => [layer.add(new Node({ x: 300, y: 700, rotation: 0.3 })).add(new Text('Tilted', stroked))],
      64,
    );
    // a rotated blit resamples every edge a little; no strong differences ('auto' bakes it only when decorated)
    expect(tilted.diff / tilted.ink).toBeLessThan(0.03);
  });

  it('places the bitmap with offsets a parent applies while rendering (camera, pressed button)', async () => {
    class Shifted extends Node {
      protected override renderChildren(ctx: Ctx2D): void {
        this.renderChildrenOffset(ctx, 12.37, 8.61);
      }
    }
    const r = await compareModes(undefined, undefined, (layer) => [
      layer.add(new Shifted({ x: 40.2, y: 90.4 })).add(new Text('Offset \u5b8c\u6210', stroked)),
      layer.add(new Shifted({ x: 60.5, y: 300.3, scale: 1.25 })).add(new Text('Scaled offset', { fontSize: 30, color: '#e2e8f0' })),
    ]);
    expect(r.ink).toBeGreaterThan(1000);
    expect(r.diff / r.ink, `${r.diff} of ${r.ink}`).toBeLessThan(0.002);
  });

  it("'auto' draws rotated plain text directly", async () => {
    t = await createTestGame({ render: 'every' });
    t.game.sceneLayer.add(new Node({ x: 100, y: 100, rotation: 0.2 })).add(new Text('Plain tilted', { fontSize: 30 }));
    t.game.sceneLayer.add(new Node({ x: 100, y: 300, rotation: 0.2 })).add(new Text('Stroked tilted', stroked));
    await t.step(40);
    expect(textBitmapStats().count).toBe(1);
  });

  it('shares identical bitmaps with a refcount and frees them on text change and destroy', async () => {
    t = await createTestGame({ render: 'none', pixelRatio: 1, config: { design: { width: 390, height: 844 } } });
    const style = { ...stroked, cache: 'bitmap' as const };
    const a = t.game.sceneLayer.add(new Text('Shared', style, { x: 10, y: 10 }));
    const b = t.game.sceneLayer.add(new Text('Shared', style, { x: 10, y: 110 }));
    t.game.render();
    const s1 = textBitmapStats();
    expect(s1.count).toBe(1);
    expect(s1.shared).toBeGreaterThan(0);
    expect(textureStats({ top: 100 }).top.filter((e) => e.key.startsWith('text:Shared'))).toHaveLength(1);

    b.text = 'Other';
    t.game.render();
    expect(textBitmapStats().count).toBe(2);
    a.destroy();
    expect(textBitmapStats().count).toBe(1);
    expect(textureStats({ top: 100 }).top.some((e) => e.key.startsWith('text:Shared'))).toBe(false);
    b.destroy();
    expect(textBitmapStats()).toMatchObject({ count: 0, pixels: 0 });
  });

  it("'none' never bakes and 'auto' bakes decorated or quiet text but not counters", async () => {
    t = await createTestGame({ render: 'every' });
    const layer = t.game.sceneLayer;
    const none = layer.add(new Text('No cache', { ...stroked, cache: 'none' }, { x: 20, y: 20 }));
    await t.step(40);
    expect(textBitmapStats().count).toBe(0);
    none.destroy();

    const title = layer.add(new Text('Title', stroked, { x: 20, y: 100 }));
    const plain = layer.add(new Text('Plain', { fontSize: 30 }, { x: 20, y: 200 }));
    const counter = layer.add(new Text('0', stroked, { x: 20, y: 300 }));
    let n = 0;
    counter.onUpdate(() => (counter.text = String(++n)));
    await t.step(2);
    expect(textBitmapStats().count).toBe(1); // title only: plain waits for ~30 quiet frames, counter changes
    await t.step(40);
    expect(textBitmapStats().count).toBe(2); // + plain
    title.text = 'Title 2';
    plain.text = 'Plain 2';
    await t.step(1);
    expect(textBitmapStats().count).toBe(1); // stroked title re-baked at once, plain waits again
    counter.destroy();
  });

  it('falls back to direct drawing when the budget is full', async () => {
    t = await createTestGame({ render: 'none' });
    setTextBitmapBudget(1000);
    const label = t.game.sceneLayer.add(new Text('Too big for the budget', { ...stroked, cache: 'bitmap' }, { x: 20, y: 20 }));
    t.game.render();
    expect(textBitmapStats().count).toBe(0);
    expect(label.lines).toHaveLength(1);
    const px = pixels(t);
    let ink = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i]! > 200) ink++;
    expect(ink).toBeGreaterThan(100);
  });

  it('re-bakes at the new resolution once a scale animation settles', async () => {
    t = await createTestGame({ render: 'every' });
    const holder = t.game.sceneLayer.add(new Node({ x: 50, y: 50, scale: 0.5 }));
    holder.add(new Text('Pop', { ...stroked, cache: 'bitmap' }));
    await t.step(1);
    const bakes0 = textBitmapStats().bakes;
    const popHeight = () => textureStats({ top: 100 }).top.find((e) => e.key.startsWith('text:Pop'))!.height;
    const h0 = popHeight();
    for (let i = 0; i < 12; i++) {
      holder.scaleX = holder.scaleY = 0.5 + (i + 1) * 0.05;
      await t.step(1);
    }
    const during = textBitmapStats().bakes - bakes0;
    expect(during).toBeGreaterThan(0);
    expect(during).toBeLessThanOrEqual(3);
    await t.step(8);
    expect(textBitmapStats().count).toBe(1);
    // the settled bitmap follows the final scale (1.1 vs 0.5 at the first bake)
    const ratio = popHeight() / h0;
    expect(ratio).toBeGreaterThan(2);
    expect(ratio).toBeLessThan(2.4);
  });

  it('re-bakes at once when the text moved while it was not drawn (sparse rendering, shots)', async () => {
    t = await createTestGame({ render: 'none' });
    t.game.background = '#10131c';
    const label = t.game.sceneLayer.add(new Text('Moved 100', { ...stroked, cache: 'bitmap' }, { x: 40.8, y: 60.3 }));
    t.game.render();
    label.x = 97.35;
    label.y = 140.62;
    await t.step(10);
    t.game.render();
    const cached = pixels(t);
    label.setStyle({ cache: 'none' });
    t.game.render();
    const r = diffCount(pixels(t), cached);
    expect(r.ink).toBeGreaterThan(500);
    expect(r.diff / r.ink, `${r.diff} of ${r.ink}`).toBeLessThan(0.002);
  });
});
