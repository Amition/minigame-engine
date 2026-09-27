import { describe, expect, it } from 'vitest';
import { IsoMap, IsoObject, type Ctx2D } from '@engine';

/** Records fill calls (with the fillStyle at the time) and object draws. */
function recordingCtx(log: string[]): Ctx2D {
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, fillStyle: '#000' };
  return new Proxy(state, {
    get: (s, k) => {
      if (k in s) return s[k];
      if (k === 'fill') return () => log.push('fill:' + String(s.fillStyle));
      return () => undefined;
    },
    set: (s, k, v) => {
      s[k] = v;
      return true;
    },
  }) as unknown as Ctx2D;
}

class Marker extends IsoObject {
  constructor(
    readonly label: string,
    readonly log: string[],
  ) {
    super({ shadow: false });
  }
  override draw(): void {
    this.log.push('obj:' + this.label);
  }
}

describe('IsoMap projection', () => {
  const iso = new IsoMap({ cols: 6, rows: 4, tileWidth: 96, heights: [
    [0, 1, 2, 0, 0, 0],
    [0, 0, 0, 3, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 5],
  ] });

  it('uses a 2:1 diamond and round-trips iso <-> screen at any height', () => {
    expect(iso.tileHeight).toBe(48);
    const a = iso.isoToScreen(1, 0);
    const b = iso.isoToScreen(0, 0);
    expect(a.x - b.x).toBe(48);
    expect(a.y - b.y).toBe(24);
    for (const [ix, iy, z] of [
      [0.5, 0.5, 0],
      [3.2, 1.7, 2],
      [5.9, 3.1, 4.5],
    ] as const) {
      const s = iso.isoToScreen(ix, iy, z);
      const p = iso.screenToIso(s.x, s.y, z);
      expect(p.x).toBeCloseTo(ix, 9);
      expect(p.y).toBeCloseTo(iy, 9);
    }
  });

  it('fits the whole map (including the tallest block) in its content box', () => {
    expect(iso.isoToScreen(0, 4).x).toBeCloseTo(0);
    expect(iso.isoToScreen(6, 0).x).toBeCloseTo(iso.width);
    expect(iso.isoToScreen(0, 0, 5).y).toBeCloseTo(0);
    expect(iso.height).toBeCloseTo((6 + 4) * 24 + 5 * 24 + iso.baseDepth);
  });
});

describe('IsoMap picking', () => {
  it('picks the top face of the tapped tile', () => {
    const iso = new IsoMap({ cols: 4, rows: 4, heights: [
      [2, 1, 0, 1],
      [1, 1, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ] });
    for (let ty = 0; ty < 4; ty++) {
      for (let tx = 0; tx < 4; tx++) {
        const c = iso.tileTop(tx, ty);
        const pick = iso.pickTile(c.x, c.y)!;
        expect([pick.tx, pick.ty, pick.face]).toEqual([tx, ty, 'top']);
      }
    }
    expect(iso.pickTile(-500, -500)).toBeNull();
  });

  it('selects the front-most (occluding) block, including side faces', () => {
    const flat = new IsoMap({ cols: 3, rows: 3 });
    const tall = new IsoMap({ cols: 3, rows: 3, heights: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 4, 0],
    ] });
    const leftOfCenter = (m: IsoMap) => {
      const c = m.tileTop(1, 1);
      return [c.x - m.tileWidth / 4, c.y] as const;
    };
    expect(flat.pickTile(...leftOfCenter(flat))).toMatchObject({ tx: 1, ty: 1, face: 'top' });
    expect(tall.pickTile(...leftOfCenter(tall))).toMatchObject({ tx: 1, ty: 2, face: 'right', height: 4 });
    const top = tall.tileTop(1, 2);
    expect(tall.pickTile(top.x, top.y)).toMatchObject({ tx: 1, ty: 2, face: 'top' });
  });

  it('dispatches tile taps', () => {
    const iso = new IsoMap({ cols: 3, rows: 3 });
    const picks: string[] = [];
    iso.onTileTap((p) => picks.push(`${p.tx},${p.ty}`));
    const c = iso.tileTop(2, 1);
    expect(iso.hitTest(c.x, c.y)).toBe(true);
    iso.emit('tap', { x: c.x, y: c.y } as never);
    expect(picks).toEqual(['2,1']);
  });
});

describe('IsoMap paths and objects', () => {
  it('only climbs maxStep levels per step and avoids blocked / unwalkable tiles', () => {
    const iso = IsoMap.fromAscii({
      heights: ['00300', '00300', '01210'],
      terrain: ['ggggg', 'ggggg', 'ggggg'],
      legend: { g: { color: '#7cb342' } },
    });
    const path = iso.findPath(0, 0, 4, 0, { diagonal: true })!;
    expect(path).not.toBeNull();
    for (let i = 1; i < path.length; i++) {
      const dh = iso.heightAt(path[i]!.x, path[i]!.y) - iso.heightAt(path[i - 1]!.x, path[i - 1]!.y);
      expect(Math.abs(dh)).toBeLessThanOrEqual(1);
    }
    expect(path.some((p) => p.y === 2)).toBe(true);
    iso.setBlocked(2, 2);
    expect(iso.findPath(0, 0, 4, 0)).toBeNull();
    iso.maxStep = 3;
    expect(iso.findPath(0, 0, 4, 0)!.length).toBe(5);
  });

  it('parses markers and unwalkable terrain from ASCII', () => {
    const iso = IsoMap.fromAscii({
      heights: `
        0000
        0000`,
      terrain: `
        gwgT
        gwgg`,
      legend: { g: { color: '#7cb342' }, w: { color: '#29b6f6', walkable: false }, T: { color: '#7cb342', marker: 'tree' } },
    });
    expect(iso.markers('tree')).toEqual([{ x: 3, y: 0 }]);
    expect(iso.passable(1, 0)).toBe(false);
    expect(iso.findPath(0, 0, 2, 0)).toBeNull();
  });

  it('draws objects interleaved with tiles in painter order (diagonal, then elevation)', () => {
    const colors = Array.from({ length: 9 }, (_, i) => `#0000${(i + 16).toString(16)}`);
    const iso = new IsoMap({
      cols: 3,
      rows: 3,
      outline: null,
      terrain: [0, 1, 2, 3, 4, 5, 6, 7, 8],
      types: colors.map((color) => ({ color, top: color })),
    });
    const log: string[] = [];
    iso.addObject(new Marker('center', log), 1, 1);
    iso.addObject(new Marker('back', log), 0, 0);
    const high = iso.addObject(new Marker('high', log), 1, 1);
    high.elevation = 0.5;
    iso.render(recordingCtx(log));
    const tops = log.filter((l) => colors.some((c) => l === 'fill:' + c) || l.startsWith('obj:'));
    const at = (s: string) => tops.indexOf(s);
    const tile = (tx: number, ty: number) => at('fill:' + colors[ty * 3 + tx]);
    expect(at('obj:back')).toBeGreaterThan(tile(0, 0));
    expect(at('obj:back')).toBeLessThan(tile(1, 0));
    expect(at('obj:center')).toBeGreaterThan(tile(2, 0));
    expect(at('obj:center')).toBeGreaterThan(tile(0, 2));
    expect(at('obj:center')).toBeLessThan(tile(2, 1));
    expect(at('obj:center')).toBeLessThan(tile(1, 2));
    expect(at('obj:high')).toBe(at('obj:center') + 1);
  });

  it('eases object elevation toward the tile height', () => {
    const iso = new IsoMap({ cols: 2, rows: 1, heights: [[0, 3]] });
    const obj = iso.addObject(new IsoObject(), 0, 0);
    obj.ix = 1.5;
    for (let i = 0; i < 60; i++) iso.tick(1 / 60);
    expect(obj.elevation).toBeCloseTo(3, 2);
    const top = iso.tileTop(1, 0);
    expect(obj.x).toBeCloseTo(top.x);
    expect(obj.y).toBeCloseTo(top.y, 1);
  });
});
