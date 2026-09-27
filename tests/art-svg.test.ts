import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  parseColor,
  parsePathData,
  parseSvg,
  parseSvgTransform,
  setPlatform,
  svgPath,
  svgPathBounds,
  svgSize,
  svgTexture,
  textures,
  type Ctx2D,
  type Surface,
  type SvgMatrix,
  type Texture,
} from '@engine';
import { HeadlessPlatform } from '@engine/testing';

beforeAll(() => setPlatform(new HeadlessPlatform()));
afterAll(() => setPlatform(null));

function pixel(tex: Texture, x: number, y: number): number[] {
  const s = tex.source as Surface;
  return [...s.getContext('2d').getImageData(tex.frame.x + x, tex.frame.y + y, 1, 1).data];
}

const apply = (m: SvgMatrix, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function expectClose(actual: readonly number[], expected: readonly number[], digits = 6): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, digits));
}

function expectRect(r: { x: number; y: number; w: number; h: number }, x: number, y: number, w: number, h: number): void {
  expectClose([r.x, r.y, r.w, r.h], [x, y, w, h], 3);
}

describe('svg path data', () => {
  it('normalizes every absolute command', () => {
    expect(parsePathData('M10 20 L30 40 H50 V60 C1 2 3 4 5 6 S7 8 9 10 Q11 12 13 14 T15 16 Z')).toEqual([
      ['M', 10, 20],
      ['L', 30, 40],
      ['L', 50, 40],
      ['L', 50, 60],
      ['C', 1, 2, 3, 4, 5, 6],
      ['C', 7, 8, 7, 8, 9, 10],
      ['Q', 11, 12, 13, 14],
      ['Q', 15, 16, 15, 16],
      ['Z'],
    ]);
  });

  it('uses the current point as control for S/T without a preceding curve', () => {
    expect(parsePathData('M0 0 S10 10 20 0')).toEqual([['M', 0, 0], ['C', 0, 0, 10, 10, 20, 0]]);
    expect(parsePathData('M0 0 T10 0')).toEqual([['M', 0, 0], ['Q', 0, 0, 10, 0]]);
  });

  it('resolves relative commands and returns to the subpath start after z', () => {
    expect(parsePathData('m10 10 l5 0 h5 v5 c0 5 5 5 5 0 s5 -5 5 0 q2 2 4 0 t4 0 z m2 2 l1 1')).toEqual([
      ['M', 10, 10],
      ['L', 15, 10],
      ['L', 20, 10],
      ['L', 20, 15],
      ['C', 20, 20, 25, 20, 25, 15],
      ['C', 25, 10, 30, 10, 30, 15],
      ['Q', 32, 17, 34, 15],
      ['Q', 36, 13, 38, 15],
      ['Z'],
      ['M', 12, 12],
      ['L', 13, 13],
    ]);
  });

  it('handles implicit command repeats (moveto repeats become lineto)', () => {
    expect(parsePathData('M0 0 10 0 10 10')).toEqual([['M', 0, 0], ['L', 10, 0], ['L', 10, 10]]);
    expect(parsePathData('m1 1 2 0 0 2')).toEqual([['M', 1, 1], ['L', 3, 1], ['L', 3, 3]]);
    expect(parsePathData('M0 0 L1 1 2 2 H5 6')).toEqual([['M', 0, 0], ['L', 1, 1], ['L', 2, 2], ['L', 5, 2], ['L', 6, 2]]);
    expect(parsePathData('M0 0 C1 1 2 2 3 3 4 4 5 5 6 6')).toEqual([
      ['M', 0, 0],
      ['C', 1, 1, 2, 2, 3, 3],
      ['C', 4, 4, 5, 5, 6, 6],
    ]);
  });

  it('parses compact numbers, exponents and commas', () => {
    expect(parsePathData('M.5.5-1e1-2')).toEqual([['M', 0.5, 0.5], ['L', -10, -2]]);
    expect(parsePathData('M1e2,2E-1,+3,-.5')).toEqual([['M', 100, 0.2], ['L', 3, -0.5]]);
  });

  it('converts arcs to cubics that end exactly on the target point', () => {
    const up = parsePathData('M0 0 A10 10 0 0 1 20 0');
    expect(up.map((c) => c[0])).toEqual(['M', 'C', 'C']);
    expect(up[up.length - 1]!.slice(-2)).toEqual([20, 0]);
    expectRect(svgPathBounds(up), 0, -10, 20, 10);
    const down = parsePathData('M0 0 A10 10 0 0 0 20 0');
    expectRect(svgPathBounds(down), 0, 0, 20, 10);
  });

  it('honours the large-arc flag, packed flags, radius scaling, zero radii and rotation', () => {
    expect(parsePathData('M0 0 A10 10 0 0 1 10 10').filter((c) => c[0] === 'C')).toHaveLength(1);
    const large = parsePathData('M0 0 A10 10 0 1 1 10 10');
    expect(large.filter((c) => c[0] === 'C')).toHaveLength(3);
    expect(large[large.length - 1]!.slice(-2)).toEqual([10, 10]);
    expect(parsePathData('M0 0a10 10 0 0120 0')).toEqual(parsePathData('M0 0 a10 10 0 0 1 20 0'));
    expectRect(svgPathBounds(parsePathData('M0 0 A1 1 0 0 1 20 0')), 0, -10, 20, 10);
    expect(parsePathData('M0 0 A0 5 0 0 1 20 0')).toEqual([['M', 0, 0], ['L', 20, 0]]);
    expectRect(svgPathBounds(parsePathData('M0 0 A20 10 90 0 1 0 40')), 0, 0, 10, 40);
  });

  it('keeps everything before a syntax error, like browsers', () => {
    expect(parsePathData('M0 0 L10 10 L oops')).toEqual([['M', 0, 0], ['L', 10, 10]]);
    expect(parsePathData('M0 0 L10')).toEqual([['M', 0, 0]]);
    expect(parsePathData('M0 0 A5 5 0 2 1 10 0')).toEqual([['M', 0, 0]]);
    expect(parsePathData('')).toEqual([]);
  });

  it('computes exact bounds including curve extrema', () => {
    expectRect(svgPathBounds(parsePathData('M0 0 C0 -10 10 -10 10 0')), 0, -7.5, 10, 7.5);
    expectRect(svgPathBounds(parsePathData('M0 0 Q5 10 10 0')), 0, 0, 10, 5);
    expectRect(svgPathBounds([]), 0, 0, 0, 0);
  });

  it('svgPath issues canvas path commands (Path2D replacement)', () => {
    const calls: string[] = [];
    const ctx = new Proxy({}, {
      get: (_t, k) => (...a: number[]) => calls.push(`${String(k)}(${a.join(',')})`),
    }) as unknown as Ctx2D;
    svgPath(ctx, 'M0 0 L10 0 Q10 10 0 10 C0 5 0 5 0 0 Z');
    expect(calls).toEqual([
      'moveTo(0,0)',
      'lineTo(10,0)',
      'quadraticCurveTo(10,10,0,10)',
      'bezierCurveTo(0,5,0,5,0,0)',
      'closePath()',
    ]);
  });
});

describe('svg transforms', () => {
  it('parses each transform function', () => {
    expect(parseSvgTransform('translate(10 20)')).toEqual([1, 0, 0, 1, 10, 20]);
    expect(parseSvgTransform('translate(5)')).toEqual([1, 0, 0, 1, 5, 0]);
    expect(parseSvgTransform('scale(2)')).toEqual([2, 0, 0, 2, 0, 0]);
    expect(parseSvgTransform('scale(2,3)')).toEqual([2, 0, 0, 3, 0, 0]);
    expect(parseSvgTransform('matrix(1 2 3 4 5 6)')).toEqual([1, 2, 3, 4, 5, 6]);
    expectClose(apply(parseSvgTransform('rotate(90)')!, 1, 0), [0, 1]);
    expectClose(apply(parseSvgTransform('skewX(45)')!, 0, 10), [10, 10]);
    expectClose(apply(parseSvgTransform('skewY(45)')!, 10, 0), [10, 10]);
  });

  it('rotates around a centre and composes lists left to right', () => {
    const r = parseSvgTransform('rotate(90 10 10)')!;
    expectClose(apply(r, 20, 10), [10, 20]);
    expectClose(apply(r, 10, 10), [10, 10]);
    expectClose(apply(parseSvgTransform('translate(10,0) scale(2)')!, 1, 1), [12, 2]);
    expectClose(apply(parseSvgTransform('scale(2) translate(10,0)')!, 1, 1), [22, 2]);
  });

  it('returns null for empty or unknown transforms', () => {
    expect(parseSvgTransform('')).toBeNull();
    expect(parseSvgTransform(undefined)).toBeNull();
    expect(parseSvgTransform('perspective(3)')).toBeNull();
  });
});

describe('svg documents', () => {
  it('reads size and viewBox', () => {
    const a = parseSvg('<svg viewBox="0 0 24 12" width="48"></svg>');
    expect([a.width, a.height]).toEqual([48, 24]);
    expect(a.viewBox).toEqual({ x: 0, y: 0, w: 24, h: 12 });
    const b = parseSvg('<svg width="30" height="20"/>');
    expect(b.viewBox).toEqual({ x: 0, y: 0, w: 30, h: 20 });
    expect(svgSize(a, undefined, 6)).toEqual({ width: 12, height: 6 });
  });

  it('converts basic shapes to path geometry', () => {
    const doc = parseSvg(`<?xml version="1.0"?><!DOCTYPE svg>
      <svg viewBox="0 0 100 100"><!-- comment -->
        <rect id="r" x="1" y="2" width="10" height="5"/>
        <rect id="rr" x="0" y="0" width="20" height="10" rx="2"/>
        <circle id="c" cx="5" cy="5" r="4"/>
        <ellipse id="e" cx="10" cy="10" rx="6" ry="3"/>
        <line id="l" x1="1" y1="2" x2="3" y2="4"/>
        <polyline id="pl" points="0,0 10,0 10,10"/>
        <polygon id="pg" points="0 0 10 0 10 10"/>
      </svg>`);
    const path = (id: string) => doc.ids.get(id)!.path!;
    expect(path('r')).toEqual([['M', 1, 2], ['L', 11, 2], ['L', 11, 7], ['L', 1, 7], ['Z']]);
    expect(path('rr')[0]).toEqual(['M', 2, 0]);
    expectRect(svgPathBounds(path('rr')), 0, 0, 20, 10);
    expectRect(svgPathBounds(path('c')), 1, 1, 8, 8);
    expectRect(svgPathBounds(path('e')), 4, 7, 12, 6);
    expect(path('l')).toEqual([['M', 1, 2], ['L', 3, 4]]);
    const last = (id: string) => path(id)[path(id).length - 1];
    expect(last('pl')).toEqual(['L', 10, 10]);
    expect(last('pg')).toEqual(['Z']);
  });

  it('merges presentation attributes, <style> rules and inline style (in that order)', () => {
    const doc = parseSvg(`<svg viewBox="0 0 10 10">
      <style>.a { fill: red } rect#x.a { stroke-width: 3 }</style>
      <rect id="x" class="a" fill="green" stroke="black" style="stroke: blue" width="5" height="5"/>
    </svg>`);
    const p = doc.ids.get('x')!.props;
    expect(p.fill).toBe('red');
    expect(p.stroke).toBe('blue');
    expect(p['stroke-width']).toBe('3');
  });

  it('decodes entities and reports unsupported features', () => {
    const doc = parseSvg('<svg viewBox="0 0 10 10"><mask id="m"/><text id="t">A &amp; B</text><rect mask="url(#m)"/></svg>');
    expect(doc.ids.get('t')!.text).toBe('A & B');
    expect(doc.warnings).toContain('<mask>');
    expect(doc.warnings).toContain('mask attribute');
    expect(() => parseSvg('<div></div>')).toThrow(/no <svg>/);
  });

  it('resolves gradients: stops, units, href inheritance, transforms', () => {
    const doc = parseSvg(`<svg viewBox="0 0 100 100" xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs>
        <linearGradient id="base" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="red"/>
          <stop offset="50%" stop-color="#00ff00" stop-opacity="0.5"/>
          <stop offset="0.3" style="stop-color: blue"/>
        </linearGradient>
        <linearGradient id="child" xlink:href="#base" x2="1" y2="0" gradientUnits="userSpaceOnUse"
                        gradientTransform="rotate(90)"/>
        <radialGradient id="rad" cx="30%" cy="40%" r="0.5" fx="20%"><stop offset="1" stop-color="gold"/></radialGradient>
      </defs>
      <rect width="100" height="100" fill="url(#child)"/>
    </svg>`);
    const base = doc.gradients.get('base')!;
    expect(base.type).toBe('linear');
    expect(base.units).toBe('objectBoundingBox');
    expect([base.x1, base.y1, base.x2, base.y2]).toEqual([0, 0, 0, 1]);
    expect(base.stops.map((s) => s.offset)).toEqual([0, 0.5, 0.5]);
    expect(base.stops.map((s) => parseColor(s.color))).toEqual([
      { r: 255, g: 0, b: 0, a: 1 },
      { r: 0, g: 255, b: 0, a: 0.5 },
      { r: 0, g: 0, b: 255, a: 1 },
    ]);

    const child = doc.gradients.get('child')!;
    expect(child.units).toBe('userSpaceOnUse');
    expect(child.stops).toEqual(base.stops);
    expect([child.x1, child.y1, child.x2, child.y2]).toEqual([0, 0, 1, 0]);
    expectClose(child.transform!, [0, 1, -1, 0, 0, 0]);

    const rad = doc.gradients.get('rad')!;
    expect(rad.type).toBe('radial');
    expectClose([rad.cx, rad.cy, rad.r, rad.fx, rad.fy], [0.3, 0.4, 0.5, 0.2, 0.4]);
    expect(rad.stops).toHaveLength(1);
  });
});

describe('svg rendering', () => {
  const svg = (body: string, vb = '0 0 10 10') => `<svg viewBox="${vb}">${body}</svg>`;

  it('bakes shapes with fills, opacity and currentColor', () => {
    const tex = svgTexture(svg('<rect width="10" height="5" fill="#ff0000"/><rect y="5" width="10" height="5" fill="#000" opacity="0.5"/>'), { width: 20 });
    expect([tex.width, tex.height]).toEqual([20, 20]);
    expect(pixel(tex, 10, 4)).toEqual([255, 0, 0, 255]);
    expect(pixel(tex, 10, 15)[3]).toBeGreaterThan(120);
    expect(pixel(tex, 10, 15)[3]).toBeLessThan(135);
    const cc = svgTexture(svg('<circle cx="5" cy="5" r="5" fill="currentColor"/>'), { width: 20, color: '#00ff00' });
    expect(pixel(cc, 10, 10)).toEqual([0, 255, 0, 255]);
    expect(pixel(cc, 0, 0)[3]).toBe(0);
  });

  it('applies group transforms and <use href>', () => {
    const g = svgTexture(svg('<g transform="translate(5 0)"><rect width="5" height="10" fill="#0000ff"/></g>'), { width: 20 });
    expect(pixel(g, 5, 10)[3]).toBe(0);
    expect(pixel(g, 15, 10)).toEqual([0, 0, 255, 255]);
    const u = svgTexture(
      svg('<defs><rect id="r" width="5" height="10" fill="#00ff00"/></defs><use href="#r" x="5"/>'),
      { width: 20 },
    );
    expect(pixel(u, 5, 10)[3]).toBe(0);
    expect(pixel(u, 15, 10)).toEqual([0, 255, 0, 255]);
  });

  it('respects fill-rule evenodd and viewBox letterboxing', () => {
    const d = 'M0 0h10v10H0z M3 3h4v4H3z';
    const eo = svgTexture(svg(`<path fill-rule="evenodd" d="${d}"/>`), { width: 20 });
    expect(pixel(eo, 10, 10)[3]).toBe(0);
    expect(pixel(eo, 2, 2)[3]).toBe(255);
    const nz = svgTexture(svg(`<path d="${d}"/>`), { width: 20 });
    expect(pixel(nz, 10, 10)[3]).toBe(255);
    const box = svgTexture(svg('<rect width="20" height="10" fill="#f00"/>', '0 0 20 10'), { width: 20, height: 20 });
    expect(pixel(box, 10, 2)[3]).toBe(0);
    expect(pixel(box, 10, 10)).toEqual([255, 0, 0, 255]);
  });

  it('maps objectBoundingBox gradients onto the shape', () => {
    const grad = '<defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs>';
    const tex = svgTexture(svg(`${grad}<rect x="5" width="5" height="10" fill="url(#g)"/>`), { width: 40 });
    const left = pixel(tex, 21, 20);
    const right = pixel(tex, 38, 20);
    expect(pixel(tex, 10, 20)[3]).toBe(0);
    expect(left[0]).toBeGreaterThan(200);
    expect(left[2]).toBeLessThan(60);
    expect(right[2]).toBeGreaterThan(200);
    expect(right[0]).toBeLessThan(60);
  });

  it('caches textures by markup + size and registers keys', () => {
    const m = svg('<rect width="10" height="10" fill="gold"/>');
    const a = svgTexture(m, { width: 16 });
    expect(svgTexture(m, { width: 16 })).toBe(a);
    expect(svgTexture(m, { width: 32 })).not.toBe(a);
    const k = svgTexture(m, { width: 16, key: 'test:gold' });
    expect(textures.get('test:gold')).toBe(k);
  });
});
