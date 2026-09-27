---
name: ui-screens
description: Builds and verifies game UI with the engine's ui module - mountScreen with the safe area, the typed ui.* builder and JSON buildUI specs, flexbox layout props and theme tokens (xs..xxl), the widget catalogue (buttons, icon buttons, labels, rich text, progress, slider, toggle, checkbox, segmented, tabs, grid, scroll/list, badge, stars, images, icons), modal/dialog/toast, themes (setUITheme, createUITheme), HUD that follows world objects (followNode, pinToNode, convertPoint, nodeRect) and keep-clear areas UI must not cover (lint-keep-clear), and the UI lint (roles, lint-* tags, pnpm shot --lint --bounds on three devices) with a fix for every lint rule. Use when creating or changing a HUD, menu, title screen, settings, pause or result dialog, shop, list or any text/button layout, or when fixing overlapping, cut-off, off-screen, low-contrast or too-small UI ("UI", "HUD", "menu", "screen", "button", "dialog", "popup", "layout", "safe area", "lint", "界面", "菜单", "按钮", "弹窗", "对话框", "布局", "刘海屏", "安全区").
---

# UI screens

Build UI with `ui.*` + `mountScreen`, then prove it with `lintUI` on three devices and a screenshot you Read.
All names below are exported from `'@engine'` (source: `engine/ui/`). Examples: `sandbox/scenes/ui.ts`
(`ui-kit`, `ui-menu`, `ui-list` scenes), `game/scenes/title.ts`, `game/scenes/play.ts` (HUD, pause, game over).

## 1. Mount a screen

```ts
import { mountScreen, Scene, ui } from '@engine';

class MenuScene extends Scene {
  override onEnter(): void {
    mountScreen(
      this,
      ui.column({ align: 'center', padding: ['xxl', 'lg', 'xl', 'lg'], gap: 'md' }, [
        ui.title('My Game', { id: 'title' }),
        ui.spacer(),
        ui.button({ id: 'start', text: 'Start', icon: 'play', variant: 'success', size: 'xl', width: 460, onTap: () => void this.game.scenes.go('play') }),
      ]),
    );
  }
}
```

- `mountScreen(parent, content, opts)` puts `content` (a node or a `UISpec`) in a `UIScreen` that tracks an
  area every frame (resize, safe-area changes) and stretches the content to fill it. Returns `content`. `opts.area`: `'safe'` (default, `game.safe`), `'view'`
  (whole visible area), a `Rect`, or a getter `(parent) => Rect` in the mount parent's coordinates such as
  `followNode(worldNode)` (section 7). `opts.background` paints the whole view behind it.
  `opts.safeArea` is a deprecated alias (`false` = `'view'`); omit it.
- Mounting again on the same parent replaces the previous screen unless `replace: false`. For a HUD over a game
  world, mount into a dedicated child so other mounts survive:
  `mountScreen(this.add(new Node({ id: 'hud', width: this.width, height: this.height })), hud)`.
- Size things against `game.view` / `game.safe`, never the 750x1334 design size: iphone-14 is 750x1623 and
  ipad 1001x1334 design units.

## 2. Builder

Containers take `(props, children)`; leaves take their main value first. Children may be `false`/`null`
(`[isVip && ui.badge({ dot: true })]`).

| Builder | Makes | Notes |
|---|---|---|
| `ui.column / row / stack / view(props, kids)` | `UIView` | row defaults `align: 'center'`; stack overlays children centred |
| `ui.panel(props, kids)` | `Panel` | `variant: 'surface' / 'raised' / 'inset' / 'glass'` |
| `ui.text(text, props)` / `ui.title(text, props)` | `Label` | `variant`, `size`, `color`, `weight`, `align`, `maxLines`, `stroke`, `shadow`, `autoFit` |
| `ui.richText(markup, props)` | `RichText` | `[b] [i] [color=gold] [size=40] [icon=coin]` |
| `ui.button(text or props, props)` | `Button` | `variant`, `size` sm/md/lg/xl, `icon`, `iconRight`, `badge`, `disabled`, `color` |
| `ui.iconButton({ icon, label })` | `IconButton` | `size` sm 72 / md 88 / lg 104 / number, `shape` circle/rounded; always give `label` |
| `ui.icon(src, props)` / `ui.image(src, props)` | `UIIcon` / `UIImage` | icon `size`, `color` (glyphs only); both `tint` / `tintMode` / `duotone: [dark, light]` recolour textures (cached); image `fit` contain/cover/fill |
| `ui.progress / slider / toggle / checkbox / segmented(props)` | controls | `value` + `onChange`; see references/widgets.md |
| `ui.scroll(props, kids)` / `ui.list({ count, itemHeight, renderItem })` | `ScrollView` / `ListView` | list is virtualized; `list.refresh()` |
| `ui.grid({ columns, cellAspect }, kids)` / `ui.tabs({ labels }, pages)` | `UIGrid` / `Tabs` | |
| `ui.badge / stars(props)` | decor | badge `count`/`dot`; stars `value`, `max`, `animate` |
| `ui.spacer(size?)` / `ui.divider()` | | spacer without size = flexible gap |
| `ui.node(anyNode, props)` | the node | adds layout/id/tap props to a Sprite, Box or custom Node |
| `ui.modal / dialog(props, kids)` | closed Modal/Dialog | call `.open()`; or use `showModal` / `showDialog` |

JSON specs (for data-driven or generated screens): `buildUI({ type: 'column', props: { gap: 'md' }, children: ['Hello', { type: 'button', props: { text: 'Go', onTap: 'go' } }] })`.
String children become Labels; string `onTap` values emit `uiEvents` `'action'` (`uiEvents.on('action', ({ name }) => ...)`).
`registerUIType('coinCounter', (props, kids) => ...)` adds your own types; unknown types throw with the known list.

## 3. Layout props

Item props (any child): `width`, `height` (number, `'50%'`, `'auto'`), `minWidth`, `maxWidth`, `minHeight`,
`maxHeight`, `aspectRatio`, `grow`, `shrink` (default 1), `basis`, `alignSelf`, `margin`,
`position: 'flow' | 'absolute' | 'manual'` with `left/top/right/bottom/inset/center` for absolute.

Container props: `direction` (`column` default, `row`, `stack`), `gap`, `crossGap`, `padding`, `align`
(`start/center/end/stretch`, default stretch), `justify` (`start/center/end/between/around/evenly`), `wrap`.

Spacing: number, token, `[vertical, horizontal]` or `[top, right, bottom, left]`.

Box props on views: `fill`, `gradient` (`['#a', '#b']` or `{ colors, dir: 'down' | 'right' | 'diagonal' }`),
`radius`, `border` (`color` or `{ color, width }`), `shadow`, plus `lintRole`, `kind` (name in dumps).

Tokens (both built-in themes):

| Kind | Tokens |
|---|---|
| spacing | `xs` 8, `sm` 12, `md` 16, `lg` 24, `xl` 32, `xxl` 48 |
| radius | `sm` 12, `md` 20, `lg` 32, `xl` 44, `full` (pill/circle) |
| shadow | `sm`, `md`, `lg` |
| text variant | `title` 84 bold + stroke, `h1` 52, `h2` 38, `body` 30, `caption` 24 (textDim), `button` 34 |
| colors | `bg surface surfaceAlt primary onPrimary secondary onSecondary success onSuccess danger onDanger warning onWarning text textDim border backdrop track gold` |

Every color prop takes a token or any CSS color.

## 4. Modals, dialogs, toasts

```ts
import { isAudioMuted, setAudioMuted, showDialog, showModal, showToast, ui } from '@engine';

function openPause(onResume: () => void, onRestart: () => void): void {
  const modal = showModal({ title: '暂停', closeButton: false, closeOnBackdrop: false }, [
    ui.row({ justify: 'between', width: 440 }, [
      ui.text('音乐', { variant: 'body' }),
      ui.toggle({ id: 'music-toggle', value: !isAudioMuted('music'), onChange: (on) => setAudioMuted('music', !on) }),
    ]),
    ui.button({ id: 'resume', text: '继续游戏', variant: 'success', size: 'lg', width: 440, onTap: () => modal.close('resume') }),
    ui.button({ id: 'restart', text: '重新开始', variant: 'secondary', size: 'lg', width: 440, onTap: () => modal.close('restart') }),
  ]);
  void modal.closed.then((r) => (r === 'restart' ? onRestart() : onResume()));
}

async function confirmQuit(): Promise<boolean> {
  const r = await showDialog({ title: 'Quit?', message: 'Progress is saved.', buttons: [
    { text: 'Stay', action: 'stay', variant: 'secondary' },
    { text: 'Quit', action: 'quit', variant: 'danger' },
  ] }).closed;
  if (r === 'quit') showToast('Saved!', { icon: 'check', variant: 'success' });
  return r === 'quit';
}
```

- Modals live in `game.overlay`, centred in the safe area, with a blocker backdrop. `modal.closed` resolves
  with the button action, `'close'` (X), `'backdrop'` or `null`. `animation: 'sheet'` slides up from the bottom.
- Dialog buttons: `{ text, action, variant, icon, keepOpen, onTap }`; >2 buttons stack vertically (or `vertical`).
- The game keeps running under a modal: pause your simulation yourself (a `halted` flag) until `closed`.
- `showToast(text, { icon, variant: 'info' | 'success' | 'warning' | 'danger', duration, position })`, one at a time.
- `openModalsOf()` lists open modals (tests: `expect(openModalsOf().length).toBe(1)`).

## 5. Themes

`setUITheme('light' | 'dark' | theme)` in `boot()` before building UI (default is dark). Derive a brand theme:

```ts
import { createUITheme, lightUITheme, setUITheme } from '@engine';

setUITheme(createUITheme(lightUITheme, { name: 'candy', colors: { primary: '#ff5d8f', gold: '#ffc23d' }, typography: { title: { stroke: { color: '#b4235a', width: 12 } } } }));
```

Widgets read the theme at draw time. Hook UI sounds once: `uiEvents.on('tap', () => playSound('click'))`
(every Button/Toggle/Checkbox/Segmented/Tabs activation emits `'tap'`; value controls also emit `'change'`).

## 6. Verify: lint + screenshots

```powershell
pnpm shot --app game --scene title --device "iphone-se,iphone-14,ipad" --lint --bounds
pnpm shot --app game --scene play --tap "#pause" --wait 0.5 --device "iphone-se,iphone-14,ipad" --lint
```

Quote comma lists in PowerShell (unquoted `a,b,c` becomes three words and the CLI rejects it). Output goes to
`.shots/<app>-<scene>-<device>.png` (+ `-bounds.png`); `--lint` prints `formatLint` per device and sets exit
code 1 on errors. `--tap <selector>` (repeatable) and `--wait <s>` open dialogs before the shot. Read the PNGs,
especially `-bounds.png` (blue containers, green controls with lighter tap areas, yellow text, red/orange issues,
cyan hatched keep-clear areas).

Same check in a test (pattern of `game/play.test.ts`; `tests/ui-scenes.test.ts` does it for every sandbox UI scene):

```ts
// game/title.test.ts
import { createTestGame } from '@engine/testing';
import { drawUIBounds, formatLint, lintUI } from '@engine';
import { expect, it } from 'vitest';
import app from './main';

it('title screen is clean on three devices', async () => {
  for (const device of ['iphone-se', 'iphone-14', 'ipad'] as const) {
    const t = await createTestGame({ app, device, scene: 'title' });
    await t.advance(0.5);
    const issues = lintUI(t.game.stage, t.game);
    await t.screenshot(`.shots/title-${device}-bounds.png`, { overlay: (ctx, game) => drawUIBounds(ctx, game.stage, { game, lint: issues }) });
    expect(issues.filter((i) => i.severity === 'error'), `${device}\n${formatLint(issues)}`).toHaveLength(0);
    t.destroy();
  }
});
```

Lint the whole stage (not just your screen) so overlay modals and toasts count.

Roles decide what lint checks: `control` (tappable: size, overlap), `surface` (touch/drag area such as a
scroll view or the play area), `blocker` (backdrop: everything painted earlier under it is skipped),
`decor` (ignored for overlaps/placement). Widgets set theirs; plain nodes use tags `lint-control`,
`lint-surface`, `lint-blocker`, `lint-decor`, and `lint-ignore` skips a subtree (every `World` has it).
Interactive nodes without a role count as controls. `lint-keep-clear` marks a game-world area UI must not paint
over, also inside a `lint-ignore` subtree (section 7).

| Rule (severity) | Typical cause | Fix |
|---|---|---|
| `interactive-overlap` (error) | two controls share > 2x2 px; a full-screen touch node overlaps buttons | more `gap`; tag the touch area `lint-surface`; purely visual interactive nodes `lint-decor` |
| `text-overlap` (error) | absolute/manual texts collide, fixed heights too small | put texts in a column/row; remove fixed `height`; `maxLines` + `autoFit` |
| `outside-view` (error) | content wider than the view on iphone-se or hard-coded x/y | `width: '100%'`/`maxWidth` instead of fixed widths; `wrap: true`; lay out from `game.view` |
| `outside-safe` (warn) | HUD placed at y=0 or bottom edge | mount with the default `'safe'` area; only backgrounds go outside |
| `text-truncated` (warn) | `maxLines`/`autoFit` could not fit | shorter copy, wider box, lower `autoFit` minimum, allow another line |
| `text-overflow` (error) | a single word wider than its box, or text bigger than its container | `autoFit: 20`, give the parent room (`grow: 1`, `minWidth: 0` on siblings), shorten |
| `small-tap-target` (warn) | control hit area < 88x88 | `size: 'md'` or larger, `hitPadding`, IconButton `size >= 88`; Buttons auto-pad their hit area |
| `low-contrast` (error) | text vs background < 3:1 (e.g. `textDim` on a similar fill) | use `on*` tokens on colored fills, add `stroke` (>= 2 px counts), darker/lighter color |
| `small-font` (warn) | text < 20 design units | `caption` (24) is the smallest variant; drop `size` overrides below 20 |
| `duplicate-id` (error) | same `id` twice (often a reused builder) | ids from data (`slot-${i}`) or none |
| `empty-label` (warn) | `''` text or a Button without text and icon | give text/icon, or don't create it |
| `invisible-interactive` (error) | alpha ~0 node still interactive | `visible = false` or `interactive = false` while hidden |
| `zero-size-interactive` (warn) | interactive node with no size | give it `width/height` or `hitPadding` |
| `missing-texture` (warn) | icon/image name with no texture and no glyph | use a glyph name (below) or register the texture first |
| `covers-keep-clear` (error) | a panel, button, text or icon over a `lint-keep-clear` world area (enemy, player, aim line) | lay out around it (`followNode`, safe-area columns); a deliberate translucent overlay gets `lintRole: 'decor'` |

Tune per call only with a reason: `lintUI(root, game, { rules: { 'small-font': 'off' }, minTap: 72, ignore: (n) => n.id === 'debug' })`.

## 7. HUD on world objects, keep-clear areas

HUD that belongs to something in the game world (bars on a tower, a name tag over a unit, a button by a chest)
follows that node instead of converting coordinates by hand, so it stays on it when the world scrolls, zooms,
shakes or the screen resizes. Example: `archer/scenes/play.ts` (tower HUD), `archer/scenes/battle-fx.ts`.

```ts
import { convertPoint, followNode, mountScreen, Node, nodeRect, pinToNode, ui } from '@engine';

// a laid-out screen filling the tower's face, re-laid out before every frame
const hudLayer = this.add(new Node({ id: 'tower-hud', width: this.width, height: this.height }));
mountScreen(hudLayer, ui.column({ align: 'center', gap: 8 }, [hpBar, jumpButton]), {
  area: followNode(towerNode, { pad: [18, 10, 8, 10], minWidth: 150, minHeight: 160, anchor: { x: 0.5, y: 0 }, clamp: 'safe' }),
});

// one node pinned to a point of a world node, every frame after the world moved
const stop = pinToNode(nameTag, enemyNode, { at: (e) => ({ x: e.width / 2, y: 0 }), offset: { x: 0, y: -12 }, hideWithTarget: true });

// one-off conversions (null = stage): popups, flying coins
const p = convertPoint(enemyNode, this.fxLayer, enemyNode.width / 2, 0);
const box = nodeRect(towerNode, undefined, hudLayer); // its content box as an AABB in hudLayer's coordinates
```

- `followNode(target, opts)` returns a getter `(space?) => Rect`. Steps: the target's content box (or `rect`, a
  local rect or `(target) => Rect`) as an axis-aligned box in `space` -> `offset` -> `clamp` (`'safe'`, `'view'`
  or a stage `Rect`; each edge pushed inside) -> `pad` (inset, number or `[top, right, bottom, left]`, negative
  grows) -> `minWidth` / `minHeight` grown around `anchor` (fractions of the box, default centre). `mountScreen`
  passes the mount parent as `space`; elsewhere set `space` (or pass it to the getter; default stage). A destroyed
  target keeps its last rect.
- `pinToNode(node, target, opts)` sets `node.x/y` in `node.parent`'s space on every game `'update'` (after the stage
  tick, before render); `at` defaults to the target's content-box centre; `hideWithTarget` copies
  `target.worldVisible`. Stops when either node is destroyed; the returned function stops it too. Pin nodes that
  no flex container positions.
- The target needs a real box: give world nodes a `width/height` (and anchor) matching what they draw, or pass
  `rect`. Don't chain `field.toWorld(...)` / `hud.toLocal(...)` or `field.x + x * field.scaleX` by hand.

Keep-clear areas: tag the world nodes UI must never paint over (enemy, player, aim line) with `lint-keep-clear`;
it works inside `lint-ignore` subtrees such as a `World`. `lintUI` then reports every visible control, panel,
text, icon or image painted after the area that overlaps it by more than 2 units on both axes (`covers-keep-clear`,
error, once per outermost node, `issue.other` = the area node). Decor, `lint-ignore` subtrees, and anything
painted before the area or hidden under a later blocker (modal backdrop) don't count. `pnpm shot --lint` enforces
it and `--bounds` hatches the areas in cyan.

```ts
// area = content box in local coordinates; a keepClearRect() method overrides it (e.g. bow + HP bar above)
class EnemyNode extends Node {
  keepClearRect(): Rect { return { x: -40, y: -60, w: this.width + 80, h: this.height + 60 }; }
}
const enemy = world.add(new EnemyNode({ tags: ['lint-keep-clear'], width: 80, height: 160 }));

// areas without a node, per call: stage rects, { rect, name } or nodes (these count against all UI)
lintUI(game.stage, game, { keepClear: [aimRect, { rect: bossRect, name: 'boss' }, chestNode] });
keepClearZones(game.stage, game); // the active areas, in stage coordinates (tests)
```

- UI laid over a live scene (a start menu over the idle battle) can declare its own areas: a `lint-ignore` node
  transformed like the world with `lint-keep-clear` children (archer `menu.ts`, `keepClearAreas`).
- Overlays meant to sit on an area (a translucent zone panel) get `lintRole: 'decor'`.
- Test the guarantee both ways: no `covers-keep-clear` issues, and moving a button onto the area makes one
  (`archer/menu.test.ts`).

## Icons

`icon` props accept a `Texture`, a registry key, or a name. Names resolve in this order: texture `name`,
texture `icon:<name>`, built-in vector glyph. Glyphs (tinted with `color`): `close back next plus minus check
menu pause play settings star heart coin gem energy lock home sound mute music info trophy gift video shop user
mail refresh share question rank calendar` (+ aliases `x cross left right add ok gear cog diamond bolt volume
speaker ad cart store profile leaderboard ranking help arrow_left arrow_right`).
Pitfall: `registerIcons()` (art module) registers `icon:play`, `icon:pause`... which then REPLACE the glyphs in
every button, drawn untinted (white by default). Register art icons under another prefix
(`registerIcons({ prefix: 'art:' })`) unless you want that. Art icon names differ too (`sound-on`, `video-ad`).

## Pitfalls

- Fixed `width`s that fit 750 but not a narrow row: prefer `grow: 1` / `%` / `maxWidth`.
- Text in a row next to buttons: give the text `grow: 1` (and `minWidth: 0` if it must shrink) or `autoFit`.
- Changing `label.text` re-lays out automatically; changing layout props on a plain Node needs `setUILayout`.
- A `Scene` builds UI in `onEnter`; don't build in the constructor (no `game`, no size yet).
- `mountScreen` twice on the scene replaces the first screen: mount HUD parts into separate child nodes.
- Screenshots on one device prove nothing: always iphone-se (short), iphone-14 (tall, notch), ipad (wide).
- CJK text: write it directly; if an edit tool turns it into `?`, use `\u` escapes.

More: every widget's props in `references/widgets.md`.
