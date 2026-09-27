import { defineSong, sfxPresets, type SfxParams, type SongDef } from '@engine';

// Sandbox sounds. `pnpm audio` renders them to sandbox/assets/audio/*.mp3 + manifest.json; the AudioManager
// synthesizes them on the fly when the files are missing (web/headless dev).

export const sfx: Record<string, SfxParams | (() => SfxParams)> = {
  coin: sfxPresets.coin(),
  pickup: sfxPresets.pickup(),
  jump: sfxPresets.jump(),
  hit: sfxPresets.hit(),
  hurt: sfxPresets.hurt(),
  explosion: sfxPresets.explosion(),
  powerup: sfxPresets.powerup(),
  laser: sfxPresets.laser(),
  shoot: sfxPresets.shoot(),
  click: sfxPresets.click(),
  blip: sfxPresets.blip(),
  select: sfxPresets.select(),
  error: sfxPresets.error(),
  success: sfxPresets.success(),
  whoosh: sfxPresets.whoosh(),
  pop: sfxPresets.pop(),
  bubble: sfxPresets.bubble(),
  win: sfxPresets.win(),
  lose: sfxPresets.lose(),
  combo: () => ({ ...sfxPresets.coin(2), arp: [0, 4, 7, 12], arpStep: 0.045, sustain: 0.14, decay: 0.3 }),
  tick: {
    wave: 'metallic',
    freq: 700,
    sustain: 0.003,
    decay: 0.04,
    decayCurve: 3,
    bandpass: 2600,
    bandpassQ: 1.2,
    volume: 0.5,
    layers: [{ wave: 'sine', freq: 1300, sustain: 0.002, decay: 0.03, gain: 0.8, bandpass: undefined }],
  },
};

const menuDrums = {
  a: 'kh h? ch h? kh kh? ch h? |',
  b: 'kh h? ch h? kh h? ch o? |',
  fill: 'kh h? ch h? k s? (s s) s! |',
};

/** Cheerful menu loop: C major, I–V6–vi–IV then I–V–IV/V–I, pulse lead over e-piano, bouncy bass. */
const menu: SongDef = defineSong({
  bpm: 120,
  key: 'C major',
  swing: 0.12,
  tracks: {
    lead: {
      instrument: 'pulse',
      volume: 0.5,
      pan: 0.1,
      effects: { reverb: 0.2, delay: { time: 0.75, feedback: 0.3, mix: 0.18 } },
    },
    keys: { instrument: 'epiano', volume: 0.5, pan: -0.15, effects: { reverb: 0.25 } },
    sparkle: {
      instrument: 'marimba',
      volume: 0.28,
      pan: -0.45,
      octave: 5,
      arp: { pattern: 'up', rate: 4 },
      effects: { reverb: 0.3 },
    },
    bass: { instrument: 'bass', volume: 0.7 },
    drums: { instrument: 'drums', volume: 0.55, effects: { reverb: 0.06 } },
  },
  sections: {
    A: {
      lead: 'G4 C5 E5 G5 - E5 C5 E5 | D5 - B4 - G4 - . D5 | C5 E5 A5 - G5 E5 C5 E5 | F5 - E5 - D5 - C5 D5 |',
      keys:
        '[C4 E4 G4] - - [C4 E4 G4] - - [C4 E4 G4] - | [B3 D4 G4] - - [B3 D4 G4] - - [B3 D4 G4] - |' +
        '[A3 C4 E4] - - [A3 C4 E4] - - [A3 C4 E4] - | [A3 C4 F4] - - [A3 C4 F4] - - [A3 C4 F4] - |',
      bass: 'C2 . G2 . C3 . G2 . | B1 . D2 . G2 . D2 . | A1 . E2 . A2 . E2 . | F1 . C2 . F2 . C2 . |',
      sparkle: '',
      drums: `${menuDrums.a} ${menuDrums.b} ${menuDrums.a} ${menuDrums.b}`,
    },
    B: {
      lead: 'E5 - G5 - C6 - B5 A5 | G5 - D5 - B4 - D5 G5 | A5 - G5 F5 D5 - B4 D5 | C5 - - - - . E4 F4 |',
      keys:
        '[C4 E4 G4] - - [C4 E4 G4] - - [C4 E4 G4] - | [B3 D4 G4] - - [B3 D4 G4] - - [B3 D4 G4] - |' +
        '[A3 C4 F4] - - [A3 C4 F4] [B3 D4 G4] - - [B3 D4 G4] | [C4 E4 G4] - - - - - . . |',
      bass: 'C2 . G2 . C3 . G2 . | G1 . D2 . G2 . D2 . | F1 . C2 . G1 . D2 . | C2 . G2 . C3 . B1 . |',
      sparkle: 'C | G | F G | C |',
      drums: `${menuDrums.a} ${menuDrums.b} ${menuDrums.a} ${menuDrums.fill}`,
    },
  },
  arrangement: ['A', 'B'],
});

/** Energetic gameplay loop: A minor, i–VI–III–VII then i–VI–VII–V, driving octave bass and 16th arps. */
const battle: SongDef = defineSong({
  bpm: 144,
  key: 'A minor',
  tracks: {
    lead: {
      instrument: 'square',
      volume: 0.5,
      pan: -0.05,
      effects: { reverb: 0.15, delay: { time: 0.75, feedback: 0.25, mix: 0.15 } },
    },
    arp: {
      instrument: 'pluck',
      volume: 0.32,
      pan: 0.35,
      arp: { pattern: 'updown', rate: 4 },
      effects: { reverb: 0.2 },
    },
    pad: { instrument: 'pad', volume: 0.35, octave: 3, effects: { reverb: 0.3 } },
    bass: { instrument: 'bass', volume: 0.7 },
    drums: { instrument: 'drums', volume: 0.6, effects: { reverb: 0.05 } },
  },
  sections: {
    A: {
      lead: 'E5 E5 . D5 E5 . C5 D5 | C5 C5 . A4 C5 . F5 E5 | E5 E5 . D5 E5 . G5 E5 | D5 - B4 - G4 - B4 D5 |',
      arp: 'Am | F | C | G |',
      pad: 'Am | F | C | G |',
      bass: 'A1 A2 A1 A2 A1 A2 A1 A2 | F1 F2 F1 F2 F1 F2 F1 F2 | C2 C3 C2 C3 C2 C3 C2 C3 | G1 G2 G1 G2 G1 G2 G1 G2 |',
      drums:
        'kh (h h?) sh (h h?) kh kh sh (h h?) | kh (h h?) sh (h h?) kh kh sh (h o?) |' +
        'kh (h h?) sh (h h?) kh kh sh (h h?) | kh (h h?) sh (h h?) kh kh sh (s s) |',
    },
    B: {
      lead: 'A5 - - - G5 - E5 - | F5 - - - E5 - C5 - | D5 - G5 - B5 - D6 - | B5 - G#5 - E5 - D5 B4 |',
      arp: 'Am | F | G | E |',
      pad: 'Am | F | G | E |',
      bass: 'A1 A1 A2 A1 . A1 A2 A1 | F1 F1 F2 F1 . F1 F2 F1 | G1 G1 G2 G1 . G1 G2 G1 | E1 E1 E2 E1 . E1 E2 E1 |',
      drums:
        'xk (h h?) sh (h h?) kh kh sh (h h?) | kh (h h?) sh (h h?) kh kh sh (h o?) |' +
        'kh (h h?) sh (h h?) kh kh sh (h h?) | kh (h h?) sh (s s) (s s) (s! s!) (t l) l |',
    },
  },
  arrangement: ['A', 'B'],
});

export const music: Record<string, SongDef> = { menu, battle };
