import { createAudioManager, defineApp } from '@engine';
import { bakeFruitArt } from './art/fruit-art';
import { music, sfx } from './audio/index';
import { GalleryScene } from './scenes/gallery';
import { PlayScene } from './scenes/play';

export default defineApp({
  design: { width: 750, height: 1334 },
  scaleMode: 'expand',
  background: '#ffe9a8',
  scenes: {
    play: () => new PlayScene(),
    gallery: () => new GalleryScene(),
  },
  start: 'play',
  boot(game) {
    bakeFruitArt(2);
    createAudioManager(game, { library: { sfx, music } });
  },
});
