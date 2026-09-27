import { afterEach, describe, expect, it } from 'vitest';
import { IsoMap, PerspectiveRoad, TileMap, World, type AppDef, type Node, type Text } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';
import sandbox from '../sandbox/main';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

const open = async (scene: string) => (t = await createTestGame({ app: sandbox as AppDef, scene }));

describe('world demo scenes', () => {
  it('top-down: the hero walks to coins and the camera follows', async () => {
    const g = await open('world-topdown');
    const world = g.get<World>('#world');
    const map = g.get<TileMap>('#map');
    const hero = g.get<Node>('#player');
    const start = { x: hero.x, y: hero.y };
    await g.advance(5);
    expect(Math.hypot(hero.x - start.x, hero.y - start.y)).toBeGreaterThan(120);
    expect(g.get<Text>('#hud').text).toMatch(/金币 [1-9]/);
    const tile = map.worldToTile(hero.x, hero.y);
    expect(map.isSolid(tile.x, tile.y)).toBe(false);
    const cam = world.camera;
    expect(Math.abs(cam.x - hero.x)).toBeLessThan(cam.viewportWidth / cam.zoom / 2);
    expect(map.drawnChunks).toBeGreaterThan(0);
  });

  it('iso: tapping a tile walks the hero there', async () => {
    const g = await open('world-iso');
    const iso = g.get<IsoMap>('#iso');
    await g.advance(0.5);
    const top = iso.tileTop(7, 10);
    const p = iso.toWorld(top.x, top.y);
    await g.tap(p);
    expect(iso.selected).toEqual({ x: 7, y: 10 });
    await g.advance(1.6);
    expect(g.get<Node>('#player').describe()).toMatchObject({ tile: '7,10' });
  });

  it('platformer: the hero runs, jumps and stays inside the level', async () => {
    const g = await open('world-platformer');
    const map = g.get<TileMap>('#map');
    const hero = g.get<Node>('#player');
    const x0 = hero.x;
    let minY = Infinity;
    for (let i = 0; i < 16; i++) {
      await g.advance(0.25);
      minY = Math.min(minY, hero.y);
      expect(hero.y).toBeLessThan(map.height);
    }
    expect(hero.x - x0).toBeGreaterThan(600);
    expect(minY).toBeLessThan(12 * 64);
  });

  it('road: drives forward and draws segments', async () => {
    const g = await open('world-road');
    const road = g.get<PerspectiveRoad>('#road');
    await g.advance(1.5);
    expect(road.position).toBeGreaterThan(3000);
    expect(road.segmentsDrawn).toBeGreaterThan(50);
  });
});
