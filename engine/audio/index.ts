// Barrel for engine/audio: DSP, sfx generator, music notation + sequencer, WAV encoder, analysis, AudioManager.
// Everything here is pure TS (no node:*, no WebAudio): it runs offline in tools and at runtime in builds.
export * from './dsp';
export * from './sfx';
export * from './notation';
export * from './instruments';
export * from './song';
export * from './wav';
export * from './analyze';
export * from './manager';
export * from './shortcuts';
