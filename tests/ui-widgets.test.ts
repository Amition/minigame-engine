import { afterEach, describe, expect, it } from 'vitest';
import {
  Box,
  buildUI,
  contrastRatio,
  darkUITheme,
  flushUILayout,
  inspectUI,
  Label,
  lightUITheme,
  mountScreen,
  Node,
  parseRichText,
  registerUIType,
  RichText,
  setUITheme,
  showDialog,
  showModal,
  showToast,
  stripRichText,
  ui,
  uiEvents,
  type Button,
  type ListView,
  type ScrollView,
  type UITheme,
  type UIView,
} from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
  setUITheme('dark');
});

async function game(): Promise<TestGame> {
  t = await createTestGame();
  return t;
}

function add<T extends Node>(n: T): T {
  t!.game.sceneLayer.add(n);
  flushUILayout(n);
  return n;
}

describe('ui builder + specs', () => {
  it('builds typed trees and skips falsy children', async () => {
    await game();
    const vip = false;
    const root = add(
      ui.column({ id: 'root', padding: 'lg', gap: 'md' }, [
        ui.text('Title', { variant: 'h1' }),
        vip && ui.badge({ count: 1 }),
        ui.button({ id: 'go', text: 'Go' }),
        ui.row({ gap: 'sm' }, [ui.iconButton({ icon: 'settings', label: 'Settings' })]),
      ]),
    );
    expect(root.children.length).toBe(3);
    expect(t!.find('#root > Label[text=Title]')).not.toBeNull();
    expect(t!.find('Row IconButton[label=Settings]')).not.toBeNull();
    expect(t!.get<Button>('#go').kind).toBe('Button');
  });

  it('buildUI builds JSON specs, emits string actions, and reports unknown types', async () => {
    await game();
    const actions: string[] = [];
    const off = uiEvents.on('action', (a) => actions.push(a.name));
    const root = add(
      buildUI({
        type: 'column',
        props: { id: 'menu', gap: 'md', padding: 'lg' },
        children: [
          { type: 'text', props: { text: 'Hello', variant: 'h1' } },
          'plain string',
          { type: 'button', props: { id: 'start', text: 'Start', onTap: 'start-game' } },
          { type: 'row', children: [{ type: 'toggle', props: { id: 'sfx', value: true } }, { type: 'label', children: ['Sound'] }] },
        ],
      }),
    );
    expect(root.kind).toBe('Column');
    expect(t!.find('#menu Label[text="plain string"]')).not.toBeNull();
    expect(t!.find('Row Label[text=Sound]')).not.toBeNull();
    await t!.tap('#start');
    expect(actions).toEqual(['start-game']);
    off();
    expect(() => buildUI({ type: 'nope' })).toThrow(/unknown type "nope".*column/);
  });

  it('registerUIType adds custom spec types', async () => {
    await game();
    registerUIType('coin-counter', (p) => ui.text(`x${String(p.value)}`, { id: 'coins' }));
    add(buildUI({ type: 'column', children: [{ type: 'coinCounter', props: { value: 5 } }] }) as UIView);
    expect(t!.get<Label>('#coins').text).toBe('x5');
  });

  it('mountScreen accepts a spec and fills the safe area', async () => {
    t = await createTestGame({ device: 'iphone-14' });
    const scene = t.game.sceneLayer.add(new Node());
    const root = mountScreen(scene, { type: 'column', props: { id: 'screen-root' } });
    await t.step(1);
    const b = root.worldBounds();
    expect(b.y).toBeCloseTo(t.game.safe.y, 1);
    expect(b.h).toBeCloseTo(t.game.safe.h, 1);
    mountScreen(scene, ui.column({ id: 'second' }));
    await t.step(1);
    expect(t.find('#screen-root')).toBeNull();
    expect(t.find('#second')).not.toBeNull();
  });

  it('inspectUI returns kinds, rects, widget state and layout', async () => {
    await game();
    const root = add(ui.column({ id: 'r', padding: 10, gap: 5 }, [ui.button({ id: 'b', text: 'Play' }), ui.toggle({ value: true })]));
    const info = inspectUI(root);
    expect(info.kind).toBe('Column');
    expect(info.layout).toMatchObject({ padding: 10, gap: 5, direction: 'column' });
    const btn = info.children![0]!;
    expect(btn).toMatchObject({ kind: 'Button', id: 'b', props: { text: 'Play', variant: 'primary' } });
    expect(btn.rect[1]).toBe(10);
    expect(btn.flags).toContain('interactive');
    expect(info.children![1]!.props).toMatchObject({ on: true });
    expect(info.children![1]!.hit).toBeDefined();
  });
});

describe('ui widgets', () => {
  it('buttons fire taps, ignore taps while disabled and grow their hit area to 88', async () => {
    await game();
    let n = 0;
    const b = add(ui.button({ text: 'Tap', size: 'sm', onTap: () => n++ }));
    expect(b.height).toBe(64);
    expect(b.hitPadding).toBe(12);
    await t!.tap(b);
    expect(n).toBe(1);
    b.disabled = true;
    await t!.tap(b);
    expect(n).toBe(1);
  });

  it('toggle, checkbox, segmented control and tabs react to taps', async () => {
    await game();
    const changes: unknown[] = [];
    const off = uiEvents.on('change', (c) => changes.push(c.value));
    const root = add(
      ui.column({ gap: 'md', width: 600 }, [
        ui.toggle({ id: 'tg' }),
        ui.checkbox({ id: 'cb', text: 'Agree' }),
        ui.segmented({ id: 'seg', options: ['A', 'B', 'C'] }),
        ui.tabs({ id: 'tabs', labels: ['One', 'Two'] }, [ui.text('Page one', { id: 'p1' }), ui.text('Page two', { id: 'p2' })]),
      ]),
    );
    await t!.tap('#tg');
    await t!.tap('#cb');
    await t!.tap('Segment[text=C]');
    expect(t!.get('#tg').describe().on).toBe(true);
    expect(t!.get('#cb').describe().checked).toBe(true);
    expect(t!.get('#seg').describe()).toMatchObject({ selected: 'C', index: 2 });
    expect(t!.get('#p1').visible).toBe(true);
    expect(t!.get('#p2').visible).toBe(false);
    await t!.tap('Tab[text=Two]');
    expect(t!.get('#p1').visible).toBe(false);
    expect(t!.get('#p2').visible).toBe(true);
    expect(changes).toEqual([true, true, 2, 1]);
    off();
    root.destroy();
  });

  it('slider follows drags and keeps them from scrolling a parent ScrollView', async () => {
    await game();
    const sv = add(ui.scroll({ width: 500, height: 400, padding: 20 }, [ui.slider({ id: 's', value: 0 }), ui.view({ height: 1200 })]));
    const s = t!.get('#s');
    const b = s.worldBounds();
    await t!.drag({ x: b.x + 30, y: b.y + b.h / 2 }, { x: b.x + b.w - 20, y: b.y + b.h / 2 + 60 });
    expect(s.describe().value).toBeGreaterThan(0.9);
    expect(sv.offset).toBe(0);
  });

  it('ScrollView: drags scroll without tapping, taps still reach children, inertia and bounce', async () => {
    await game();
    let taps = 0;
    const sv = add(
      ui.scroll(
        { width: 400, height: 600 },
        Array.from({ length: 20 }, (_, i) => ui.button({ id: `b${i}`, text: `Item ${i}`, onTap: () => taps++ })),
      ),
    ) as ScrollView;
    expect(sv.maxOffset).toBe(20 * 88 - 600);
    await t!.tap('#b1');
    expect(taps).toBe(1);
    await t!.drag({ x: 200, y: 500 }, { x: 200, y: 100 });
    expect(taps).toBe(1);
    const afterDrag = sv.offset;
    expect(afterDrag).toBeGreaterThan(300);
    await t!.advance(0.3);
    expect(sv.offset).toBeGreaterThan(afterDrag);
    await t!.advance(2);
    expect(sv.offset).toBeLessThanOrEqual(sv.maxOffset);
    sv.scrollTo(0, false);
    await t!.step(1);
    await t!.drag({ x: 200, y: 100 }, { x: 200, y: 400 });
    expect(sv.offset).toBeLessThan(0);
    await t!.advance(1);
    expect(sv.offset).toBe(0);
    const b12 = t!.get('#b12');
    sv.scrollIntoView(b12, false);
    await t!.step(1);
    await t!.tap(b12);
    expect(taps).toBe(2);
  });

  it('ListView only builds visible rows and rebuilds them while scrolling', async () => {
    await game();
    let tapped = -1;
    const lv = add(
      ui.list({
        width: 400,
        height: 600,
        count: 10000,
        itemHeight: 100,
        gap: 10,
        renderItem: (i) => ui.button({ id: `row${i}`, text: `Row ${i}`, onTap: () => (tapped = i) }),
      }),
    ) as ListView;
    await t!.step(1);
    expect(lv.content.children.length).toBeLessThan(12);
    expect(t!.find('#row0')).not.toBeNull();
    expect(t!.find('#row100')).toBeNull();
    const r0 = t!.get('#row0').worldBounds();
    expect(r0).toMatchObject({ x: 0, y: 0, w: 400, h: 100 });
    lv.scrollToIndex(5000, false);
    await t!.step(1);
    expect(t!.find('#row0')).toBeNull();
    expect(t!.find('#row5000')).not.toBeNull();
    await t!.tap('#row5001');
    expect(tapped).toBe(5001);
  });

  it('Modal opens in the overlay, blocks the scene and closes via backdrop, X and dialog buttons', async () => {
    await game();
    let sceneTaps = 0;
    t!.game.sceneLayer.add(new Box(750, 1334, { fill: '#123' })).onTap(() => sceneTaps++);
    let closedWith: string | null | undefined;
    const m = showModal({ title: 'Hello', onClose: (r) => (closedWith = r) }, [ui.text('Body', { id: 'body' })]);
    await t!.advance(0.5);
    expect(m.parent).toBe(t!.game.overlay);
    expect(t!.find('Modal Label[text=Body]')).not.toBeNull();
    await t!.tap({ x: 20, y: 20 });
    await t!.advance(0.5);
    expect(closedWith).toBe('backdrop');
    expect(m.destroyed).toBe(true);
    expect(sceneTaps).toBe(0);

    const m2 = showModal({ title: 'Sticky', closeOnBackdrop: false });
    await t!.advance(0.5);
    await t!.tap({ x: 20, y: 20 });
    await t!.advance(0.5);
    expect(m2.isOpen).toBe(true);
    await t!.tap('Modal IconButton[label=Close]');
    await t!.advance(0.5);
    expect(m2.result).toBe('close');
    expect(m2.destroyed).toBe(true);

    const d = showDialog({ title: 'Quit?', buttons: [{ text: 'Yes', action: 'yes' }, { text: 'No', action: 'no' }] });
    await t!.advance(0.5);
    await t!.tap('Dialog Button[text=Yes]');
    await t!.advance(0.5);
    await expect(d.closed).resolves.toBe('yes');
    expect(t!.find('Dialog')).toBeNull();
    await t!.tap({ x: 20, y: 20 });
    expect(sceneTaps).toBe(1);
  });

  it('toasts are queued and auto-hide', async () => {
    await game();
    showToast('First');
    showToast('Second', { icon: 'check', variant: 'success' });
    await t!.advance(0.5);
    expect(t!.find('Toast[text=First]')?.describe().state).toBe('showing');
    expect(t!.find('Toast[text=Second]')?.visible).toBe(false);
    await t!.advance(2.5);
    expect(t!.find('Toast[text=First]')).toBeNull();
    expect(t!.find('Toast[text=Second]')?.describe().state).toBe('showing');
    await t!.advance(3);
    expect(t!.find('Toast')).toBeNull();
  });

  it('RichText parses markup, wraps, and exposes plain text', async () => {
    await game();
    const runs = parseRichText('a [b]bold [color=#f00]red[/color][/b] [icon=coin] [size=40]big[/size]', {
      color: 'text',
      bold: false,
      italic: false,
      size: 30,
    });
    expect(runs.map((r) => r.text ?? `{${r.icon}}`)).toEqual(['a ', 'bold ', 'red', ' ', '{coin}', ' ', 'big']);
    expect(runs[2]!.style).toMatchObject({ bold: true, color: '#f00' });
    expect(runs[6]!.style.size).toBe(40);
    expect(stripRichText('Get [b]3[/b] [icon=star]')).toBe('Get 3 {star}');
    const rt = add(ui.column({ width: 300 }, [new RichText('Collect [color=gold][b]three shiny stars[/b][/color] to unlock the next world [icon=star]')]));
    const r = rt.children[0] as RichText;
    expect(r.width).toBe(300);
    expect(r.lineCount).toBeGreaterThan(1);
    expect(r.describe().text).toContain('three shiny stars');
  });

  it('switches themes at runtime', async () => {
    await game();
    const l = add(ui.column({}, [ui.text('Hi', { color: 'text' })])).children[0] as Label;
    expect(l.style.color).toBe(darkUITheme.colors.text);
    setUITheme('light');
    await t!.step(1);
    expect(l.style.color).toBe(lightUITheme.colors.text);
  });

  it.each([darkUITheme, lightUITheme])('theme %# keeps on-colors and text readable (>= 3:1)', (theme: UITheme) => {
    const c = theme.colors;
    const pairs: [string, string][] = [
      [c.primary, c.onPrimary],
      [c.secondary, c.onSecondary],
      [c.success, c.onSuccess],
      [c.danger, c.onDanger],
      [c.warning, c.onWarning],
      [c.bg, c.text],
      [c.surface, c.text],
      [c.surfaceAlt, c.text],
      [c.bg, c.textDim],
      [c.surface, c.textDim],
      [c.track, c.text],
    ];
    for (const [bg, fg] of pairs) expect(contrastRatio(bg, fg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
  });
});
