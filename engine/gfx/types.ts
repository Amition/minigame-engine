/**
 * The 2D context used everywhere. At runtime it may be a browser context, a mini-game canvas context
 * (wx/tt/tap) or an @napi-rs/canvas context (headless). Stick to the portable subset:
 *
 * OK:    save/restore, transform/setTransform, paths (moveTo/lineTo/arc/arcTo/bezierCurveTo/quadraticCurveTo/rect/ellipse),
 *        fill/stroke/clip, createLinearGradient/createRadialGradient, drawImage, fillText/strokeText/measureText,
 *        globalAlpha, globalCompositeOperation, shadow*, lineCap/lineJoin/lineWidth/setLineDash, getImageData/putImageData.
 * AVOID: Path2D, ctx.filter, ctx.roundRect, ctx.letterSpacing, ctx.reset, createConicGradient, OffscreenCanvas,
 *        createImageBitmap, any DOM (document/window) API. Draw rounded rects with arcTo (see engine/gfx/draw.ts).
 */
export type Ctx2D = CanvasRenderingContext2D;

/** Anything drawable by ctx.drawImage: image, canvas, napi canvas/image, mini-game image. */
export interface ImageSource {
  readonly width: number;
  readonly height: number;
}

/** A canvas: the main on-screen canvas or an offscreen one from `platform().createCanvas`. */
export interface Surface extends ImageSource {
  width: number;
  height: number;
  getContext(type: '2d'): Ctx2D;
}
