import { configureAds, createAudioManager, defineApp, setUITheme } from '@engine';
import appJson from './app.json';
import { bakeArcherArt } from './art/index';
import { music, sfx } from './audio/index';
import { COLORS } from './config';
import { DuoScene } from './scenes/duo';
import { GalleryScene } from './scenes/gallery';
import { MenuPreviewScene } from './scenes/menu-preview';
import { PlayScene } from './scenes/play';

export default defineApp({
  design: { width: 1334, height: 750 },
  scaleMode: 'expand',
  background: COLORS.bg,
  scenes: {
    play: () => new PlayScene(),
    duo: () => new DuoScene(),
  },
  devScenes:
    process.env.NODE_ENV === 'production'
      ? undefined
      : { gallery: () => new GalleryScene(), 'menu-preview': () => new MenuPreviewScene() },
  start: 'play',
  boot(game) {
    setUITheme('dark');
    configureAds(appJson.ads);
    bakeArcherArt();
    createAudioManager(game, { library: { sfx, music } });
  },
});
