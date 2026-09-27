// Public runtime API: `import { ... } from '@engine'`. Bundled into every platform build, so nothing here may
// import node:* or @napi-rs/canvas (those live in @engine/testing and tools/).

export * from './core/math';
export * from './core/emitter';
export * from './core/rng';
export * from './core/color';
export * from './core/game';
export * from './core/app';
export * from './core/stats';

export * from './gfx/types';
export * from './gfx/texture';
export * from './gfx/textures';
export * from './gfx/draw';

export * from './platform/types';
export * from './platform/current';
export * from './platform/ads';

export * from './scene/node';
export * from './scene/selector';
export * from './scene/dump';
export * from './scene/sprite';
export * from './scene/box';
export * from './scene/text';
export * from './scene/scene';

// Feature modules, one barrel each.
export * from './runtime/index';
export * from './display/index';
export * from './world/index';
export * from './ui/index';
export * from './art/index';
export * from './audio/index';
