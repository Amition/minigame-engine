import { afterEach, describe, expect, it } from 'vitest';
import {
  Box,
  createAudioManager,
  createSave,
  darkUITheme,
  defineSong,
  lightUITheme,
  mountScreen,
  Node,
  onAim,
  setUITheme,
  sfxPresets,
  ui,
  uiTheme,
  type AimInfo,
  type AudioLibrary,
  type Ctx2D,
} from '@engine';
import { createTestGame, type TestGame, type TestRenderMode } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

class CountingBox extends Box {
  draws = 0;
  override draw(ctx: Ctx2D): void {
    this.draws++;
    super.draw(ctx);
  }
}

async function counting(render?: TestRenderMode): Promise<{ t: TestGame; box: CountingBox; prerenders: () => number }> {
  t = await createTestGame(render ? { render } : {});
  const box = t.game.sceneLayer.add(new CountingBox(100, 100, { fill: '#f00' }));
  let pre = 0;
  t.game.on('prerender', () => pre++);
  return { t, box, prerenders: () => pre };
}

describe('createTestGame render modes', () => {
  it("'last' (default) draws only the final frame of each call", async () => {
    const { t, box, prerenders } = await counting();
    expect(t.renderMode).toBe('last');
    await t.advance(1);
    expect(box.draws).toBe(1);
    expect(prerenders()).toBe(60);
    await t.step(3);
    expect(box.draws).toBe(2);
    expect(t.game.time.frame).toBe(1 + 60 + 3);
    await t.tap({ x: 50, y: 50 });
    await t.drag({ x: 10, y: 10 }, { x: 90, y: 90 }, 6);
    expect(box.draws).toBe(4);
    expect(t.game.time.frame).toBe(1 + 60 + 3 + 2 + 8);
  });

  it("'every' draws every frame and 'none' never, but png() always draws", async () => {
    const every = await counting('every');
    await every.t.step(5);
    expect(every.box.draws).toBe(5);
    every.t.destroy();

    const none = await counting('none');
    await none.t.advance(0.5);
    expect(none.box.draws).toBe(0);
    expect(none.prerenders()).toBe(30);
    expect(none.t.png().length).toBeGreaterThan(100);
    expect(none.box.draws).toBe(1);
    none.t.renderMode = 'every';
    await none.t.step(2);
    expect(none.box.draws).toBe(3);
  });

  it('undrawn frames still lay out UI, so taps hit freshly mounted screens', async () => {
    t = await createTestGame({ render: 'none' });
    const scene = t.game.sceneLayer.add(new Node());
    let taps = 0;
    await t.step(1);
    const screen = ui.column({ justify: 'end', align: 'center', padding: 'lg' }, [ui.button({ id: 'go', text: 'Go', onTap: () => taps++ })]);
    mountScreen(scene, screen, { safeArea: true });
    await t.step(1);
    const go = t.get('#go');
    expect(go.worldBounds().y).toBeGreaterThan(t.game.view.height / 2);
    await t.tap('#go');
    expect(taps).toBe(1);
  });

  it('multiDrag moves several pointers in the same frames (two onAim zones at once)', async () => {
    t = await createTestGame();
    const left = t.game.sceneLayer.add(new Box(375, 1334, {}, { x: 0, y: 0 }));
    const right = t.game.sceneLayer.add(new Box(375, 1334, {}, { x: 375, y: 0 }));
    const log: string[] = [];
    const last = new Map<Node, AimInfo>();
    for (const [name, zone] of [['L', left], ['R', right]] as const) {
      onAim(zone, {
        start: (a) => void log.push(`${name}start${a.pointer.pointerId}@${t!.game.time.frame}`),
        release: (a) => {
          log.push(`${name}release${a.pointer.pointerId}@${t!.game.time.frame}`);
          last.set(zone, a);
        },
      });
    }
    const frame0 = t.game.time.frame;
    await t.multiDrag(
      [
        [{ x: 200, y: 600 }, { x: 100, y: 700 }],
        [{ x: 500, y: 600 }, { x: 700, y: 500 }],
      ],
      6,
    );
    expect(t.game.time.frame).toBe(frame0 + 8);
    expect(log).toEqual([`Lstart1@${frame0}`, `Rstart2@${frame0}`, `Lrelease1@${frame0 + 7}`, `Rrelease2@${frame0 + 7}`]);
    expect([last.get(left)!.dx, last.get(left)!.dy]).toEqual([-100, 100]);
    expect(last.get(right)!.dx).toBeCloseTo(200);
    expect(last.get(right)!.dy).toBeCloseTo(-100);
  });

  it('clamps dt to maxDt like game.step()', async () => {
    t = await createTestGame({ config: { maxDt: 1 / 20 } });
    await t.step(1, 1);
    expect(t.game.time.dt).toBeCloseTo(1 / 20);
    expect(t.platform.clock).toBeCloseTo(1000 / 60 + 1000);
  });

  it('pixelRatio overrides the device backing resolution; shots stay in CSS px', async () => {
    t = await createTestGame({ device: 'iphone-14', pixelRatio: 1 });
    expect(t.game.pixelRatio).toBe(1);
    expect([t.platform.canvas.width, t.platform.canvas.height]).toEqual([390, 844]);
    const png = t.png();
    expect(png.readUInt32BE(16)).toBe(390);
    expect(png.readUInt32BE(20)).toBe(844);
    t.destroy();
    t = await createTestGame({ device: 'iphone-14' });
    expect(t.platform.canvas.width).toBe(780);
  });
});

describe('createTestGame isolation', () => {
  const save = createSave('harness-test', { best: 0, coins: 0 });

  it('module-level SaveStores re-read the fresh storage of each test game', async () => {
    t = await createTestGame();
    expect(save.data.best).toBe(0);
    save.set({ best: 42 }).flush();
    expect(JSON.parse(t.platform.storage.get('harness-test')!).data.best).toBe(42);
    t.destroy();
    t = await createTestGame();
    expect(save.data).toEqual({ best: 0, coins: 0 });
    t.platform.storage.set('harness-test', JSON.stringify({ v: 1, data: { best: 7 } }));
    t.destroy();
    t = await createTestGame();
    expect(save.data.best).toBe(0);
  });

  it('pending debounced writes of the previous game are dropped', async () => {
    t = await createTestGame();
    const debounced = createSave('harness-debounced', { n: 0 }, { debounce: 1 });
    debounced.set({ n: 5 });
    expect(debounced.pending).toBe(true);
    t.destroy();
    t = await createTestGame();
    expect(debounced.pending).toBe(false);
    expect(debounced.data.n).toBe(0);
  });

  it('resets the UI theme to the default', async () => {
    setUITheme(lightUITheme);
    t = await createTestGame();
    expect(uiTheme()).toBe(darkUITheme);
  });

  it('later test games reuse the sounds an earlier one synthesized (same PCM, same info)', async () => {
    const library: AudioLibrary = {
      sfx: { coin: sfxPresets.coin() },
      music: { loop: defineSong({ bpm: 240, tracks: { l: { instrument: 'triangle', notes: 'C4 E4 G4 C5 |' } } }) },
    };
    const boot = async () => {
      t = await createTestGame();
      const audio = createAudioManager(t.game, { library });
      await audio.preload();
      const pcm = (k: string) => t!.platform.audio.pcm.get(k)!;
      return { coin: pcm('coin'), loop: pcm('loop'), info: audio.info('loop') };
    };
    const first = await boot();
    t!.destroy();
    const second = await boot();
    expect(second.coin.data).toBe(first.coin.data);
    expect(second.loop.data).toBe(first.loop.data);
    expect(second.loop.sampleRate).toBe(22050);
    expect(second.info).toEqual(first.info);
    expect(second.info?.source).toBe('synth');
  });
});
