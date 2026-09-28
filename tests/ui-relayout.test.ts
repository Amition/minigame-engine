import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Box, flushUILayout, Label, markUILayoutDirty, mountScreen, Node, ui, type UIView } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

let t: TestGame;
beforeEach(async () => {
  t = await createTestGame();
});
afterEach(() => t.destroy());

/** Mounts `root` into a scene-sized node and counts how often it is laid out. */
async function mountCounted(root: UIView): Promise<{ layouts: () => number }> {
  const scene = t.game.sceneLayer.add(new Node());
  scene.setSize(t.game.view.width, t.game.view.height);
  let n = 0;
  root.onLayout = () => void n++;
  mountScreen(scene, root);
  await t.step(1);
  return { layouts: () => n };
}

const snap = (l: Label) => ({ x: l.x, y: l.y, w: l.width, h: l.height, wrap: l.style.wrapWidth });

/** What a full relayout gives for the current tree. */
function fullLayout(root: UIView, l: Label) {
  markUILayoutDirty(root);
  flushUILayout(root);
  return snap(l);
}

describe('label text changes: size-stable fast path', () => {
  it('same-size text re-wraps in place without laying out the root, matching a full relayout', async () => {
    const score = ui.text('10', { variant: 'h1' });
    const stretched = ui.text('Hi', { align: 'center' });
    const root = ui.column({ padding: 'lg', gap: 'md' }, [ui.row({ gap: 'md' }, [ui.button({ text: 'Pause' }), score]), stretched, new Box(10, 10)]);
    const { layouts } = await mountCounted(root);
    const before = layouts();

    score.text = '01';
    expect(root.layoutDirty).toBe(false);
    stretched.text = 'Hello there, a longer line';
    expect(root.layoutDirty).toBe(false);
    await t.step(2);
    expect(layouts()).toBe(before);

    const fast = [snap(score), snap(stretched)];
    expect(fullLayout(root, score)).toEqual(fast[0]);
    expect(snap(stretched)).toEqual(fast[1]);
  });

  it('text that changes size still re-lays out the containers around it', async () => {
    const count = ui.text('1', { variant: 'h2' });
    const after = new Box(40, 40);
    const body = ui.text('Short', {});
    const below = new Box(20, 20);
    const root = ui.column({ padding: 'lg', gap: 'md', width: 500 }, [ui.row({ gap: 'md' }, [count, after]), body, below]);
    const { layouts } = await mountCounted(root);
    const x0 = after.x;
    const y0 = below.y;
    const n0 = layouts();

    count.text = '1000000';
    expect(root.layoutDirty).toBe(true);
    await t.step(1);
    expect(after.x).toBeGreaterThan(x0);

    body.text = 'A much longer body text that cannot fit on one line of a 500 wide column, so it wraps';
    expect(root.layoutDirty).toBe(true);
    await t.step(1);
    expect(body.lines.length).toBeGreaterThan(1);
    expect(below.y).toBeGreaterThan(y0);
    expect(layouts()).toBe(n0 + 2);
  });

  it('labels whose parent lays out on its own terms (not a plain flex view) mark the layout dirty', async () => {
    const grid = ui.grid({ columns: 2, gap: 8 }, [ui.text('a'), ui.text('b')]);
    const root = ui.column({}, [grid]);
    await mountCounted(root);
    (grid.children[0] as Label).text = 'c';
    expect(root.layoutDirty).toBe(true);
  });
});

describe('per-frame change detection', () => {
  it('re-lays out on nested leaf resizes, visibility changes and added children; not otherwise', async () => {
    const leaf = new Box(50, 50);
    const hidden = ui.text('Hidden');
    const inner = ui.row({ gap: 4 }, [leaf, hidden]);
    const root = ui.column({ padding: 10 }, [ui.column({}, [inner])]);
    const { layouts } = await mountCounted(root);
    const n0 = layouts();
    await t.step(3);
    expect(layouts()).toBe(n0);

    leaf.height = 80;
    await t.step(1);
    expect(layouts()).toBe(n0 + 1);
    expect(leaf.height).toBe(80);

    hidden.visible = false;
    await t.step(1);
    expect(layouts()).toBe(n0 + 2);

    inner.add(new Box(10, 10));
    await t.step(1);
    expect(layouts()).toBe(n0 + 3);

    hidden.visible = true;
    await t.step(1);
    expect(layouts()).toBe(n0 + 4);
    await t.step(3);
    expect(layouts()).toBe(n0 + 4);
  });

  it('re-lays out when the parent of a root resizes', async () => {
    const holder = t.game.sceneLayer.add(new Node({ width: 400, height: 300 }));
    const root = holder.add(ui.column({ width: '50%', height: '100%' }, [new Box(10, 10)]));
    await t.step(1);
    expect(root.width).toBe(200);
    holder.width = 600;
    await t.step(1);
    expect(root.width).toBe(300);
  });
});
