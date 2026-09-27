import { afterEach, describe, expect, it } from 'vitest';
import { Box, Mat2D, Node, parseColor, contrastRatio, Rng, Text, wrapText, type AppDef } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';
import sandbox from '../sandbox/main';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

describe('math', () => {
  it('inverts matrices', () => {
    const m = new Mat2D().translate(10, 20).rotate(0.7).scale(2, 3);
    const p = m.apply(5, 7);
    const back = m.clone().invert().apply(p.x, p.y);
    expect(back.x).toBeCloseTo(5);
    expect(back.y).toBeCloseTo(7);
  });

  it('rng is deterministic', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    expect([a.next(), a.int(1, 6), a.float()]).toEqual([b.next(), b.int(1, 6), b.float()]);
  });

  it('parses colors and computes contrast', () => {
    expect(parseColor('#f80')).toEqual({ r: 255, g: 136, b: 0, a: 1 });
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21);
  });
});

describe('text wrapping', () => {
  const measure = (s: string) => [...s].length * 10;
  it('wraps CJK per char and never starts a line with closing punctuation', () => {
    expect(wrapText('一二三四，五六', 40, measure)).toEqual(['一二三', '四，五六']);
    expect(wrapText('一二三四五六', 40, measure)).toEqual(['一二三四', '五六']);
  });
  it('wraps latin per word', () => {
    expect(wrapText('hello big world', 90, measure)).toEqual(['hello big', 'world']);
  });
});

describe('scene graph + input', () => {
  it('selects nodes by kind, id, tag and attribute', async () => {
    t = await createTestGame();
    const root = t.game.sceneLayer.add(new Node({ id: 'root' }));
    root.add(new Box(100, 50, {}, { id: 'a', tags: ['btn', 'primary'] }));
    const panel = root.add(new Node({ id: 'panel' }));
    panel.add(new Text('开始', {}, { id: 'start' }));
    expect(t.find('Box.btn.primary')?.id).toBe('a');
    expect(t.find('#panel > Text')?.id).toBe('start');
    expect(t.find('#root Text[text=开始]')?.id).toBe('start');
    expect(t.find('Text[text*=开]')?.id).toBe('start');
    expect(t.find('#panel Box')).toBeNull();
    expect(t.findAll('*').length).toBeGreaterThanOrEqual(4);
  });

  it('dispatches taps to the topmost interactive node, respecting rotation and anchors', async () => {
    t = await createTestGame();
    const hits: string[] = [];
    const a = t.game.sceneLayer.add(new Box(200, 200, {}, { id: 'under', x: 100, y: 100 }));
    a.onTap(() => hits.push('under'));
    const b = t.game.sceneLayer.add(
      new Box(100, 100, {}, { id: 'over', x: 200, y: 200, anchor: 0.5, rotation: Math.PI / 4 }),
    );
    b.onTap(() => hits.push('over'));
    await t.tap({ x: 200, y: 200 });
    await t.tap({ x: 110, y: 110 });
    expect(hits).toEqual(['over', 'under']);
  });

  it('does not tap after a drag beyond the slop', async () => {
    t = await createTestGame();
    let taps = 0;
    const box = t.game.sceneLayer.add(new Box(300, 300, {}, { x: 0, y: 0 }));
    box.onTap(() => taps++);
    await t.drag({ x: 10, y: 10 }, { x: 250, y: 250 });
    expect(taps).toBe(0);
  });

  it('boots the sandbox, navigates home → basics, taps the counter', async () => {
    t = await createTestGame({ app: sandbox as AppDef });
    expect(t.scene?.sceneName).toBe('home');
    await t.tap('#go-basics');
    expect(t.scene?.sceneName).toBe('basics');
    await t.tap('#counter');
    await t.tap('#counter');
    expect(t.get<Text>('#counter Text').text).toBe('点我 2');
    expect(t.dump()).toContain('Box#counter');
    await t.tap('#back');
    expect(t.scene?.sceneName).toBe('home');
    const png = t.png();
    expect(png.length).toBeGreaterThan(1000);
  });

  it('uses expand scaling with safe insets', async () => {
    t = await createTestGame({ device: 'iphone-14' });
    expect(t.game.view.width).toBeCloseTo(750);
    expect(t.game.view.height).toBeCloseTo((844 / 390) * 750, 0);
    expect(t.game.safe.y).toBeCloseTo((47 / 390) * 750, 0);
  });

  it('pauses on hide and resumes on show', async () => {
    t = await createTestGame();
    const n = t.game.sceneLayer.add(new Node());
    let ticks = 0;
    n.onUpdate(() => ticks++);
    await t.step(2);
    t.platform.hide();
    await t.step(3);
    expect(ticks).toBe(2);
    t.platform.show();
    await t.step(1);
    expect(ticks).toBe(3);
  });
});
