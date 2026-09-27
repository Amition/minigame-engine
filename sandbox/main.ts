import { defineApp } from '@engine';
import { HomeScene } from './home';
import { scenes as art } from './scenes/art';
import { scenes as audio } from './scenes/audio';
import { scenes as debug } from './scenes/debug';
import { scenes as helpers } from './scenes/helpers';
import { scenes as input } from './scenes/input';
import { scenes as physics } from './scenes/physics';
import { scenes as basics } from './scenes/basics';
import { scenes as display } from './scenes/display';
import { scenes as runtime } from './scenes/runtime';
import { scenes as ui } from './scenes/ui';
import { scenes as world } from './scenes/world';

export default defineApp({
  design: { width: 750, height: 1334 },
  scaleMode: 'expand',
  background: '#14161c',
  scenes: {
    home: () => new HomeScene(),
    ...basics,
    ...runtime,
    ...display,
    ...world,
    ...ui,
    ...art,
    ...audio,
    ...physics,
    ...helpers,
    ...input,
    ...debug,
  },
  start: 'home',
});
