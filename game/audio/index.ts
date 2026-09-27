import { defineSong, sfxPresets, type SfxParams, type SongDef } from '@engine';

// 合成大西瓜 sounds. `pnpm audio --app game` renders them to game/assets/audio/*.mp3 + manifest.json; without the
// files the AudioManager synthesizes them at runtime. Placeholder set: the names are the contract used by the game.
//   drop        fruit released from the dropper
//   spawn       next fruit appears in the dropper
//   merge       two fruits merge (played with rate 1.25 - level * 0.05, so bigger fruits sound lower)
//   merge-big   extra layer for merges into pineapple or larger
//   watermelon  a watermelon was made
//   combo       chain of merges (played with rising rate per combo step)
//   warning     tick while a fruit is over the danger line
//   gameover    game over sting
//   record      new best score
//   click       UI button

export const sfx: Record<string, SfxParams | (() => SfxParams)> = {
  drop: sfxPresets.whoosh(),
  spawn: sfxPresets.blip(),
  merge: sfxPresets.pop(),
  'merge-big': sfxPresets.powerup(),
  watermelon: sfxPresets.win(),
  combo: () => ({ ...sfxPresets.coin(2), arp: [0, 4, 7, 12], arpStep: 0.045, sustain: 0.14, decay: 0.3 }),
  warning: sfxPresets.error(),
  gameover: sfxPresets.lose(),
  record: sfxPresets.success(),
  click: sfxPresets.click(),
};

const bgm: SongDef = defineSong({
  bpm: 112,
  key: 'C major',
  tracks: {
    lead: { instrument: 'marimba', volume: 0.5 },
    bass: { instrument: 'bass', volume: 0.6 },
  },
  sections: {
    A: {
      lead: 'C5 E5 G5 E5 | F5 A5 G5 - | E5 G5 C6 G5 | F5 E5 D5 - |',
      bass: 'C2 - G2 - | F2 - C2 - | A1 - E2 - | G1 - G2 - |',
    },
  },
  arrangement: ['A', 'A'],
});

export const music: Record<string, SongDef> = { bgm };
