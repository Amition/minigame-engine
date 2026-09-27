import {
  blink,
  Box,
  clamp,
  draggable,
  fadeIn,
  fadeOut,
  flash,
  floatUp,
  hsl,
  Node,
  onDoubleTap,
  onLongPress,
  onSwipe,
  pinch,
  popIn,
  pulse,
  punch,
  Scene,
  sequence,
  shake,
  Text,
  tween,
  VirtualJoystick,
  type EaseName,
  type SceneFactory,
  type TransitionName,
  type Tween,
} from '@engine';
import { DemoScene } from '../common';

const PANEL = '#1f2330';
const TEXT = '#e6e9f2';
const MUTED = '#8a90a2';

function button(parent: Node, id: string, label: string, x: number, y: number, w: number, h: number, fill: string, onTap: () => void): Box {
  const b = parent.add(new Box(w, h, { fill, radius: 16 }, { id, x, y, hitPadding: 6 }));
  b.add(new Text(label, { fontSize: 24, color: '#ffffff', fontWeight: 'bold' }, { x: w / 2, y: h / 2, anchor: 0.5 }));
  b.onTap(() => {
    punch(b, 1.08, 0.2);
    onTap();
  });
  return b;
}

// ---------------------------------------------------------------- runtime-tween

const GALLERY: EaseName[] = [
  'linear',
  'quadOut',
  'cubicInOut',
  'quartIn',
  'sineInOut',
  'expoOut',
  'circOut',
  'backOut',
  'backInOut',
  'elasticOut',
  'bounceOut',
  'quintInOut',
];

/** Easing gallery (dots ping-pong along tracks) and juice buttons acting on a mascot. */
class TweenDemo extends DemoScene {
  readonly title = 'Runtime · Tweens';

  protected build(): void {
    const { y, w } = this.content;
    const rowH = 54;
    const x0 = 210;
    const x1 = w - 40;
    GALLERY.forEach((ease, i) => {
      const cy = y + 30 + i * rowH;
      this.add(new Text(ease, { fontSize: 22, color: MUTED }, { x: 24, y: cy, anchorY: 0.5 }));
      this.add(new Box(x1 - x0, 4, { fill: '#2b3140', radius: 2 }, { x: x0, y: cy - 2 }));
      const dot = this.add(new Box(28, 28, { fill: hsl(i * 30, 0.75, 0.6), radius: 14 }, { id: `ease-${ease}`, x: x0, y: cy, anchor: 0.5 }));
      tween(dot, { x: x1 }, 1.2, { ease, repeat: Infinity, yoyo: true }).wait(0.3);
    });

    const my = y + 30 + GALLERY.length * rowH + 100;
    const mascot = this.add(
      new Box(140, 140, { fill: '#f59e0b', radius: 32, shadow: { color: '#0008', blur: 16, y: 6 } }, { id: 'mascot', x: w / 2, y: my, anchor: 0.5 }),
    );
    mascot.add(new Text('^_^', { fontSize: 44, fontWeight: 'bold', color: '#3b2300' }, { x: 70, y: 70, anchor: 0.5 }));

    let pulsing: Tween<Node> | null = null;
    const actions: [string, string, () => void][] = [
      ['shake', 'shake', () => void shake(this, 18, 0.4)],
      ['punch', 'punch', () => void punch(mascot)],
      ['pulse', 'pulse', () => {
        if (pulsing?.active) pulsing.kill();
        else pulsing = pulse(mascot, 1.12, 0.8);
      }],
      ['fade', 'fade', () => void sequence([fadeOut(mascot, 0.3), () => fadeIn(mascot, 0.3)])],
      ['pop', 'popIn', () => void popIn(mascot)],
      ['flash', 'flash', () => void flash(this.game, '#ffffff', 0.3)],
      ['float', 'floatUp', () => {
        const t = this.add(new Text('+10', { fontSize: 40, fontWeight: 'bold', color: '#fde047' }, { x: mascot.x, y: mascot.y - 90, anchor: 0.5 }));
        floatUp(t, 120, 0.9);
      }],
      ['blink', 'blink', () => void blink(mascot, 5, 0.8)],
    ];
    const cols = 4;
    const gap = 16;
    const bw = (w - 48 - gap * (cols - 1)) / cols;
    const by = my + 120;
    actions.forEach(([id, label, fn], i) => {
      button(this, `juice-${id}`, label, 24 + (i % cols) * (bw + gap), by + Math.floor(i / cols) * (72 + gap), bw, 72, '#3b82f6', fn);
    });
  }
}

// ---------------------------------------------------------------- runtime-input

/** Draggable items, swipe readout, long press / double tap counters, joystick-driven dot with pinch zoom. */
class InputDemo extends DemoScene {
  readonly title = 'Runtime · Input';

  protected build(): void {
    const { y, w, h } = this.content;
    const pad = 24;

    const dragPanel = this.add(new Box(w - pad * 2, 280, { fill: PANEL, radius: 20 }, { id: 'drag-panel', x: pad, y: y + 16 }));
    dragPanel.add(new Text('拖动方块（限制在面板内）', { fontSize: 22, color: MUTED }, { x: 20, y: 16 }));
    ['#ef4444', '#10b981', '#8b5cf6'].forEach((fill, i) => {
      const item = dragPanel.add(
        new Box(96, 96, { fill, radius: 18 }, { id: `drag-${i}`, x: (dragPanel.width * (i + 1)) / 4, y: 160, anchor: 0.5 }),
      );
      draggable(item, {
        bounds: 'parent',
        onStart: () => {
          item.zIndex = 1;
          tween(item, { scale: 1.12 }, 0.12);
        },
        onEnd: () => {
          item.zIndex = 0;
          tween(item, { scale: 1 }, 0.2, { ease: 'backOut' });
        },
      });
    });

    const rowY = y + 316;
    const half = (w - pad * 3) / 2;
    const swipe = this.add(new Box(half, 240, { fill: PANEL, radius: 20 }, { id: 'swipe-zone', x: pad, y: rowY }));
    swipe.add(new Text('在此滑动', { fontSize: 26, color: TEXT }, { x: half / 2, y: 70, anchor: 0.5 }));
    const readout = swipe.add(new Text('—', { fontSize: 24, color: '#fde047' }, { id: 'swipe-readout', x: half / 2, y: 150, anchor: 0.5 }));
    const arrows = { left: '←', right: '→', up: '↑', down: '↓' };
    onSwipe(swipe, (dir, speed) => {
      readout.text = `${arrows[dir]} ${dir} ${Math.round(speed)}/s`;
      punch(readout, 1.2);
    });

    let longCount = 0;
    const lp = button(this, 'long-press', '长按我 0', pad * 2 + half, rowY, half, 110, '#0284c7', () => {});
    onLongPress(lp, () => {
      longCount++;
      lp.find<Text>('Text')!.text = `长按我 ${longCount}`;
      shake(lp, 8, 0.25);
    }, 0.5);
    let dblCount = 0;
    const dt = button(this, 'double-tap', '双击我 0', pad * 2 + half, rowY + 130, half, 110, '#ea580c', () => {});
    onDoubleTap(dt, () => {
      dblCount++;
      dt.find<Text>('Text')!.text = `双击我 ${dblCount}`;
    });

    const ay = rowY + 270;
    const ah = Math.max(260, y + h - ay - 16);
    const arena = this.add(new Box(w - pad * 2, ah, { fill: '#10131a', stroke: '#2b3140', lineWidth: 2, radius: 20 }, { id: 'arena', x: pad, y: ay, clip: true }));
    arena.add(new Text('左半边：浮动摇杆 · 双指缩放圆点', { fontSize: 22, color: MUTED }, { x: 20, y: 16 }));
    const dot = arena.add(new Box(48, 48, { fill: '#22d3ee', radius: 24 }, { id: 'stick-dot', x: arena.width * 0.7, y: ah / 2, anchor: 0.5 }));
    const stick = arena.add(
      new VirtualJoystick({ id: 'stick', width: arena.width / 2, height: ah, radius: 90, rest: { x: 150, y: ah - 130 } }),
    );
    const info = arena.add(new Text('0.00, 0.00', { fontSize: 22, color: MUTED }, { id: 'stick-info', x: arena.width - 20, y: 16, anchorX: 1 }));
    dot.onUpdate((dts) => {
      dot.x = clamp(dot.x + stick.value.x * 420 * dts, 24, arena.width - 24);
      dot.y = clamp(dot.y + stick.value.y * 420 * dts, 24, ah - 24);
      info.text = `${stick.value.x.toFixed(2)}, ${stick.value.y.toFixed(2)}`;
    });
    let s0 = 1;
    pinch(arena, (e) => {
      if (e.phase === 'start') s0 = dot.scaleX;
      dot.setScale(clamp(s0 * e.scale, 0.5, 3));
    });
  }
}

// ---------------------------------------------------------------- runtime-scenes

const TRANSITIONS: TransitionName[] = ['fade', 'slide-left', 'slide-right', 'slide-up', 'zoom', 'none'];

/** go() with every transition (to a new instance of itself), push()/pop() of a dialog with its result. */
class ScenesDemo extends DemoScene {
  readonly title = 'Runtime · Scenes';

  protected build(params?: unknown): void {
    const p = (params ?? {}) as { n?: number; result?: string };
    const n = p.n ?? 1;
    const { y, w } = this.content;
    const bg = this.find<Box>('#bg');
    if (bg) bg.fill = hsl(210 + n * 37, 0.35, 0.12);
    this.add(new Text(`场景 #${n}`, { fontSize: 64, fontWeight: 'bold', color: '#ffffff' }, { id: 'scene-n', x: w / 2, y: y + 90, anchor: 0.5 }));
    this.add(new Text('go(name, params, { transition })', { fontSize: 22, color: MUTED }, { x: w / 2, y: y + 160, anchor: 0.5 }));
    const cols = 2;
    const gap = 20;
    const bw = (w - 48 - gap) / cols;
    TRANSITIONS.forEach((tr, i) => {
      button(this, `go-${tr}`, tr, 24 + (i % cols) * (bw + gap), y + 200 + Math.floor(i / cols) * (84 + gap), bw, 84, '#3b82f6', () => {
        void this.game.scenes.go('runtime-scenes', { n: n + 1 }, { transition: tr, duration: 0.45 });
      });
    });
    const py = y + 200 + 3 * (84 + gap) + 30;
    this.add(new Text('push(name) → await result', { fontSize: 22, color: MUTED }, { x: w / 2, y: py, anchor: 0.5 }));
    const result = this.add(
      new Text(p.result ? `上次结果: ${p.result}` : '对话框结果: —', { fontSize: 28, color: '#fde047' }, { id: 'dialog-result', x: w / 2, y: py + 175, anchor: 0.5 }),
    );
    const open = async (transition: TransitionName) => {
      const r = await this.game.scenes.push<string>('runtime-dialog', { n }, { transition, duration: 0.35 });
      result.text = `对话框结果: ${r ?? '(closed)'}`;
      popIn(result, 0.3);
    };
    button(this, 'push-slide', 'push · slide-up', 24, py + 40, bw, 84, '#059669', () => void open('slide-up'));
    button(this, 'push-zoom', 'push · zoom', 24 + bw + gap, py + 40, bw, 84, '#059669', () => void open('zoom'));
  }
}

/** Modal dialog pushed above ScenesDemo; resolves the push promise via close(result). */
class DialogScene extends Scene {
  override onEnter(params?: unknown): void {
    const n = (params as { n?: number } | undefined)?.n ?? 0;
    const w = this.width;
    const h = this.height;
    this.add(new Box(w, h, { fill: 'rgba(0,0,0,0.6)' }, { id: 'backdrop', tags: ['lint-blocker'], interactive: true }));
    const pw = Math.min(560, w - 80);
    const panel = this.add(new Box(pw, 360, { fill: '#262b38', radius: 28, shadow: { color: '#000a', blur: 30, y: 10 } }, { id: 'dialog', x: w / 2, y: h / 2, anchor: 0.5 }));
    panel.add(new Text('确认操作？', { fontSize: 40, fontWeight: 'bold', color: '#ffffff' }, { x: pw / 2, y: 80, anchor: 0.5 }));
    panel.add(new Text(`来自场景 #${n} · 下层已暂停`, { fontSize: 24, color: MUTED }, { x: pw / 2, y: 145, anchor: 0.5 }));
    const done = (r: string) => {
      if (this.pushed) void this.close(r);
      else void this.game.scenes.go('home');
    };
    const bw = (pw - 72) / 2;
    button(panel, 'dialog-cancel', '取消', 24, 236, bw, 88, '#4b5563', () => done('cancel'));
    button(panel, 'dialog-ok', '确定', 48 + bw, 236, bw, 88, '#059669', () => done('ok'));
  }
}

export const scenes: Record<string, SceneFactory> = {
  'runtime-tween': () => new TweenDemo(),
  'runtime-input': () => new InputDemo(),
  'runtime-scenes': () => new ScenesDemo(),
  'runtime-dialog': () => new DialogScene(),
};
