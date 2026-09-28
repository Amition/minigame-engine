---
name: input-and-i18n
description: >-
  Player input and localization with this engine. Touch basics (node.onTap, pointer event bubbling and implicit
  capture, stage-level pointer events, draggable / swipe / long press / double tap / pinch, VirtualJoystick),
  keyboard state (keyboardInput: isDown, justPressed, justReleased, onPress), gamepads (gamepadInput, web only),
  and input actions (createInputActions: named controls like jump / left / right bound to keys, gamepad buttons,
  sticks, on-screen buttons and joysticks, axis / vector, runtime rebinding). Then i18n: defineStrings string
  tables, tr() with {name} interpolation and plural forms, locale fallback chain, setLocale('auto') detection from
  the system language, onLocaleChange / bindTr to rebuild screens, missing-key reports for tests. Use it when adding
  controls, keyboard or gamepad support, PC mini-game keys, on-screen buttons, key remapping, or when translating a
  game (localization, translation, multi-language, 多语言, 键盘, 手柄, 翻译), and when testing either.
---

# Input and localization (输入 / 键盘 / 多语言)

Everything is imported from `'@engine'`. Phones have only touch: keyboard and gamepad are extras for web and PC
mini-game clients, so every game must stay fully playable by touch. Input actions let one piece of game logic
read touch buttons, keys and gamepads alike.

| Need | Use |
| --- | --- |
| Tap a button or object | `node.onTap(fn)` / `ui.button({ onTap })` |
| Drag, swipe, long press, double tap, pinch | `draggable`, `onSwipe`, `onLongPress`, `onDoubleTap`, `pinch` |
| Press, slide, release to aim or throw | `onAim` (see the game-feel skill) |
| Analog movement on a phone | `VirtualJoystick` |
| Movement / jump / fire from keys + touch + pad | `createInputActions(scene, map)` |
| Raw key state, key shortcuts | `keyboardInput(game)` |
| Translated text | `defineStrings`, `tr`, `setLocale`, `onLocaleChange` |

## Touch basics

- `node.onTap(fn)` makes the node interactive. A tap is down + up on the same node without moving more than
  `tapSlop` (24 design units). `hitPadding` enlarges the hit area without changing visuals (min 88 for UI).
- Pointer events (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`, `tap`) go to the topmost interactive
  node under the finger, then **bubble** to its ancestors; `e.stopPropagation()` stops them. `e.x, e.y` are stage
  coordinates, `e.local()` is local to `e.currentTarget`, `e.startX/startY` is where the finger went down.
- Implicit **capture**: move / up / cancel of a pointer always go to the node that got its `pointerdown`, even when
  the finger leaves it. So a node can track a drag on its own.
- Stage-level input: `game.on('pointerdown', (e) => ...)` fires after node dispatch (`e.target` may be null).
  `node.interactiveChildren = false` hides a subtree from hit tests; `game.lockInput()` blocks input (transitions).
- Gestures take the node (or the game for whole-screen gestures) and return a remover:

```ts
draggable(card, { bounds: 'parent', onEnd: (d) => snap(card, d) });
onSwipe(this.game, (dir) => board.move(dir), { owner: this });
onLongPress(slot, () => showInfo(slot), 0.5);
onDoubleTap(hero, () => hero.dash());
let s0 = 1;
pinch(map, (e) => {
  if (e.phase === 'start') s0 = map.scaleX;
  map.setScale(clamp(s0 * e.scale, 0.5, 3));
});
```

- `VirtualJoystick` reads `value` (-1..1 per axis, y down), `magnitude`, `dir4`. Floating mode (default) puts the
  stick where the thumb lands inside its box. See the `runtime-input` sandbox scene.

## Keyboard

`keyboardInput(game?)` returns the game's keyboard (created on first use, dropped with the game). Codes are
`KeyboardEvent.code` strings, independent of layout and language: `'KeyA'`, `'Digit1'`, `'Space'`, `'Enter'`,
`'Escape'`, `'ArrowLeft'`, `'ShiftLeft'`.

```ts
const kb = keyboardInput(this.game);
hero.onUpdate((dt) => {
  if (kb.isDown('ArrowLeft')) hero.x -= 300 * dt;   // live state
  if (kb.justPressed('Space')) hero.jump();          // true for exactly one frame
  if (kb.justReleased('Space')) hero.cutJump();
});
kb.onPress('Escape', () => this.pause(), this);      // fires on arrival, repeats ignored; removed with the scene
kb.onPress('*', (e) => log(e.code));                 // any key
kb.on('keydown', (e) => e.repeat && menu.next());    // raw events include auto-repeat
```

- Edges are frame-based: events between two frames become that frame's `justPressed` / `justReleased`, read them in
  `update()`, `onUpdate()` or a system. A press and release inside one frame shows up as both, so taps are never
  lost. Edges also advance while `game.paused` (pause menus can read keys).
- The keyboard only knows about keys pressed after it was created. Call `keyboardInput(game)` in `boot()` when
  keys held during the first scene matter.
- All keys are released when the page loses focus or the app is hidden, so keys never stick.
- `kb.supported` only says whether the platform has a keyboard API (false on mini-game clients without
  `onKeyDown`, true in every browser, phones included), not whether a keyboard is attached. Always show touch
  controls; never write "press Space" alone.
- `kb.handleKey({ type: 'down', code: 'KeyA', key: 'a', repeat: false })` feeds synthetic keys (on-screen keyboards).

## Input actions

Name what the player does, bind it to anything, read the name. Actions are sampled once per frame.

```ts
const input = createInputActions(this, {            // owner: this scene, destroyed with it
  left: ['ArrowLeft', 'KeyA', 'PadLeft', 'PadLStickLeft'],
  right: ['ArrowRight', 'KeyD', 'PadRight', 'PadLStickRight'],
  up: ['ArrowUp', 'KeyW', 'PadUp', 'PadLStickUp'],
  down: ['ArrowDown', 'KeyS', 'PadDown', 'PadLStickDown'],
  jump: ['Space', 'PadA'],
  pause: ['Escape', 'KeyP', 'PadStart'],
});
input.bindHold('jump', jumpButton);                  // on-screen button (any node) holds the action
input.bindStick(stick, { left: 'left', right: 'right', up: 'up', down: 'down' });

hero.onUpdate((dt) => {
  const v = input.vector('left', 'right', 'up', 'down'); // length <= 1, analog from sticks
  hero.x += v.x * 400 * dt;
  hero.y += v.y * 400 * dt;
  if (input.pressed('jump')) hero.jump();
  if (input.released('jump')) hero.cutJump();
});
input.onPress('pause', () => this.openPause(), this);
```

| Method | Meaning |
| --- | --- |
| `down(a)` / `pressed(a)` / `released(a)` | held / went down this frame / went up this frame |
| `value(a)` | 0..1, strongest source (keys 1, sticks and triggers analog) |
| `axis(neg, pos)` | `value(pos) - value(neg)`, -1..1 |
| `vector(l, r, u, d, out?)` | `{ x, y }` clamped to length 1 (diagonals not faster); pass `out` to reuse an object per frame |
| `downActions()` | held action names (HUD / debug) |
| `bindHold(a, node)` | held while a finger is down on the node (keeps holding when it slides; a very short touch still counts one frame) |
| `bindStick(a, stick)` | VirtualJoystick directions, analog |
| `bindVirtual(a, () => boolean \| number, owner?)` | any polled source |
| `bind` / `unbind` / `rebind(a, codes)` / `bindings(a)` / `toJSON()` | runtime remapping |
| `onPress(a, fn, owner?)` / `onRelease` / `on('pressed', fn)` | events at the start of the frame |
| `enabled = false` | everything reads up (held actions emit released once) |

- The owner can be the `Game` (lives with it) or any node; pass the scene so controls die with it.
- Keys already held when the actions are created do not count as a fresh press (the key that confirmed the menu
  does not also jump in the level).
- `threshold` (default 0.5) decides when an analog value counts as down: `createInputActions(this, map, { threshold: 0.3 })`.
- Prefer `bindHold` over `onTap` for game controls: taps fire on release, holds act on touch.

Remapping and prompts:

```ts
const CONTROLS = { left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], jump: ['Space', 'PadA'] };
type Action = keyof typeof CONTROLS;
const settings = createSettings({ controls: {} as Partial<Record<Action, string[]>> });

const input = createInputActions(this, { ...CONTROLS, ...settings.data.controls });
const off = kb.onPress('*', (e) => {                  // "press a key for Jump"
  off();
  input.rebind('jump', [e.code, 'PadA']);
  settings.set({ controls: input.toJSON() });
}, this);
ui.text(`Jump: ${input.bindings('jump').map(inputCodeLabel).join(' / ')}`); // 'Space / A' ('ArrowUp' → '↑')
```

## Gamepad (web only)

Binding codes are `'Pad' + ` one of `A B X Y LB RB LT RT Back Start LS RS Up Down Left Right Home`
(W3C standard mapping, `A` = bottom face button), plus stick directions `PadLStickLeft|Right|Up|Down` and
`PadRStick...` (0..1 after the dead zone). Actions poll pads automatically when a `Pad*` code is bound.

```ts
const pad = gamepadInput(this.game);    // pad.supported is false outside the web
pad.deadZone = 0.2;
if (pad.connected && pad.justPressed('PadStart')) this.openPause();
const aim = pad.stick('right');         // { x, y } with a radial dead zone; stick(side, pad, out) fills `out`
```

Browsers only report a pad after a button press on the page, and only in secure contexts (https / localhost).

## Testing input

The headless platform injects keys; edges appear on the next step:

```ts
t = await createTestGame({ app, scene: 'level' });
keyboardInput(t.game);                  // only if keys are pressed before the game code creates it
t.platform.key('Space');                // 'down' by default; a second 'down' is a repeat
await t.step();
expect(input.pressed('jump')).toBe(true);
t.platform.key('Space', 'up');
await t.tap('#btn-jump');               // on-screen buttons through bindHold
(t.platform as Platform).pollGamepads = () => [{ index: 0, id: 'pad', standard: true, buttons: [1], axes: [0, 0] }];
```

## Localization (i18n)

String tables are app-wide. Register them once (at module level or in `boot()`), pick the locale at boot, read
strings with `tr(key, params)`.

```ts
defineStrings({
  en: {
    play: 'Play',
    hello: 'Hi {name}!',
    coins: { one: '{count} coin', other: '{count} coins' },          // plural forms by params.count
    lives: { zero: 'No lives', one: 'One life', other: '{count} lives' },
    menu: { settings: 'Settings' },                                 // nested → 'menu.settings'
  },
  'zh-CN': {
    play: '\u5f00\u59cb',
    hello: '\u4f60\u597d\uff0c{name}\uff01',
    coins: '{count} \u4e2a\u91d1\u5e01',                                  // no plural forms needed
    menu: { settings: '\u8bbe\u7f6e' },
  },
});
setLocale('auto');                      // system language via detectLocale(), best defined match
tr('hello', { name: 'Ann' });           // 'Hi Ann!'
tr('coins', { count: 5 });              // '5 coins'
```

- `tr` returns the key itself when nothing matches, so missing strings are visible, never blank.
- Interpolation: `{name}` from params; unknown placeholders stay as written. Plurals use `Intl.PluralRules`
  when the runtime has it (zero / one / two / few / many / other), else the English one / other rule; `zero` wins
  for 0 when defined.
- Lookup chain: `'en-US'` → `'en'` → (no parent defined: another locale of the same language, e.g. `'zh'` →
  `'zh-CN'`; Traditional tags `zh-TW / zh-HK / zh-Hant` prefer a Traditional table) → fallback locale
  (`configureI18n({ fallback: 'en' })`, default `'en'`). `i18nChain()` shows it.
- `setLocale('en-US')` keeps the tag as given (`getLocale()` returns it); `matchLocale(tag, locales)` and
  `detectLocale()` return a defined locale. `normalizeLocale('zh_cn')` → `'zh-CN'`.
- Store the player's choice: `settings.set({ language: getLocale() })`, then at boot
  `setLocale(settings.data.language || 'auto')`.

### Rebuilding screens on a locale change

Text is built from `tr()` when a screen is built, so rebuild it when the locale changes. With `mountScreen`
(which replaces the previous screen on the same parent) this is one line:

```ts
class MenuScene extends Scene {
  override onEnter() {
    this.build();
    onLocaleChange(() => this.build(), this);          // removed with the scene
  }
  private build() {
    mountScreen(this, ui.column({ gap: 'lg', padding: 'lg' }, [
      ui.title(tr('title')),
      ui.segmented({ options: ['\u4e2d\u6587', 'English'], selected: getLocale() === 'en' ? 1 : 0,
        onChange: (i) => setLocale(i === 0 ? 'zh-CN' : 'en') }),
      ui.button({ text: tr('play'), onTap: () => this.game.scenes.go('level') }),
    ]));
  }
}
```

For long-lived labels (HUD) use `bindTr(label, key, params)`: it sets `label.text` now and on every change until
the label is destroyed. `params` can be a function: `bindTr(coins, 'coins', () => ({ count: save.data.coins }))`
re-reads the value on each locale change; when only the value changes, set `coins.text = tr('coins', {...})`.

### Missing keys

- Every key the current locale lacks (found only via the fallback, or nowhere) is recorded once and warned once
  with `console.warn('[i18n] missing ...')`. `configureI18n({ warn: false, onMissing: (key, locale) => ... })`.
- `i18nMissing()` → sorted `'locale:key'` list of misses seen at runtime; `clearI18nMissing()` resets it.
- `i18nUntranslated('zh-CN')` compares whole tables against the fallback without rendering anything:

```ts
beforeEach(() => resetI18n());          // tables, locale, listeners and misses are global
it('translates everything', () => {
  defineStrings(STRINGS);
  expect(i18nUntranslated('zh-CN')).toEqual([]);
  setLocale('zh-CN');
  // ...visit screens, then:
  expect(i18nMissing()).toEqual([]);
});
```

The headless platform reports `language = 'zh-CN'` (set `t.platform.language = 'en-US'` before `detectLocale()`).

### Writing translatable UI

- Leave room: English is often 30-50% longer than Chinese. Let labels wrap (default) or use `autoFit` on
  one-line labels and buttons, then lint every locale: `pnpm shot --scene <s> --tap "Segment[text=English]" --lint`.
- Never concatenate sentence fragments (`tr('you') + n + tr('coins')`); put the whole sentence with
  placeholders in the table, word order differs per language.
- Keep numbers and names in params; keep art free of baked-in text.
- CJK in source files: write `\u` escapes if an edit tool mangles characters (see AGENTS.md).

## Platform notes

| | web | wx | tt | tap | headless |
| --- | --- | --- | --- | --- | --- |
| Keyboard (`onKey`) | yes | PC client only | PC client if the API exists | if the API exists | `t.platform.key()` |
| Gamepad (`pollGamepads`) | yes | no | no | no | assign in tests |
| `language` | `navigator.language` | `getAppBaseInfo`, else `getSystemInfoSync` | same | same | `'zh-CN'` |

- Mini-game keyboards exist only on PC clients (WeChat for Windows / Mac); `wx.onKeyDown / onKeyUp` are
  feature-detected, codes are derived from `key` when the runtime leaves out `code`. Phones never get key
  events, so ship touch controls everywhere and treat keys as a bonus.
- Mini-game languages come as `'zh_CN'` and are normalized to `'zh-CN'`. WeChat reports the WeChat app language,
  not the OS language.
- Fonts: canvas text uses system fonts. Mini-games default to `'sans-serif'`, which covers Chinese, Latin,
  Japanese and Korean on phones. Other scripts (Thai, Arabic, Devanagari) depend on the device; Arabic / Hebrew
  are not laid out right-to-left by the engine. Avoid emoji in UI text (inconsistent glyphs, tofu in headless).
- The web platform prevents page scrolling only for plain arrow / space / page keys and ignores keys typed into
  HTML inputs; `WebPlatform.simulateKey(code, type)` injects keys for browser automation.
