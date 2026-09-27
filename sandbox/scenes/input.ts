import {
  Box,
  clamp,
  createInputActions,
  defineStrings,
  detectLocale,
  getLocale,
  i18nMissing,
  inputCodeLabel,
  keyboardInput,
  matchLocale,
  mountScreen,
  onLocaleChange,
  platform,
  punch,
  setLocale,
  tr,
  ui,
  type Label,
  type Node,
  type SceneFactory,
} from '@engine';
import { DemoScene } from '../common';

// ---------------------------------------------------------------- input-keys

const CONTROLS = {
  left: ['ArrowLeft', 'KeyA', 'PadLeft', 'PadLStickLeft'],
  right: ['ArrowRight', 'KeyD', 'PadRight', 'PadLStickRight'],
  jump: ['Space', 'ArrowUp', 'KeyW', 'PadA'],
};

const bindingText = (codes: string[]) => codes.filter((c) => !c.startsWith('Pad')).map(inputCodeLabel).join('  ');

/**
 * Keyboard + on-screen buttons driving the same actions: a box that runs and jumps, live action / key readouts and
 * runtime rebinding of 'jump'. Params `{ press: ['KeyD', 'Space'] }` hold keys (for screenshots).
 */
class InputKeysScene extends DemoScene {
  readonly title = 'Input · Keys';

  protected build(params?: unknown): void {
    const kb = keyboardInput(this.game);
    const input = createInputActions(this, CONTROLS);

    const actionsText = ui.text('\u2014', { id: 'actions', weight: 'bold', color: 'gold', grow: 1 });
    const keysText = ui.text('\u2014', { id: 'keys', grow: 1 });
    const jumpKeys = ui.text(bindingText(input.bindings('jump')), { id: 'jump-keys', grow: 1 });
    let rebinding: (() => void) | null = null;
    const rebind = ui.button({
      id: 'rebind',
      text: 'Rebind',
      size: 'sm',
      variant: 'secondary',
      onTap: () => {
        if (rebinding) {
          rebinding();
          rebinding = null;
          rebind.text = 'Rebind';
          return;
        }
        rebind.text = 'Press a key';
        rebinding = kb.onPress(
          '*',
          (e) => {
            input.rebind('jump', [e.code, 'PadA']);
            jumpKeys.text = bindingText(input.bindings('jump'));
            rebinding?.();
            rebinding = null;
            rebind.text = 'Rebind';
          },
          this,
        );
      },
    });

    const arena = ui.view({ id: 'arena', grow: 1, minHeight: 240, fill: '#10131a', radius: 'lg', clip: true, tags: ['lint-ignore'] });
    const ground = arena.add(ui.node(new Box(10, 8, { fill: '#2b3140' }, { id: 'ground' }), { position: 'manual' }));
    const hero = arena.add(
      ui.node(new Box(96, 96, { fill: '#f59e0b', radius: 22 }, { id: 'hero', anchorX: 0.5, anchorY: 1 }), { position: 'manual' }),
    );

    const left = ui.button({ id: 'btn-left', icon: 'back', size: 'lg', variant: 'secondary' });
    const right = ui.button({ id: 'btn-right', icon: 'next', size: 'lg', variant: 'secondary' });
    const jump = ui.button({ id: 'btn-jump', text: 'Jump', size: 'lg', variant: 'success' });
    input.bindHold('left', left);
    input.bindHold('right', right);
    input.bindHold('jump', jump);

    const row = (label: string, value: Node, extra?: Node) =>
      ui.row({ gap: 'md' }, [ui.text(label, { variant: 'caption', minWidth: 120 }), value, extra]);

    mountScreen(
      this,
      ui.column({ padding: 'lg', gap: 'md' }, [
        ui.panel({ gap: 'sm', padding: 'md' }, [
          ui.text(kb.supported ? 'Arrows / WASD move, Space / W / \u2191 jump. The buttons drive the same actions.' : 'No keyboard here: use the buttons.', {
            variant: 'caption',
          }),
          row('Actions', actionsText),
          row('Keys', keysText),
          row('Jump', jumpKeys, rebind),
        ]),
        arena,
        ui.row({ justify: 'between' }, [ui.row({ gap: 'md' }, [left, right]), jump]),
      ]),
      { area: () => this.content },
    );

    for (const code of (params as { press?: string[] } | undefined)?.press ?? []) kb.handleKey({ type: 'down', code, key: '', repeat: false });

    let x = -1;
    let lift = 0;
    let vy = 0;
    hero.onUpdate((dt) => {
      if (input.pressed('jump') && lift === 0) {
        vy = 1250;
        punch(hero, 1.1, 0.15);
      }
      vy -= 3200 * dt;
      lift = Math.max(0, lift + vy * dt);
      if (lift === 0) vy = 0;
      actionsText.text = input.downActions().join(' + ') || '\u2014';
      keysText.text = kb.downCodes().map(inputCodeLabel).join(' ') || '\u2014';
      const w = arena.width;
      if (w <= 0) return;
      if (x < 0) x = w / 2;
      x = clamp(x + input.axis('left', 'right') * 520 * dt, 60, w - 60);
      const floor = arena.height - 36;
      hero.x = x;
      hero.y = floor - lift;
      ground.x = 0;
      ground.y = floor;
      ground.width = w;
    });
  }
}

// ---------------------------------------------------------------- i18n

const LOCALES = ['zh-CN', 'en'];

const STRINGS = {
  en: {
    demo: {
      language: 'Language',
      system: 'System {system} \u2192 detected {detected}, current {current}',
      greeting: 'Welcome back, {name}!',
      player: 'Captain',
      coins: { one: 'You found {count} coin', other: 'You found {count} coins' },
      lives: { zero: 'No lives left', one: 'One life left', other: '{count} lives left' },
      hint: 'Switching the language rebuilds this screen from the string tables.',
      fallback: 'This line only exists in English: other locales fall back to it.',
      missing: 'Missing: {list}',
      none: 'none',
      play: 'Play',
      settings: 'Settings',
    },
  },
  'zh-CN': {
    demo: {
      language: '\u8bed\u8a00',
      system: '\u7cfb\u7edf {system} \u2192 \u68c0\u6d4b\u4e3a {detected}\uff0c\u5f53\u524d {current}',
      greeting: '\u6b22\u8fce\u56de\u6765\uff0c{name}\uff01',
      player: '\u8239\u957f',
      coins: '\u4f60\u627e\u5230\u4e86 {count} \u679a\u91d1\u5e01',
      lives: { zero: '\u6ca1\u6709\u5269\u4f59\u751f\u547d', other: '\u5269\u4f59 {count} \u6761\u751f\u547d' },
      hint: '\u5207\u6362\u8bed\u8a00\u540e\uff0c\u6574\u4e2a\u9875\u9762\u4f1a\u6309\u5b57\u7b26\u4e32\u8868\u91cd\u65b0\u751f\u6210\u3002',
      missing: '\u7f3a\u5931\uff1a{list}',
      none: '\u65e0',
      play: '\u5f00\u59cb',
      settings: '\u8bbe\u7f6e',
    },
  },
};

let detected = false;

/** zh-CN / en switch with a SegmentedControl; the whole screen is rebuilt on every locale change. */
class I18nScene extends DemoScene {
  readonly title = 'i18n';

  protected build(): void {
    defineStrings(STRINGS);
    if (!detected) {
      detected = true;
      setLocale('auto');
    }
    this.rebuild();
    onLocaleChange(() => this.rebuild(), this);
  }

  private rebuild(): void {
    const selected = Math.max(0, LOCALES.indexOf(matchLocale(getLocale(), LOCALES)));
    const lines: Label[] = [
      ui.text(tr('demo.coins', { count: 1 }), { id: 'coins-1' }),
      ui.text(tr('demo.coins', { count: 5 }), { id: 'coins-5' }),
      ui.text(tr('demo.lives', { count: 0 }), { id: 'lives-0' }),
      ui.text(tr('demo.lives', { count: 3 }), { id: 'lives-3' }),
      ui.text(tr('demo.fallback'), { id: 'fallback', color: 'textDim' }),
    ];
    const missing = i18nMissing();
    mountScreen(
      this,
      ui.column({ padding: 'lg', gap: 'lg' }, [
        ui.panel({ gap: 'md', padding: 'lg' }, [
          ui.text(tr('demo.language'), { variant: 'caption' }),
          ui.segmented({ id: 'locale', options: ['\u4e2d\u6587', 'English'], selected, onChange: (i) => setLocale(LOCALES[i]!) }),
          ui.text(tr('demo.system', { system: platform().language ?? '?', detected: detectLocale(), current: getLocale() }), {
            id: 'locale-info',
            variant: 'caption',
          }),
        ]),
        ui.panel({ gap: 'md', padding: 'lg' }, [
          ui.text(tr('demo.greeting', { name: tr('demo.player') }), { id: 'greeting', variant: 'h2' }),
          ...lines,
        ]),
        ui.row({ gap: 'md', justify: 'center' }, [
          ui.button({ id: 'play', text: tr('demo.play'), size: 'lg', variant: 'success' }),
          ui.button({ id: 'settings', text: tr('demo.settings'), size: 'lg', variant: 'secondary' }),
        ]),
        ui.text(tr('demo.hint'), { variant: 'caption', align: 'center' }),
        ui.text(tr('demo.missing', { list: missing.length ? missing.join(', ') : tr('demo.none') }), { id: 'missing', variant: 'caption', align: 'center' }),
      ]),
      { area: () => this.content },
    );
  }
}

export const scenes: Record<string, SceneFactory> = {
  'input-keys': () => new InputKeysScene(),
  i18n: () => new I18nScene(),
};
