// Barrel for engine/art (palettes, pixel art, SVG, procedural shapes, icons, noise, texture baking).
export {
  palettes,
  paletteColors,
  paletteMap,
  paletteRoles,
  nearestColor,
  rampColor,
  hueShade,
  colorRamp,
  colorHarmony,
  type PaletteName,
  type PaletteRoles,
  type ColorHarmonyKind,
} from './palette';
export { parsePathData, traceSvgPath, svgPath, svgPathBounds, type SvgPathCmd } from './svgpath';
export {
  parseSvg,
  parseSvgTransform,
  svgColor,
  type SvgDocument,
  type SvgElement,
  type SvgGradient,
  type SvgGradientStop,
  type SvgMatrix,
} from './svgdoc';
export {
  drawSvg,
  svgTexture,
  svgSize,
  clearSvgCache,
  type SvgDrawOptions,
  type SvgTextureOptions,
} from './svg';
export {
  pixelSprite,
  pixelFrames,
  pixelGrid,
  pixelRows,
  mirrorRows,
  drawPixelGrid,
  type PixelPalette,
  type PixelSpriteOptions,
  type PixelGrid,
} from './pixel';
export {
  artShapes,
  traceArtShape,
  drawArtShape,
  shapeTexture,
  roundPolygonPath,
  artFillStyle,
  type ArtShape,
  type ArtFill,
  type ArtShapeStyle,
  type ArtShapeParams,
  type ArtShapeOptions,
  type ShapeTextureOptions,
} from './shapes';
export { iconNames, iconSvg, iconTexture, registerIcons, type IconName, type IconTextureOptions } from './icons';
export { makeNoise2D, fbmNoise, type Noise2D, type Noise2DKind, type FbmOptions } from './noise';
export {
  noiseTexture,
  patternTexture,
  patternNames,
  patternDefaults,
  type NoiseTextureOptions,
  type PatternName,
  type PatternOptions,
} from './patterns';
export {
  texturePixels,
  silhouetteTexture,
  outlineTexture,
  dropShadowTexture,
  glowTexture,
  recolorTexture,
  flipTexture,
  resampleTexture,
} from './effects';
export {
  creatureTexture,
  creatureFrames,
  drawCreature,
  creaturePose,
  resolveCreature,
  creatureColors,
  type CreatureOptions,
  type CreaturePose,
  type CreatureBody,
  type CreatureEyes,
  type CreatureMouth,
  type CreatureAccessory,
  type CreatureAnim,
} from './creature';
export { TextureAtlas, type TextureAtlasOptions, type TextureAtlasEntry } from './atlas';
