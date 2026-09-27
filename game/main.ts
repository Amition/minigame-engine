import { createAudioManager, defineApp, setUITheme } from '@engine';
import { bakeFruitArt } from './art/fruit-art';
import { music, sfx } from './audio/index';
import { GalleryScene } from './scenes/gallery';
import { PlayScene } from './scenes/play';
import { TitleScene } from './scenes/title';

export default defineApp({
  design: { width: 750, height: 1334 },
  scaleMode: 'expand',
  background: '#ffe9a8',
  scenes: {
    title: () => new TitleScene(),
    play: () => new PlayScene(),
    gallery: () => new GalleryScene(),
  },
  start: 'title',
  boot(game) {
    setUITheme('light');
    bakeFruitArt(2);
    createAudioManager(game, { library: { sfx, music } });
  },
});
