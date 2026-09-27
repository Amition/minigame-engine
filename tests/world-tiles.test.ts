import { afterEach, describe, expect, it } from 'vitest';
import { asciiRows, parseAsciiGrid, TileMap, World, type TileLegend } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

const LEGEND: TileLegend = {
  '#': { id: 1, solid: true, color: '#475569' },
  '.': { id: 2, color: '#65a30d' },
  '~': { id: 3, cost: 3, color: '#0ea5e9' },
  '=': { id: 4, oneWay: true, color: '#a16207' },
  P: { id: 2, marker: 'player' },
  T: { id: 2, marker: 'tree' },
};

const MAP = `
  #####
  #P.~#
  #.=T#
  #####
`;

describe('ASCII parsing', () => {
  it('dedents template strings and keeps arrays verbatim', () => {
    expect(asciiRows('\n    ab\n     c\n')).toEqual(['ab', ' c']);
    expect(asciiRows(['  x', 'y'])).toEqual(['  x', 'y']);
  });

  it('maps chars through the legend, pads short rows and reports unknown chars', () => {
    const g = parseAsciiGrid(['ab', 'a'], { a: 1, b: 2 }, 0);
    expect(g).toEqual({ cols: 2, rows: 2, cells: [1, 2, 1, 0] });
    expect(() => parseAsciiGrid(['ab', 'aX'], { a: 1, b: 2 })).toThrow(/"X" at row 1, col 1/);
  });
});

describe('TileMap', () => {
  it('builds from ASCII with markers, solidity, costs and queries', () => {
    const map = TileMap.fromAscii(MAP, LEGEND, 32);
    expect([map.cols, map.rows, map.width, map.height]).toEqual([5, 4, 160, 128]);
    expect(map.getTile(0, 0)).toBe(1);
    expect(map.getTile(1, 1)).toBe(2);
    expect(map.getTile(9, 9)).toBe(-1);
    expect(map.tileAt(3 * 32 + 5, 32 + 5)).toBe(3);
    expect(map.isSolid(0, 0)).toBe(true);
    expect(map.isSolid(2, 1)).toBe(false);
    expect(map.isOneWay(2, 2)).toBe(true);
    expect(map.tileCost(3, 1)).toBe(3);
    expect(map.tileCost(0, 0)).toBe(Infinity);
    expect(map.isSolid(-1, 0)).toBe(false);
    map.solidOutside = true;
    expect(map.isSolid(-1, 0)).toBe(true);
    expect(map.marker('player')).toEqual({ x: 1, y: 1 });
    expect(map.markers('tree')).toEqual([{ x: 3, y: 2 }]);
    expect(map.markerWorld('player')).toEqual({ x: 48, y: 48 });
    expect(() => map.marker('nope')).toThrow(/no marker "nope"/);
    expect(map.worldToTile(-1, 31.9)).toEqual({ x: -1, y: 0 });
    expect(map.tileToWorld(2, 3, false)).toEqual({ x: 64, y: 96 });
    expect(map.toAscii()).toEqual(['#####', '#..~#', '#.=.#', '#####']);
  });

  it('respects the node offset and updates flags on setTile', () => {
    const map = TileMap.fromAscii(MAP, LEGEND, 32, { x: 100, y: 50 });
    expect(map.tileAt(105, 55)).toBe(1);
    expect(map.solidAt(100 + 48, 50 + 48)).toBe(false);
    map.setTile(1, 1, 1);
    expect(map.solidAt(100 + 48, 50 + 48)).toBe(true);
    expect(map.passable(1, 1)).toBe(false);
    expect(map.tileRect(1, 1)).toEqual({ x: 132, y: 82, w: 32, h: 32 });
  });

  it('accepts number[][] layers and extra ASCII layers', () => {
    const map = new TileMap({ cols: 3, rows: 2, tileWidth: 16, tiles: { 5: { solid: true } } });
    map.addLayer('ground', [
      [1, 1, 1],
      [1, 5, 1],
    ]);
    map.addAsciiLayer('deco', ['..f', 'f..'], { '.': 0, f: { id: 9, color: '#fff', marker: 'flower' } });
    expect(map.getTile(1, 1, 'ground')).toBe(5);
    expect(map.getTile(2, 0, 'deco')).toBe(9);
    expect(map.isSolid(1, 1)).toBe(true);
    expect(map.markers('flower')).toEqual([
      { x: 2, y: 0 },
      { x: 0, y: 1 },
    ]);
    map.layer('ground').collides = false;
    expect(map.isSolid(1, 1)).toBe(false);
    map.setTile(1, 1, 5, 'deco');
    expect(map.isSolid(1, 1)).toBe(true);
    expect(() => map.addLayer('bad', [[1, 2, 3, 4]])).toThrow(/cols/);
  });

  it('computes 4/8-bit autotile masks and applies autotiling', () => {
    const map = TileMap.fromAscii(['.#.', '###', '.#.'], { '.': 0, '#': 1 }, 8);
    expect(map.mask4(1, 1)).toBe(15);
    expect(map.mask4(1, 0, 1, 0, false)).toBe(4);
    expect(map.mask8(1, 1)).toBe(1 | 4 | 16 | 64);
    const full = TileMap.fromAscii(['###', '###', '###'], { '#': 1 }, 8);
    expect(full.mask8(1, 1)).toBe(255);
    map.autotile(1, (m) => 100 + m);
    expect(map.getTile(1, 1)).toBe(115);
    expect(map.getTile(0, 1)).toBe(100 + (2 | 8));
  });

  it('pre-renders chunks and re-bakes only dirty ones', async () => {
    t = await createTestGame();
    const rows = Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => ((x + y) % 2 ? '#' : '.')).join(''));
    const map = TileMap.fromAscii(rows, LEGEND, 32, { chunkTiles: 8 });
    const world = t.game.sceneLayer.add(new World());
    world.add(map);
    world.camera.lookAt(256, 256);
    await t.step(1);
    expect(map.bakedChunks).toBe(4);
    expect(map.drawnChunks).toBe(4);
    await t.step(2);
    expect(map.bakedChunks).toBe(4);
    map.setTile(3, 3, 3);
    await t.step(1);
    expect(map.bakedChunks).toBe(5);
    map.setTile(8, 8, 3);
    await t.step(1);
    expect(map.bakedChunks).toBe(9);
    expect(map.describe().chunks).toBe('4/4');
  });

  it('only draws chunks in view', async () => {
    t = await createTestGame();
    const rows = Array.from({ length: 80 }, () => '.'.repeat(80));
    const map = TileMap.fromAscii(rows, LEGEND, 32, { chunkTiles: 8 });
    const world = t.game.sceneLayer.add(new World());
    world.add(map);
    world.camera.lookAt(1280, 1280);
    await t.step(1);
    expect(map.drawnChunks).toBeLessThanOrEqual(5 * 9);
    expect(map.drawnChunks).toBeGreaterThan(0);
    map.prerender = false;
    await t.step(1);
    expect(map.drawnTiles).toBeLessThan(40 * 60);
  });

  it('raycasts against solid tiles', () => {
    const map = TileMap.fromAscii(MAP, LEGEND, 32);
    const hit = map.raycast(48, 48, 300, 48)!;
    expect(hit.tx).toBe(4);
    expect(hit.x).toBeCloseTo(128);
    expect(hit.nx).toBe(-1);
    expect(map.hasLineOfSight(40, 40, 90, 80)).toBe(true);
  });
});
