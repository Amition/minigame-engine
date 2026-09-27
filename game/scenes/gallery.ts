import { Scene, Text } from '@engine';
import { FruitNode, type FruitFace } from '../art/fruit-art';
import { fruit } from '../fruits';

const INK = '#6b4423';
const SOFT = '#a07850';
const FACES: readonly FruitFace[] = ['idle', 'blink', 'happy', 'surprised', 'worried'];

/** Horizontal distance between two circles of radii a and b that touch with `gap` while their centres differ by dy. */
const reach = (a: number, b: number, gap: number, dy: number) => Math.sqrt((a + b + gap) ** 2 - dy * dy);

/**
 * Art review scene (fits a 750x1623 view): every fruit at game size, the five expressions on three fruits, touching
 * pairs, rotated fruits and a looping squash. `pnpm shot --app game --scene gallery`
 */
export class GalleryScene extends Scene {
  private squashed: FruitNode | null = null;
  private clock = 0;
  private nextSquash = 0.27;

  override onEnter(): void {
    const w = this.width;
    this.caption('实际大小 game size', 16);

    // grape .. tomato, bottoms aligned
    const rowA = [0, 1, 2, 3, 4, 5];
    const bottomA = 222;
    const widthA = rowA.reduce((s, l) => s + 2 * fruit(l).radius, 0);
    const gapA = (w - 16 - widthA) / (rowA.length - 1);
    let x = 8;
    for (const l of rowA) {
      const r = fruit(l).radius;
      this.fruitAt(l, x + r, bottomA - r);
      x += 2 * r + gapA;
    }

    // coconut, pineapple (raised so the row fits), peach
    const bottomB = 623;
    const [rc, rp, rh] = [fruit(8).radius, fruit(7).radius, fruit(6).radius];
    const cy = bottomB - rc;
    const py = bottomB - 90 - rp;
    const hy = bottomB - rh;
    const d1 = reach(rc, rp, 12, cy - py);
    const d2 = reach(rp, rh, 12, hy - py);
    const xc = (w - (rc + d1 + d2 + rh)) / 2 + rc;
    this.fruitAt(8, xc, cy);
    this.fruitAt(7, xc + d1, py);
    this.fruitAt(6, xc + d1 + d2, hy);

    // watermelon, half melon (raised)
    const bottomC = 1095;
    const [rw, rm] = [fruit(10).radius, fruit(9).radius];
    const wy = bottomC - rw;
    const my = bottomC - 101 - rm;
    const dw = reach(rw, rm, 4, wy - my);
    const xw = (w - (rw + dw + rm)) / 2 + rw;
    this.fruitAt(10, xw, wy);
    this.fruitAt(9, xw + dw, my);

    // expressions: 5 faces on 3 fruits
    const top = 1136;
    const colX = (i: number) => 140 + i * 138;
    this.caption('表情', top);
    FACES.forEach((f, i) => this.add(new Text(f, { fontSize: 20, color: SOFT }, { x: colX(i), y: top, anchor: 0.5 })));
    const rows: [level: number, r: number, y: number][] = [
      [0, 26, top + 45],
      [6, 44, top + 132],
      [9, 44, top + 228],
    ];
    for (const [level, r, y] of rows) {
      this.add(new Text(fruit(level).name, { fontSize: 20, color: SOFT }, { x: 12, y, anchor: [0, 0.5] }));
      FACES.forEach((face, i) => {
        const n = this.add(new FruitNode(level, { x: colX(i), y }));
        n.radius = r;
        n.face = face;
      });
    }

    // touching pairs (exact circle distance), rotated fruits, squash
    this.caption('贴合 · 旋转 · 挤压 touching / rotated / squash', 1432);
    const rowY = 1515;
    const [g, c, o, le] = [0, 1, 2, 3].map((l) => fruit(l).radius) as [number, number, number, number];
    // grape + cherry, bottoms aligned
    const gx = 34;
    const base = rowY + 56;
    this.add(new FruitNode(0, { x: gx, y: base - g }));
    this.add(new FruitNode(1, { x: gx + reach(g, c, 0, c - g), y: base - c, rotation: 0.35 }));
    // two oranges touching on a slant
    const ox = 209;
    const oa = -0.2;
    this.add(new FruitNode(2, { x: ox, y: rowY + 10, rotation: -0.6 }));
    this.add(new FruitNode(2, { x: ox + Math.cos(oa) * 2 * o, y: rowY + 10 + Math.sin(oa) * 2 * o, rotation: 2.2 }));
    // cherry and lemon, both on their sides
    const lx = 518;
    const ca = (170 * Math.PI) / 180;
    this.add(new FruitNode(3, { x: lx, y: rowY, rotation: Math.PI / 2 }));
    this.add(new FruitNode(1, { x: lx + Math.cos(ca) * (c + le), y: rowY + Math.sin(ca) * (c + le), rotation: -Math.PI / 2 }));
    // rotated orange with a looping screen-space squash
    const sx = 662;
    this.squashed = this.add(new FruitNode(2, { x: sx, y: rowY, rotation: 0.9 }));
    this.squashed.face = 'surprised';
    this.add(new Text('squash', { fontSize: 20, color: SOFT }, { x: sx, y: rowY + o + 22, anchor: 0.5 }));
  }

  override update(dt: number): void {
    this.clock += dt;
    if (this.squashed && this.clock >= this.nextSquash) {
      this.squashed.squash(1.2);
      this.nextSquash += 1.2;
    }
  }

  private caption(text: string, y: number): void {
    this.add(new Text(text, { fontSize: 22, color: INK, fontWeight: 'bold' }, { x: 12, y, anchor: [0, 0.5] }));
  }

  private fruitAt(level: number, x: number, y: number): FruitNode {
    const f = fruit(level);
    const n = this.add(new FruitNode(level, { x, y }));
    this.add(new Text(f.name, { fontSize: 20, color: INK }, { x, y: y + f.radius + 14, anchor: 0.5 }));
    return n;
  }
}
