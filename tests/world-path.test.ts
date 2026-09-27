import { describe, expect, it } from 'vitest';
import {
  findGridPath,
  gridDistanceField,
  gridFloodFill,
  gridPathCost,
  PathFollower,
  Rng,
  simplifyGridPath,
  stepDownField,
  TileMap,
  type CornerRule,
  type GridPoint,
  type PathGrid,
} from '@engine';

function grid(rows: string[], costs: Record<string, number> = {}): PathGrid {
  return {
    cols: rows[0]!.length,
    rows: rows.length,
    passable: (x, y) => rows[y]![x] !== '#',
    moveCost: (_fx, _fy, x, y) => costs[rows[y]![x]!] ?? 1,
  };
}

function randomGrid(rng: Rng, size: number, density: number): string[] {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => (rng.chance(density) ? '#' : rng.chance(0.2) ? '~' : '.')).join(''),
  );
}

function validPath(g: PathGrid, path: GridPoint[], diagonal: boolean, rule: CornerRule): boolean {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return false;
    if (!g.passable(b.x, b.y)) return false;
    if (dx !== 0 && dy !== 0) {
      if (!diagonal) return false;
      const p = g.passable(a.x + dx, a.y);
      const q = g.passable(a.x, a.y + dy);
      if (rule === 'never' && !(p && q)) return false;
      if (rule === 'one' && !(p || q)) return false;
    }
  }
  return true;
}

describe('A*', () => {
  it('finds optimal paths on random small grids (checked against Dijkstra)', () => {
    const rng = new Rng(2024);
    const cases: { diagonal: boolean; rule: CornerRule }[] = [
      { diagonal: false, rule: 'never' },
      { diagonal: true, rule: 'never' },
      { diagonal: true, rule: 'one' },
      { diagonal: true, rule: 'always' },
    ];
    let found = 0;
    for (let n = 0; n < 60; n++) {
      const rows = randomGrid(rng, rng.int(4, 9), 0.28);
      const g = grid(rows, { '~': 3 });
      const size = rows.length;
      const s = { x: rng.int(0, size - 1), y: rng.int(0, size - 1) };
      const e = { x: rng.int(0, size - 1), y: rng.int(0, size - 1) };
      for (const c of cases) {
        const path = findGridPath(g, s.x, s.y, e.x, e.y, { diagonal: c.diagonal, cutCorners: c.rule });
        const field = gridDistanceField(g, [s], { diagonal: c.diagonal, cutCorners: c.rule });
        const best = field[e.y * size + e.x]!;
        if (s.x === e.x && s.y === e.y) {
          expect(path).toEqual([s]);
          continue;
        }
        if (!g.passable(e.x, e.y) || best === Infinity) {
          expect(path).toBeNull();
          continue;
        }
        expect(path).not.toBeNull();
        expect(path![0]).toEqual(s);
        expect(path![path!.length - 1]).toEqual(e);
        expect(validPath(g, path!, c.diagonal, c.rule)).toBe(true);
        expect(gridPathCost(g, path!)).toBeCloseTo(best, 9);
        found++;
      }
    }
    expect(found).toBeGreaterThan(80);
  });

  it('applies the corner-cutting rule', () => {
    const g = grid(['.#', '..']);
    expect(findGridPath(g, 0, 0, 1, 1, { diagonal: true })!.length).toBe(3);
    expect(findGridPath(g, 0, 0, 1, 1, { diagonal: true, cutCorners: 'one' })!.length).toBe(2);
    const g2 = grid(['.#', '#.']);
    expect(findGridPath(g2, 0, 0, 1, 1, { diagonal: true, cutCorners: 'one' })).toBeNull();
    expect(findGridPath(g2, 0, 0, 1, 1, { diagonal: true, cutCorners: 'always' })!.length).toBe(2);
  });

  it('prefers cheap detours over expensive cells and can return the nearest reachable cell', () => {
    const g = grid(['.....', '.~~~.', '.....'], { '~': 10 });
    const path = findGridPath(g, 0, 1, 4, 1)!;
    expect(path.some((p) => p.y === 1 && p.x > 0 && p.x < 4)).toBe(false);
    expect(gridPathCost(g, path)).toBe(6);
    const walled = grid(['..#.', '..#.', '..#.']);
    expect(findGridPath(walled, 0, 1, 3, 1)).toBeNull();
    const near = findGridPath(walled, 0, 1, 3, 1, { nearest: true })!;
    expect(near[near.length - 1]).toEqual({ x: 1, y: 1 });
  });

  it('is deterministic', () => {
    const g = grid(['........', '...##...', '........', '........']);
    const a = findGridPath(g, 0, 0, 7, 3, { diagonal: true });
    expect(findGridPath(g, 0, 0, 7, 3, { diagonal: true })).toEqual(a);
  });

  it('works on tile maps with world-space paths', () => {
    const map = TileMap.fromAscii(['#####', '#S.##', '##.G#', '#####'], { '#': { id: 1, solid: true }, '.': 0, S: { id: 0, marker: 's' }, G: { id: 0, marker: 'g' } }, 32);
    const s = map.marker('s');
    const g = map.marker('g');
    expect(map.findPath(s.x, s.y, g.x, g.y)).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ]);
    expect(map.findWorldPath(48, 48, 112, 80)).toEqual([
      { x: 48, y: 48 },
      { x: 80, y: 48 },
      { x: 80, y: 80 },
      { x: 112, y: 80 },
    ]);
  });
});

describe('flood fill, distance fields, helpers', () => {
  it('floods reachable cells and builds a multi-source distance field', () => {
    const g = grid(['...#....', '...#....', '...#....']);
    expect(gridFloodFill(g, 0, 0)).toHaveLength(9);
    expect(gridFloodFill(g, 0, 0, { maxDistance: 1 })).toHaveLength(3);
    const field = gridDistanceField(g, [
      { x: 0, y: 0 },
      { x: 7, y: 2 },
    ]);
    expect(field[1 * 8 + 2]).toBe(3);
    expect(field[0 * 8 + 4]).toBe(5);
    expect(field[0 * 8 + 3]).toBe(Infinity);
    let p: GridPoint | null = { x: 4, y: 0 };
    const walk: GridPoint[] = [];
    while (p) {
      walk.push(p);
      p = stepDownField(g, field, p.x, p.y);
    }
    expect(walk[walk.length - 1]).toEqual({ x: 7, y: 2 });
    expect(walk).toHaveLength(6);
  });

  it('simplifies straight runs and follows paths at constant speed', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
    ];
    expect(simplifyGridPath(path)).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ]);
    const f = new PathFollower(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      60,
    );
    f.update(1);
    expect([f.x, f.y, f.done]).toEqual([60, 0, false]);
    f.update(1);
    expect(f.x).toBe(100);
    expect(f.y).toBeCloseTo(20);
    expect(f.remaining).toBeCloseTo(30);
    expect(f.update(1)).toBe(false);
    expect([f.x, f.y, f.done, f.travelled]).toEqual([100, 50, true, 150]);
  });
});
