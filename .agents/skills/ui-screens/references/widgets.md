# Widget reference

Every widget also takes the common props (`UINodeProps`): `id`, `tags`, `alpha`, `visible`, `zIndex`, `scale`,
`rotation`, `anchor`, `hitPadding`, `interactive`, `clip`, `data`, `onTap` (function or action name) and all
item layout props (`width`, `height`, `grow`, `margin`, `position`...). Containers (`UIViewProps`) add the
container layout props, box props (`fill`, `gradient`, `radius`, `border`, `shadow`), `kind` and `lintRole`.
Source files are in `engine/ui/`.

## Text

| Widget | Props | Runtime API |
|---|---|---|
| `Label` (`ui.text`, `ui.title`) | `variant` (default body), `color`, `size`, `weight`, `italic`, `align` (left), `lineHeight`, `maxLines` (0 = unlimited, overflow ends with an ellipsis), `stroke {color, width}`, `shadow`, `autoFit` (true = shrink to 18, or a min size; single line) | `label.text = '12'` (re-lays out), `label.restyle({ color: 'danger' })` |
| `RichText` (`ui.richText`) | `variant`, `color`, `size`, `weight`, `align`, `lineHeight`, `maxLines`, `stroke`, `shadow` | `rich.markup = '...'`, `rich.text` (plain), `restyle()` |

Rich markup: `[color=#f55]..[/color]` or `[color=gold]` (token), `[b]..[/b]`, `[i]..[/i]`, `[size=40]..[/size]`,
`[icon=coin]` (inline icon sized to the text). Unknown tags stay literal.

## Buttons

`ButtonProps`: `text`, `icon`, `iconSize`, `iconRight`, `variant` (`primary` default, `secondary`, `success`,
`danger`, `warning`, `neutral`, `ghost`, `plain`), `size` (`sm` 64, `md` 88 default, `lg` 108, `xl` 128 tall;
minimum widths 112/180/280/380 when there is text), `disabled`, `badge` (count, `true` or `'dot'`), `color`
(face override), `textColor`, `radius`, `gap`, `padding`. Hit area grows to 88x88 automatically.
Runtime: `btn.text = 'Next'`, `btn.disabled = true`, `btn.setVariant('danger')`, `btn.setBadge(3)`.

`IconButtonProps`: same minus `text/size/icon/iconRight`, plus `icon` (required), `label` (accessible name;
selectors `IconButton[label=Settings]`), `size` (`sm` 72, `md` 88, `lg` 104 or number), `shape`
(`circle` default, `rounded`). Default variant `neutral`.

## Value controls

| Widget | Props | Runtime |
|---|---|---|
| `ProgressBar` (`ui.progress`) | `value` (0..1, or 0..max), `max`, `color`, `trackColor`, `label` (true = `75%` or `value/max`), `thickness` (32; 36+ with a label), `animate` (true) | `bar.value = 0.4` |
| `Slider` | `value`, `min`, `max`, `step` (0 = continuous), `color`, `disabled`, `onChange(value)` | `slider.value` |
| `Toggle` | `value`, `color`, `disabled`, `onChange(on)` | `toggle.value` |
| `Checkbox` | `checked`, `text`, `color`, `disabled`, `onChange(checked)` | `box.checked` |
| `SegmentedControl` (`ui.segmented`) | `options` (required), `selected`, `color`, `onChange(index, option)` | `selected`, `selectedOption`, `select(i, notify?)` |

Taps on Button/Toggle/Checkbox/Segmented/Tabs emit `uiEvents` `'tap'` (node); value changes emit `'change'`
(`{ node, value }`); string `onTap` and dialog buttons emit `'action'` (`{ name, node }`).

## Containers and collections

| Widget | Props | Notes |
|---|---|---|
| `UIView` (`ui.view/column/row/stack`) | container + box props | `view.setLayout({...})`, `view.layout.gap = 24` |
| `Panel` | `variant`: `surface` (default), `raised`, `inset`, `glass` | defaults: radius lg, padding lg, gap md |
| `ScrollView` (`ui.scroll`) | `horizontal`, `bounce` (true), `scrollbar` (true), `onScroll(offset)` + padding/gap/align for its content | give it a bounded size (`grow: 1` or `height`); `scrollTo(offset, animated)`, `scrollIntoView(node)`, `offset`, `maxOffset`, `viewport`; lint role `surface` |
| `ListView` (`ui.list`) | `count`, `itemHeight`, `renderItem(i)`, `gap`, `padding`, `overscan` (2) | virtualized: rows are created/destroyed while scrolling; `refresh()`, `setCount(n)`, `scrollToIndex(i)`, `rowAt(i)`, `range` |
| `UIGrid` (`ui.grid`) | `columns` (required), `cellHeight`, `cellAspect`, `rowGap` | equal-width columns |
| `Tabs` (`ui.tabs(props, pages)`) | `labels` (required), `selected`, `color`, `onChange(i)` | pages in the same order as labels; `select(i, notify?)` |
| `Spacer` (`ui.spacer(size?)`) | `size` | flexible when no size |
| `Divider` | `color`, `thickness` | horizontal in a column, vertical in a row |

## Decor and media

| Widget | Props |
|---|---|
| `Badge` | `count` (hidden at 0 unless `showZero`), `dot`, `max` (99, shows `99+`), `color`, `textColor`; `badge.count = 5` |
| `StarRating` (`ui.stars`) | `value`, `max` (3), `size` (72), `gap`, `arc` (middle star raised), `animate` (pop in one by one), `color`; `play()` replays |
| `UIIcon` (`ui.icon(src, props)`) | `size` (48), `color` (built-in glyphs only; default `text`), `tint` (recolours texture icons, see below; also colours a glyph fallback), `tintMode` (`multiply` default / `fill`), `duotone: [dark, light]` (wins over `tint`) |
| `UIImage` (`ui.image(src, props)`) | `fit`: `contain` (default), `cover`, `fill`; `tint`, `tintMode`, `duotone` like icons; box props |

Texture icons and images are drawn as painted unless you recolour them (colours take theme tokens or CSS colours,
resolved at draw time; the bake is cached per texture + colour, see `tintTexture` in the code-art skill):

- `tint: 'danger'` multiplies the art by the colour: white-on-transparent art becomes that colour, painted shading
  and dark details stay. `tintMode: 'fill'` paints a flat silhouette instead (locked / disabled look).
- `duotone: ['surface', 'text']` maps brightness: black -> first colour, white -> second. Use it for white art on
  a light button: `ui.icon('art:skull', { size: 30, duotone: [buttonFace, ink] })` draws ink-coloured art whose
  painted holes (eye sockets) show the button face.
- `color` still only affects built-in glyphs; a missing texture keeps the glyph fallback / `missing-texture` lint.
- Dumps and selectors show them: `Icon[tint=danger]`, `Icon[duotone=surface/text]`, `Image[tintMode=fill]`.

## Modal / Dialog / Toast

`ModalProps` (plus container/box props for the panel): `title`, `closeButton` (true), `closeOnBackdrop` (true),
`animation` (`pop` | `sheet`), `variant` (`raised` default, `surface`, `glass`), `onClose(result)`,
`owner` (default: topmost scene when opened in the game overlay; `null` = app-level, survives scene changes).
Panel defaults: width 100% capped at 640 (900 for sheets), padding xl, gap lg.
Runtime: `open(parent?)`, `close(result)`, `closed` (Promise; never resolves when the owner goes away), `body`,
`isOpen`, `owner`, `backdrop`, `panel`.

`DialogProps` add `message`, `buttons: DialogButton[]` (default one `OK` button with action `ok`), `vertical`.
`DialogButton` = `ButtonProps` + `text`, `action` (close result; defaults to text), `keepOpen`, `onTap()`.
Dialog buttons default to `variant: 'primary', size: 'lg'`.

`showToast(text, { icon, duration: 2, variant: 'info', position: 'top', owner })` queues; `toastHost().clear()` drops
them. Toasts of a scene that is left are dropped too (`owner: null` keeps an app-level toast).

## JSON spec type names

`view/box`, `column/col/vstack`, `row/hstack`, `stack/overlay/zstack`, `panel/card`, `text/label`, `title`,
`richtext/rich`, `button`, `iconbutton`, `icon`, `image/img`, `progress/progressbar/bar`, `slider`,
`toggle/switch`, `checkbox/check`, `segmented/segments`, `scroll/scrollview`, `grid`, `tabs`, `badge`,
`stars/rating`, `spacer`, `divider/separator`, `modal`, `dialog`, `list/listview` (`items: spec[]`,
`itemHeight` default 120). Type names are case/dash/underscore-insensitive; `uiTypes()` lists them.
