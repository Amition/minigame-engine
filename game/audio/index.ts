import {
  defineSong,
  midiToFreq,
  noteNameToMidi,
  type InstrumentDef,
  type SfxLayer,
  type SfxParams,
  type SfxWave,
  type SongDef,
} from '@engine';

// 合成大西瓜 sounds. `pnpm audio --app game` renders them to game/assets/audio/*.mp3 + manifest.json; without the
// files the AudioManager synthesizes them at runtime. The names are the contract used by the game:
//   drop        fruit released from the dropper
//   spawn       next fruit appears in the dropper
//   merge       two fruits merge (played with rate 1.25 - level * 0.05, so bigger fruits sound lower)
//   merge-big   extra layer for merges into pineapple or larger
//   watermelon  a watermelon was made
//   combo       chain of merges (played with rate min(1.5, 1 + 0.08 * (combo - 2)))
//   warning     tick while a fruit is over the danger line (about twice per second)
//   gameover    game over sting
//   record      new best score
//   click       UI button
// Everything is tuned to F major, the key of the bgm: pitched sfx use its scale (F G A Bb C D E), mostly the
// F major triad, so sfx and music sound like one family.

const hz = (note: string): number => {
  const midi = noteNameToMidi(note);
  if (midi === null) throw new Error(`game audio: "${note}" is not a note`);
  return midiToFreq(midi);
};

/** Neutral voice params. Layers inherit every voice param of the root, so each layer starts from these. */
const CLEAN: SfxLayer = {
  attack: 0,
  sustain: 0.1,
  decay: 0.2,
  punch: 0,
  decayCurve: 2,
  slide: 0,
  slideAccel: 0,
  freqMin: 20,
  freqMax: 16000,
  duty: 0.5,
  dutySweep: 0,
  vibrato: 0,
  arp: undefined,
  repeat: 0,
  tremolo: 0,
  lowpass: undefined,
  lowpassQ: 0.9,
  lowpassSweep: 0,
  highpass: undefined,
  highpassSweep: 0,
  bandpass: undefined,
  bandpassQ: 1,
  bandpassSweep: 0,
  flanger: undefined,
  noiseMix: 0,
  drive: 0,
  crush: undefined,
  downsample: undefined,
};

type Voice = Omit<SfxLayer, 'wave' | 'freq'> & { wave: SfxWave; freq: number };

const voice = (v: Voice): SfxLayer => ({ ...CLEAN, ...v });

type SfxMaster = Pick<SfxParams, 'volume' | 'echo' | 'echoFeedback' | 'echoMix' | 'reverb' | 'seed'>;

/**
 * One sfx from a stack of voices. The first voice becomes the root (it must start at 0); gains are relative, the
 * result is peak-normalised to `volume` anyway.
 */
function stack(voices: readonly SfxLayer[], master: SfxMaster): SfxParams {
  const [head, ...rest] = voices;
  if (!head || (head.at ?? 0) !== 0 || head.wave === undefined || head.freq === undefined) {
    throw new Error('game audio: the first voice of a stack needs wave, freq and at = 0');
  }
  const g0 = head.gain ?? 1;
  const { at: _at, gain: _gain, ...root } = head;
  return {
    ...root,
    wave: head.wave,
    freq: head.freq,
    ...master,
    layers: rest.map((l) => ({ ...l, gain: (l.gain ?? 1) / g0 })),
  };
}

/** Bell-like note: triangle body plus a quiet sine an octave up that fades first. */
const chime = (at: number, note: string, gain: number, decay: number): SfxLayer[] => [
  voice({ at, wave: 'triangle', freq: hz(note), attack: 0.002, sustain: 0.006, decay, decayCurve: 2.6, gain }),
  voice({ at, wave: 'sine', freq: hz(note) * 2, attack: 0.002, sustain: 0.004, decay: decay * 0.6, decayCurve: 3, gain: gain * 0.25 }),
];

/** Soft brass: low-passed saw with a triangle an octave down for body. */
const horn = (at: number, note: string, hold: number, decay: number, gain: number, extra: Partial<Voice> = {}): SfxLayer[] => [
  voice({ at, wave: 'saw', freq: hz(note), attack: 0.014, sustain: hold, decay, decayCurve: 1.6, lowpass: 2400, gain, ...extra }),
  voice({ at, wave: 'triangle', freq: hz(note) / 2, attack: 0.01, sustain: hold, decay, decayCurve: 1.6, gain: gain * 0.6, ...extra }),
];

/** Toy-piano-ish note for the game over sting: triangle plus a thin, low-passed pulse. */
const toy = (at: number, note: string, hold: number, decay: number, gain: number, extra: Partial<Voice> = {}): SfxLayer[] => [
  voice({ at, wave: 'triangle', freq: hz(note), attack: 0.004, sustain: hold, decay, gain, ...extra }),
  voice({ at, wave: 'square', duty: 0.125, freq: hz(note), attack: 0.004, sustain: hold, decay, lowpass: 2200, gain: gain * 0.22, ...extra }),
];

// ---------------------------------------------------------------- sfx

/** Airy release: a soft sine "pup" on C5 inside a dark, band-passed breath that falls in pitch. */
const drop = stack(
  [
    voice({ wave: 'sine', freq: hz('C5'), slide: -48, sustain: 0.008, decay: 0.09, decayCurve: 2.4 }),
    voice({ wave: 'sine', freq: hz('F4'), slide: -30, sustain: 0.004, decay: 0.07, gain: 0.45 }),
    voice({
      wave: 'white',
      freq: 1000,
      attack: 0.015,
      sustain: 0.02,
      decay: 0.16,
      decayCurve: 1.8,
      bandpass: 1000,
      bandpassQ: 1.5,
      bandpassSweep: -2,
      lowpass: 2800,
      gain: 1.6,
    }),
  ],
  { volume: 0.43, seed: 5 },
);

/** Tiny pop-in: F5 nudging up to A5 with a faint C6 on top. */
const spawn = stack(
  [
    voice({ wave: 'sine', freq: hz('F5'), slide: 60, freqMax: hz('A5'), sustain: 0.012, decay: 0.06, decayCurve: 2.5, punch: 0.3 }),
    voice({ wave: 'triangle', freq: hz('C6'), sustain: 0.008, decay: 0.045, decayCurve: 2.5, gain: 0.3 }),
  ],
  { volume: 0.28, seed: 6 },
);

/**
 * The bloop: a sine gliding up an octave F4 -> F5 in 60 ms and ringing briefly on F5 with a slight liquid wobble,
 * over a low thump and a short wet "shlp" (noise through a rising band-pass). Pure tones and a fast decay keep it
 * pleasant at every playback rate (0.75..1.2).
 */
const merge = stack(
  [
    voice({
      wave: 'sine',
      freq: hz('F4'),
      slide: 200,
      freqMax: hz('F5'),
      sustain: 0.02,
      decay: 0.22,
      decayCurve: 2.6,
      punch: 0.4,
      vibrato: 0.3,
      vibratoRate: 18,
    }),
    voice({ wave: 'sine', freq: hz('F3'), slide: -30, sustain: 0.01, decay: 0.11, gain: 0.6 }),
    voice({ wave: 'white', freq: 1000, sustain: 0.004, decay: 0.05, decayCurve: 2.5, bandpass: 800, bandpassQ: 1.8, bandpassSweep: 14, gain: 0.7 }),
    voice({ at: 0.05, wave: 'sine', freq: hz('C6'), attack: 0.006, sustain: 0.02, decay: 0.2, decayCurve: 2.6, gain: 0.16 }),
    voice({ at: 0.05, wave: 'sine', freq: hz('F6'), attack: 0.004, sustain: 0.01, decay: 0.12, decayCurve: 3, gain: 0.08 }),
  ],
  { volume: 0.5, seed: 9 },
);

/** Shimmering F major swell with rising chimes A5 C6 F6 A6 C7 and a warm low F underneath. */
const mergeBig = stack(
  [
    voice({ wave: 'sine', freq: hz('F5'), attack: 0.12, sustain: 0.08, decay: 0.45, tremolo: 0.3, tremoloRate: 13, vibrato: 0.08, vibratoRate: 5 }),
    voice({ wave: 'sine', freq: hz('C6'), attack: 0.14, sustain: 0.06, decay: 0.42, tremolo: 0.3, tremoloRate: 11, gain: 0.6 }),
    voice({ wave: 'sine', freq: hz('A5'), attack: 0.16, sustain: 0.04, decay: 0.4, tremolo: 0.3, tremoloRate: 9, gain: 0.45 }),
    voice({ wave: 'triangle', freq: hz('F3'), attack: 0.05, sustain: 0.05, decay: 0.4, lowpass: 900, gain: 0.5 }),
    ...chime(0.03, 'A5', 0.45, 0.28),
    ...chime(0.09, 'C6', 0.42, 0.28),
    ...chime(0.15, 'F6', 0.38, 0.3),
    ...chime(0.21, 'A6', 0.32, 0.32),
    ...chime(0.27, 'C7', 0.26, 0.4),
  ],
  { volume: 0.54, seed: 13 },
);

/** Brass fanfare "da-da-da-DAA da-DAAA" (C5 F5 A5 C6, A5 C6) over an F major chord, with twinkles. */
const watermelon = stack(
  [
    ...horn(0, 'C5', 0.07, 0.06, 1),
    ...horn(0.11, 'F5', 0.07, 0.06, 1),
    ...horn(0.22, 'A5', 0.07, 0.06, 1),
    ...horn(0.33, 'C6', 0.16, 0.08, 1),
    ...horn(0.55, 'A5', 0.07, 0.06, 0.95),
    ...horn(0.66, 'C6', 0.5, 0.7, 1, { vibrato: 0.22, vibratoRate: 6 }),
    ...horn(0.66, 'A5', 0.5, 0.7, 0.5),
    ...horn(0.66, 'F5', 0.5, 0.7, 0.45),
    voice({ at: 0.66, wave: 'triangle', freq: hz('F3'), attack: 0.01, sustain: 0.5, decay: 0.7, gain: 0.5 }),
    ...chime(0.74, 'F6', 0.22, 0.3),
    ...chime(0.84, 'A6', 0.19, 0.3),
    ...chime(0.94, 'C7', 0.16, 0.34),
    ...chime(1.04, 'F7', 0.12, 0.4),
  ],
  { volume: 0.84, echo: 0.11, echoFeedback: 0.2, echoMix: 0.18, seed: 15 },
);

/** Quick bright chime arpeggio F5 A5 C6 F6. */
const combo = stack(
  [...chime(0, 'F5', 1, 0.16), ...chime(0.045, 'A5', 0.9, 0.16), ...chime(0.09, 'C6', 0.85, 0.18), ...chime(0.135, 'F6', 0.8, 0.22)],
  { volume: 0.59, seed: 17 },
);

/** Soft alarm beep on A5 (ear-catching range, few harmonics) with an A4 body and a faint E6 ring. */
const warning = stack(
  [
    voice({ wave: 'triangle', freq: hz('A5'), slide: -10, sustain: 0.028, decay: 0.085, decayCurve: 2.2, punch: 0.35, lowpass: 4000 }),
    voice({ wave: 'sine', freq: hz('A4'), sustain: 0.02, decay: 0.08, gain: 0.55 }),
    voice({ wave: 'sine', freq: hz('E6'), sustain: 0.01, decay: 0.05, decayCurve: 3, gain: 0.2 }),
  ],
  { volume: 0.4, seed: 19 },
);

/** Cute, slightly sad: A5 G5 F5 stepping down onto a wobbly, sagging D minor third (D5 + F5). */
const sigh: Partial<Voice> = { attack: 0.012, vibrato: 0.3, vibratoRate: 5, slide: -0.8 };
const gameover = stack(
  [
    ...toy(0, 'A5', 0.03, 0.2, 1, { decayCurve: 2.5 }),
    ...toy(0.2, 'G5', 0.03, 0.2, 0.95, { decayCurve: 2.5 }),
    ...toy(0.4, 'F5', 0.03, 0.2, 0.9, { decayCurve: 2.5 }),
    ...toy(0.62, 'D5', 0.42, 0.6, 1, sigh),
    ...toy(0.62, 'F5', 0.42, 0.6, 0.45, sigh),
    voice({ at: 0.62, wave: 'sine', freq: hz('D4'), attack: 0.02, sustain: 0.4, decay: 0.6, gain: 0.4 }),
  ],
  { volume: 0.7, seed: 21 },
);

/** "Ta-da": C5 F5 A5 pickup into a ringing F major chord, then twinkles F6 A6 C7. */
const record = stack(
  [
    ...chime(0, 'C5', 1, 0.12),
    ...chime(0.08, 'F5', 1, 0.12),
    ...chime(0.16, 'A5', 1, 0.12),
    ...chime(0.26, 'C6', 1, 0.7),
    ...chime(0.26, 'A5', 0.6, 0.7),
    ...chime(0.26, 'F5', 0.6, 0.7),
    voice({ at: 0.26, wave: 'sine', freq: hz('F4'), attack: 0.01, sustain: 0.1, decay: 0.6, gain: 0.4 }),
    ...chime(0.4, 'F6', 0.35, 0.3),
    ...chime(0.5, 'A6', 0.3, 0.3),
    ...chime(0.6, 'C7', 0.25, 0.35),
  ],
  { volume: 0.84, echo: 0.12, echoFeedback: 0.2, echoMix: 0.2, seed: 23 },
);

/** Short wooden tick: F6 dropping fast over an F5 body and a tiny click of noise. */
const click = stack(
  [
    voice({ wave: 'sine', freq: hz('F6'), slide: -40, sustain: 0.002, decay: 0.03, decayCurve: 3 }),
    voice({ wave: 'sine', freq: hz('F5'), sustain: 0.002, decay: 0.035, decayCurve: 2.5, gain: 0.45 }),
    voice({ wave: 'white', freq: 1000, sustain: 0.001, decay: 0.006, highpass: 3000, gain: 0.25 }),
  ],
  { volume: 0.5, seed: 7 },
);

export const sfx: Record<string, SfxParams | (() => SfxParams)> = {
  drop,
  spawn,
  merge,
  'merge-big': mergeBig,
  watermelon,
  combo,
  warning,
  gameover,
  record,
  click,
};

// ---------------------------------------------------------------- music

/** Round, soft bass: filtered triangle with a sine sub. */
const roundBass: InstrumentDef = {
  wave: 'triangle',
  sub: 0.35,
  attack: 0.004,
  decay: 0.3,
  sustain: 0.5,
  release: 0.07,
  filter: 'lowpass',
  cutoff: 700,
  resonance: 0.8,
  filterEnv: 500,
  filterDecay: 0.08,
  gain: 1,
  gate: 0.8,
};

/** Glockenspiel: bright, harmonic FM strike with a long ring. */
const glock: InstrumentDef = {
  wave: 'fm',
  fmRatio: 4,
  fmIndex: 0.9,
  fmDecay: 0.12,
  attack: 0.001,
  decay: 1.1,
  sustain: 0,
  release: 0.3,
  gain: 0.5,
  gate: 1,
};

const kitGroove = 'k . r . k k? r . |';
const shaker8 = 'p@0.3 p@0.55 p@0.3 p@0.55 p@0.3 p@0.55 p@0.3 p@0.55 |';

/**
 * Relaxed casual-puzzle loop in F major, 108 bpm, 20 bars (44.4 s), seamless:
 *   A   F  Am  Bb    C       marimba tune, e-piano pads, round bass, soft rim/kick groove + shaker
 *   A2  F  Am  Bb-C  F       tune answers and resolves, e-piano comps in 3-3-2
 *   B   Bb C   Am    Dm      calmer: long 3-3-2 notes, pluck arpeggios instead of keys, half-time drums
 *   B2  Gm C   Am-Dm Gm-C    builds back: keys return with 7ths, tom fill into the return
 *   A3  F  Am  Bb    C       tune again with a glockenspiel counter-line; C (V) turns back to A
 */
const bgm: SongDef = defineSong({
  bpm: 108,
  key: 'F major',
  swing: 0.1,
  seed: 3,
  kbps: 80,
  master: { loudness: -24, ceiling: -1.5, reverb: { room: 0.6, damp: 0.5 } },
  tracks: {
    lead: {
      instrument: 'marimba',
      volume: 0.62,
      pan: 0.05,
      humanize: { time: 0.004, velocity: 0.08 },
      effects: { reverb: 0.2, delay: { time: 0.75, feedback: 0.2, mix: 0.1 } },
    },
    keys: { instrument: 'epiano', volume: 0.3, pan: -0.2, humanize: { time: 0.005, velocity: 0.06 }, effects: { reverb: 0.25 } },
    arp: {
      instrument: 'pluck',
      volume: 0.22,
      pan: 0.35,
      arp: { pattern: 'updown', rate: 2 },
      effects: { reverb: 0.3, lowpass: 3500 },
    },
    glock: { instrument: glock, volume: 0.14, pan: -0.35, effects: { reverb: 0.35 } },
    bass: { instrument: roundBass, volume: 0.45 },
    kit: { instrument: 'drums', volume: 0.34, effects: { reverb: 0.05 } },
    shaker: { instrument: 'drums', volume: 0.22, pan: 0.1, humanize: { velocity: 0.12 } },
  },
  sections: {
    A: {
      lead: 'A4 . C5 F5 A5 - G5 F5 | E5 . C5 E5 A5 - G5 E5 | F5 . D5 F5 Bb5 - A5 G5 | G5 - E5 - C5 - D5 E5 |',
      keys: 'F? | Am? | Bb? | C? |',
      bass: 'F2 . . F2 C3 . F2 . | A2 . . A2 E2 . A2 . | Bb2 . . Bb2 F2 . Bb2 . | C3 . . C3 G2 . C3 . |',
      kit: kitGroove,
      shaker: shaker8,
    },
    A2: {
      lead: 'A4 . C5 F5 A5 - G5 F5 | E5 . C5 E5 A5 - C6 A5 | Bb5 A5 G5 F5 E5 F5 G5 E5 | F5 - - . C5 D5 E5 . |',
      keys: 'F? - - F? - - F? - | Am? - - Am? - - Am? - | Bb? - - Bb? C? - - C? | F? - - F? - - F? - |',
      bass: 'F2 . . F2 C3 . F2 . | A2 . . A2 E2 . A2 . | Bb2 . . Bb2 C3 . . C3 | F2 . . F2 A2 . C3 . |',
      kit: `${kitGroove} ${kitGroove} ${kitGroove} k . r . k . r r? |`,
      shaker: shaker8,
    },
    B: {
      lead: 'F5 - - D5 - - C5 D5 | E5 - - G5 - - E5 C5 | C5 - - E5 - - A5 G5 | F5 - - D5 - - A4 . |',
      arp: 'Bb | C | Am | Dm |',
      bass: 'Bb2 - - Bb2 - - F2 . | C3 - - C3 - - G2 . | A2 - - A2 - - E2 . | D2 - - D2 - - A2 . |',
      kit: 'k . . . r . . . | k . . k? r . . . |',
      shaker: 'p@0.3 . p@0.45 . p@0.3 . p@0.45 . |',
    },
    B2: {
      lead: 'Bb4 - - D5 - - G5 F5 | E5 - - G5 - - C6 - | C6 - A5 E5 F5 - A5 D5 | Bb5 A5 G5 D5 E5 - G5 . |',
      keys: 'Gm7? | C? | Am? Dm7? | Gm7? - Csus4? C? |',
      arp: 'Gm | C | Am Dm | Gm C |',
      bass: 'G2 - - G2 - - D2 . | C3 - - C3 - - G2 . | A2 - - A2 D2 - - D3 | G2 - - G2 C3 - - C3 |',
      kit: `${kitGroove} ${kitGroove} ${kitGroove} k . r . t t? l l? |`,
      shaker: shaker8,
    },
    A3: {
      lead: 'A4 . C5 F5 A5 - G5 F5 | E5 . C5 E5 A5 - G5 E5 | F5 . D5 F5 Bb5 - C6 Bb5 | A5 - G5 - E5 - C5 . |',
      keys: 'F? - - F? - - F? - | Am? - - Am? - - Am? - | Bb? - - Bb? - - Bb? - | C? - - C? - - C? - |',
      glock: 'C6 . A5 . | C6 . E6 . | D6 . F6 . | E6 . C6 . |',
      bass: 'F2 . . F2 C3 . F2 . | A2 . . A2 E2 . A2 . | Bb2 . . Bb2 F2 . Bb2 . | C3 . . C3 G2 . C3 . |',
      kit: kitGroove,
      shaker: shaker8,
    },
  },
  arrangement: ['A', 'A2', 'B', 'B2', 'A3'],
});

export const music: Record<string, SongDef> = { bgm };
