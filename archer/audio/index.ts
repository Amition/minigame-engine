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

// 布偶弓箭手 sounds. `pnpm audio --app archer` renders them to archer/assets/audio/*.mp3 + manifest.json; without
// the files the AudioManager synthesizes them at runtime. AUDIO CONTRACT: the names below are what the game plays.
//   draw       bow starts being drawn (string creak), rate 0.9..1.1
//   shoot      arrow released: string twang + whoosh, rate = 0.85 + 0.3 * power (power 0..1)
//   hit        arrow into a body (thud)
//   headshot   arrow into a head (sharper crack + small ding), played instead of hit
//   thunk      arrow into stone (tower / floating block)
//   hurt       the player is hit (lower, heavier than hit)
//   explode    explosive arrow / missile blast
//   zap        electric arrow hit (stun)
//   poison     poison arrow hit (bubbly hiss)
//   balloon    balloon tied to an enemy (rubber squeak / inflate)
//   saw        chainsaw arrow cutting through (short buzz)
//   heal       vampire arrow heals / red or gold apple heals
//   apple      an apple was shot (juicy pop + chime)
//   coin       skulls awarded for a kill (coin-like rattle)
//   kill       enemy dies (low thump)
//   boss       boss enemy arrives (low horn)
//   arrive     a normal enemy arrives (soft swoosh)
//   jump       player hops
//   revive     spare life used / ad revive (rising shimmer)
//   gameover   run over sting
//   record     new best score
//   buy        upgrade bought / arrow unlocked (cash register chime)
//   deny       can't afford / not enough stamina (short low buzz)
//   click      UI button
//   equip      arrow equipped / switched in battle (light click-slide)
// Music:
//   bgm        battle loop (moody minor key, medium tempo), loops seamlessly
//   menu       calm menu loop (same key as bgm)
// Everything is in D minor (D E F G A Bb C, C# as leading tone), the key of both loops. Pitched sfx use its notes:
// open D-A fifths for neutral/heroic cues, the relative F major triad for heal, a D major chord to crown record.

const hz = (note: string): number => {
  const midi = noteNameToMidi(note);
  if (midi === null) throw new Error(`archer audio: "${note}" is not a note`);
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
    throw new Error('archer audio: the first voice of a stack needs wave, freq and at = 0');
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

/** Small metal clink: a sine with an inharmonic partial (x2.76) and a tick of hiss. */
const clink = (at: number, note: string, gain: number, decay: number): SfxLayer[] => [
  voice({ at, wave: 'sine', freq: hz(note), sustain: 0.002, decay, decayCurve: 2.4, gain }),
  voice({ at, wave: 'sine', freq: hz(note) * 2.76, sustain: 0.001, decay: decay * 0.45, decayCurve: 3, gain: gain * 0.35 }),
  voice({ at, wave: 'white', freq: 1000, sustain: 0.001, decay: 0.005, highpass: 4000, gain: gain * 0.2 }),
];

/** Dark brass: two slightly detuned low-passed saws and a triangle an octave down for body. */
const brass = (at: number, note: string, hold: number, decay: number, gain: number, extra: Partial<Voice> = {}): SfxLayer[] => [
  voice({ at, wave: 'saw', freq: hz(note), attack: 0.03, sustain: hold, decay, decayCurve: 1.6, lowpass: 1500, gain, ...extra }),
  voice({ at, wave: 'saw', freq: hz(note) * 1.005, attack: 0.03, sustain: hold, decay, decayCurve: 1.6, lowpass: 1200, gain: gain * 0.6, ...extra }),
  voice({ at, wave: 'triangle', freq: hz(note) / 2, attack: 0.02, sustain: hold, decay, decayCurve: 1.6, gain: gain * 0.55, ...extra }),
];

/** Taiko-like boom: a sine falling fast onto its pitch, with a dull skin thump. */
const boom = (at: number, freq: number, decay: number, gain: number): SfxLayer[] => [
  voice({ at, wave: 'sine', freq: freq * 1.6, slide: -60, freqMin: freq, sustain: 0.02, decay, decayCurve: 2.2, punch: 0.5, gain }),
  voice({ at, wave: 'noise', freq: 50, sustain: 0.006, decay: 0.08, lowpass: 600, gain: gain * 0.45 }),
];

// ---------------------------------------------------------------- sfx

/**
 * Creaky string stretch: two very low saws are ratchet-like click trains (each saw reset is a tick) that speed up
 * as the string tightens, band-passed into a woody creak; a faint D4 -> A4 tension tone rises underneath.
 */
const draw = stack(
  [
    voice({ wave: 'saw', freq: 30, slide: 30, attack: 0.02, sustain: 0.24, decay: 0.08, decayCurve: 1.6, bandpass: 1300, bandpassQ: 4, bandpassSweep: 0.8 }),
    voice({ wave: 'saw', freq: 43, slide: 26, attack: 0.03, sustain: 0.22, decay: 0.08, decayCurve: 1.6, bandpass: 800, bandpassQ: 3, gain: 0.6 }),
    voice({ wave: 'triangle', freq: hz('D4'), slide: 20, freqMax: hz('A4'), attack: 0.06, sustain: 0.2, decay: 0.08, lowpass: 1600, gain: 0.18 }),
    voice({ wave: 'white', freq: 1000, attack: 0.05, sustain: 0.18, decay: 0.08, bandpass: 2600, bandpassQ: 3, bandpassSweep: 1, gain: 0.12 }),
  ],
  { volume: 0.48, seed: 31 },
);

/**
 * Release: a D3 string twang whose low-pass snaps shut, the limbs' low thump, and a band of air falling away as the
 * arrow leaves. Played at rate 0.85..1.15 with the draw power.
 */
const shoot = stack(
  [
    voice({ wave: 'saw', freq: hz('D3'), slide: -8, sustain: 0.006, decay: 0.15, decayCurve: 2.4, punch: 0.6, lowpass: 3000, lowpassQ: 1.8, lowpassSweep: -6 }),
    voice({ wave: 'triangle', freq: hz('D4'), slide: -8, sustain: 0.004, decay: 0.09, decayCurve: 2.6, gain: 0.35 }),
    voice({ wave: 'sine', freq: hz('A2'), slide: -40, sustain: 0.004, decay: 0.05, gain: 0.5 }),
    voice({ wave: 'white', freq: 1000, attack: 0.008, sustain: 0.02, decay: 0.13, decayCurve: 1.8, bandpass: 2000, bandpassQ: 1.3, bandpassSweep: -3, gain: 0.65 }),
    voice({ wave: 'white', freq: 1000, sustain: 0.001, decay: 0.006, highpass: 3500, gain: 0.25 }),
  ],
  { volume: 0.66, seed: 33 },
);

/** Meaty thud: falling A2 sine, a dark noise thump and a short wet slap. */
const hit = stack(
  [
    voice({ wave: 'sine', freq: hz('A2'), slide: -30, sustain: 0.012, decay: 0.11, punch: 0.5 }),
    voice({ wave: 'noise', freq: 150, sustain: 0.006, decay: 0.08, punch: 0.5, lowpass: 1600, lowpassSweep: -4, gain: 0.8 }),
    voice({ wave: 'white', freq: 1000, sustain: 0.002, decay: 0.025, decayCurve: 2.5, bandpass: 1100, bandpassQ: 1.4, gain: 0.45 }),
  ],
  { volume: 0.55, seed: 35 },
);

/** Sharp crack over a smaller thud, then a small bright ding on A6 + D6. */
const headshot = stack(
  [
    voice({ wave: 'white', freq: 1000, sustain: 0.002, decay: 0.04, decayCurve: 3, bandpass: 2400, bandpassQ: 0.9 }),
    voice({ wave: 'sine', freq: hz('D3'), slide: -36, sustain: 0.008, decay: 0.08, punch: 0.4, gain: 0.8 }),
    voice({ wave: 'noise', freq: 250, sustain: 0.004, decay: 0.05, lowpass: 3500, lowpassSweep: -4, gain: 0.6 }),
    ...chime(0.03, 'A6', 0.3, 0.26),
    ...chime(0.03, 'D6', 0.16, 0.2),
  ],
  { volume: 0.6, seed: 37 },
);

/** Dry knock of wood on stone (D4 body, A5 click, gritty tick), with a faint quiver of the stuck shaft. */
const thunk = stack(
  [
    voice({ wave: 'sine', freq: hz('D4'), slide: -24, sustain: 0.002, decay: 0.05, decayCurve: 3, punch: 0.4 }),
    voice({ wave: 'sine', freq: hz('A5'), sustain: 0.001, decay: 0.022, decayCurve: 3, gain: 0.35 }),
    voice({ wave: 'white', freq: 1000, sustain: 0.001, decay: 0.014, bandpass: 1900, bandpassQ: 2, gain: 0.8 }),
    voice({ wave: 'noise', freq: 100, sustain: 0.004, decay: 0.04, lowpass: 900, gain: 0.5 }),
    voice({ at: 0.012, wave: 'triangle', freq: hz('D3'), sustain: 0.01, decay: 0.15, tremolo: 0.8, tremoloRate: 30, lowpass: 900, gain: 0.12 }),
  ],
  { volume: 0.45, seed: 39 },
);

/** Heavier than hit: a deep falling sine, a dark noise body and a short driven "oof" on D3. */
const hurt = stack(
  [
    voice({ wave: 'sine', freq: 95, slide: -18, sustain: 0.02, decay: 0.22, punch: 0.6 }),
    voice({ wave: 'noise', freq: 90, sustain: 0.01, decay: 0.14, punch: 0.4, lowpass: 1100, lowpassSweep: -3, gain: 0.9 }),
    voice({ wave: 'saw', freq: hz('D3'), slide: -16, sustain: 0.02, decay: 0.16, lowpass: 700, drive: 0.3, gain: 0.35 }),
    voice({ wave: 'white', freq: 1000, sustain: 0.002, decay: 0.03, bandpass: 900, bandpassQ: 1, gain: 0.4 }),
  ],
  { volume: 0.6, seed: 41 },
);

/** Punchy boom: a rumbling noise body with a closing filter, a falling sub, a crack and a short debris rattle. */
const explode = stack(
  [
    voice({ wave: 'noise', freq: 60, slide: -5, sustain: 0.05, decay: 0.62, decayCurve: 2.4, punch: 0.7, lowpass: 3200, lowpassSweep: -2.4 }),
    voice({ wave: 'sine', freq: 80, slide: -26, sustain: 0.04, decay: 0.34, punch: 0.4, lowpass: 400 }),
    voice({ wave: 'white', freq: 1000, sustain: 0.004, decay: 0.05, highpass: 1200, gain: 0.5 }),
    voice({ at: 0.08, wave: 'noise', freq: 120, sustain: 0.02, decay: 0.3, tremolo: 0.7, tremoloRate: 19, lowpass: 2500, gain: 0.2 }),
  ],
  { volume: 0.85, seed: 43 },
);

/** Electric crackle: a crushed pulse jumping around A5, a buzzing D3 at mains-like rate and stuttering hiss. */
const zap = stack(
  [
    voice({ wave: 'square', freq: hz('A5'), duty: 0.3, arp: [0, 13, -7, 17, 5, 22, -2, 12, 3], arpStep: 0.018, sustain: 0.1, decay: 0.12, lowpass: 5000, crush: 5, gain: 0.45 }),
    voice({ wave: 'saw', freq: hz('D3'), sustain: 0.12, decay: 0.12, tremolo: 0.9, tremoloRate: 55, drive: 0.5, lowpass: 3000, gain: 0.6 }),
    voice({ wave: 'white', freq: 1000, sustain: 0.08, decay: 0.16, highpass: 2000, lowpass: 7000, tremolo: 1, tremoloRate: 41, gain: 0.45 }),
    voice({ wave: 'white', freq: 1000, sustain: 0.002, decay: 0.012, gain: 0.6 }),
  ],
  { volume: 0.5, seed: 45 },
);

/** Bubbly hiss: two streams of rising sine bubbles (pitch restarts every 65 / 85 ms) over a soft hiss. */
const poison = stack(
  [
    voice({ wave: 'sine', freq: 280, slide: 30, slideAccel: 300, repeat: 0.065, sustain: 0.22, decay: 0.12, vibrato: 0.6, vibratoRate: 26 }),
    voice({ at: 0.03, wave: 'sine', freq: 400, slide: 40, slideAccel: 320, repeat: 0.085, sustain: 0.16, decay: 0.12, gain: 0.7 }),
    voice({ wave: 'white', freq: 1000, attack: 0.02, sustain: 0.12, decay: 0.22, decayCurve: 1.6, bandpass: 3200, bandpassQ: 0.8, lowpass: 6000, gain: 0.35 }),
  ],
  { volume: 0.45, seed: 47 },
);

/** Rubbery squeak: a wobbling D5 rising a little, a nasal pulse formant and a breath of inflating air. */
const balloon = stack(
  [
    voice({ wave: 'triangle', freq: hz('D5'), slide: 14, attack: 0.008, sustain: 0.13, decay: 0.08, vibrato: 1.1, vibratoRate: 17, lowpass: 3000 }),
    voice({ wave: 'square', freq: hz('D5'), duty: 0.15, slide: 14, attack: 0.008, sustain: 0.13, decay: 0.08, vibrato: 1.1, vibratoRate: 17, bandpass: 1800, bandpassQ: 2, gain: 0.3 }),
    voice({ wave: 'white', freq: 1000, attack: 0.03, sustain: 0.1, decay: 0.08, bandpass: 900, bandpassQ: 1.5, bandpassSweep: 2.5, gain: 0.25 }),
  ],
  { volume: 0.45, seed: 49 },
);

/** Short chainsaw: a driven, pulsing A2 saw revving slightly, a detuned pulse and a gritty grinding band. */
const saw = stack(
  [
    voice({ wave: 'saw', freq: hz('A2'), slide: 4, sustain: 0.2, decay: 0.1, decayCurve: 1.5, tremolo: 0.45, tremoloRate: 36, vibrato: 0.35, vibratoRate: 9, lowpass: 2600, drive: 0.45 }),
    voice({ wave: 'square', freq: hz('A2') * 1.012, duty: 0.3, slide: 4, sustain: 0.2, decay: 0.1, lowpass: 1600, gain: 0.35 }),
    voice({ wave: 'noise', freq: 110, sustain: 0.2, decay: 0.1, bandpass: 2400, bandpassQ: 1.4, tremolo: 0.7, tremoloRate: 36, gain: 0.4 }),
  ],
  { volume: 0.45, seed: 51 },
);

/** Soft rising sparkle: F major chimes F5 A5 C6 F6 over a warm, shimmering F4 swell. */
const heal = stack(
  [
    ...chime(0, 'F5', 0.8, 0.22),
    voice({ wave: 'sine', freq: hz('F4'), attack: 0.06, sustain: 0.12, decay: 0.3, slide: 2, tremolo: 0.25, tremoloRate: 12, gain: 0.5 }),
    ...chime(0.06, 'A5', 0.75, 0.22),
    ...chime(0.12, 'C6', 0.7, 0.24),
    ...chime(0.18, 'F6', 0.6, 0.3),
    voice({ at: 0.1, wave: 'white', freq: 1000, attack: 0.08, sustain: 0.05, decay: 0.2, bandpass: 6000, bandpassQ: 2, gain: 0.06 }),
  ],
  { volume: 0.48, seed: 53 },
);

/** Juicy pop (rising sine, wet squelch, crunch) and a quick D6 -> A6 chime. */
const apple = stack(
  [
    voice({ wave: 'sine', freq: 360, slide: 64, sustain: 0.01, decay: 0.07, punch: 0.5 }),
    voice({ wave: 'white', freq: 1000, sustain: 0.004, decay: 0.07, decayCurve: 2.2, bandpass: 1400, bandpassQ: 2.2, bandpassSweep: 5, gain: 0.7 }),
    voice({ wave: 'noise', freq: 180, sustain: 0.006, decay: 0.045, lowpass: 2500, gain: 0.45 }),
    ...chime(0.05, 'D6', 0.45, 0.22),
    ...chime(0.1, 'A6', 0.35, 0.3),
  ],
  { volume: 0.58, seed: 55 },
);

/** Skull coins: a dull bony knock, then four uneven metal clinks (A6 D6 F6, last A6 rings). */
const coin = stack(
  [
    voice({ wave: 'sine', freq: hz('D5'), slide: -20, sustain: 0.002, decay: 0.03, decayCurve: 3 }),
    voice({ wave: 'noise', freq: 200, sustain: 0.002, decay: 0.02, lowpass: 3000, gain: 0.4 }),
    ...clink(0.012, 'A6', 0.9, 0.07),
    ...clink(0.055, 'D6', 0.75, 0.06),
    ...clink(0.09, 'F6', 0.7, 0.06),
    ...clink(0.125, 'A6', 0.8, 0.18),
  ],
  { volume: 0.5, seed: 57 },
);

/** Low thump: a sine falling from 120 Hz, a dark noise body, a sinking D3 tone and a small click. */
const kill = stack(
  [
    voice({ wave: 'sine', freq: 120, slide: -36, sustain: 0.02, decay: 0.26, punch: 0.7 }),
    voice({ wave: 'noise', freq: 70, sustain: 0.01, decay: 0.12, lowpass: 900, gain: 0.6 }),
    voice({ wave: 'triangle', freq: hz('D3'), slide: -6, sustain: 0.03, decay: 0.28, lowpass: 800, gain: 0.3 }),
    voice({ wave: 'white', freq: 1000, sustain: 0.002, decay: 0.02, bandpass: 1500, gain: 0.35 }),
  ],
  { volume: 0.52, seed: 59 },
);

/** Ominous horn call "A2 - D3" in open fifths over two taiko booms, sagging slightly at the end. */
const sag: Partial<Voice> = { vibrato: 0.14, vibratoRate: 4.5, slide: -0.6 };
const boss = stack(
  [
    ...boom(0, hz('D2'), 0.55, 1),
    ...brass(0.02, 'A2', 0.2, 0.12, 0.8, { lowpass: 900 }),
    ...boom(0.36, hz('D2'), 0.5, 0.85),
    ...brass(0.36, 'D3', 0.8, 0.6, 1, { ...sag, lowpass: 1000 }),
    ...brass(0.36, 'A3', 0.8, 0.6, 0.45, { ...sag, lowpass: 1000 }),
  ],
  { volume: 0.78, reverb: 0.15, seed: 61 },
);

/** Soft swoosh (rising band of air) and a light landing tap. */
const arrive = stack(
  [
    voice({ wave: 'white', freq: 1000, attack: 0.07, sustain: 0.03, decay: 0.18, decayCurve: 1.6, bandpass: 450, bandpassQ: 1.4, bandpassSweep: 3, lowpass: 3000 }),
    voice({ at: 0.18, wave: 'sine', freq: 130, slide: -30, sustain: 0.005, decay: 0.07, gain: 0.35 }),
  ],
  { volume: 0.46, seed: 63 },
);

/** Light hop: a triangle springing up from D4 and a soft push of air. */
const jump = stack(
  [
    voice({ wave: 'triangle', freq: hz('D4'), slide: 36, slideAccel: -60, sustain: 0.03, decay: 0.09, punch: 0.3, lowpass: 3000 }),
    voice({ wave: 'white', freq: 1000, sustain: 0.004, decay: 0.05, bandpass: 700, bandpassQ: 1.2, gain: 0.4 }),
  ],
  { volume: 0.4, seed: 65 },
);

/** Rising shimmer: open-fifth chimes D5 A5 D6 A6 D7 over a trembling D4/A4 swell gliding up an octave. */
const revive = stack(
  [
    ...chime(0, 'D5', 0.6, 0.25),
    voice({ wave: 'sine', freq: hz('D4'), slide: 12, freqMax: hz('D5'), attack: 0.03, sustain: 0.5, decay: 0.4, tremolo: 0.35, tremoloRate: 16, gain: 0.5 }),
    voice({ wave: 'sine', freq: hz('A4'), slide: 12, freqMax: hz('A5'), attack: 0.05, sustain: 0.45, decay: 0.4, tremolo: 0.35, tremoloRate: 13, gain: 0.35 }),
    ...chime(0.09, 'A5', 0.6, 0.25),
    ...chime(0.18, 'D6', 0.55, 0.28),
    ...chime(0.27, 'A6', 0.5, 0.3),
    ...chime(0.36, 'D7', 0.4, 0.45),
    voice({ at: 0.05, wave: 'white', freq: 1000, attack: 0.25, sustain: 0.1, decay: 0.3, bandpass: 5000, bandpassQ: 2, bandpassSweep: 1, gain: 0.06 }),
  ],
  { volume: 0.6, echo: 0.1, echoFeedback: 0.25, echoMix: 0.2, seed: 67 },
);

/** Short sad sting: brass A4 F4 E4 falling onto a sagging D minor chord with a low boom. */
const gameover = stack(
  [
    ...brass(0, 'A4', 0.12, 0.1, 0.9),
    ...brass(0.2, 'F4', 0.12, 0.1, 0.9),
    ...brass(0.4, 'E4', 0.12, 0.1, 0.9),
    ...brass(0.62, 'D4', 0.5, 0.6, 1, sag),
    ...brass(0.62, 'A3', 0.5, 0.6, 0.5, sag),
    ...brass(0.62, 'F3', 0.5, 0.6, 0.4, sag),
    ...boom(0.62, hz('D2'), 0.5, 0.7),
  ],
  { volume: 0.7, reverb: 0.12, seed: 69 },
);

/** Triumphant fanfare "ta-ta-ta TAA ta TAAA" (A4 A4 A4 D5 A4, then a D major chord) with twinkles on top. */
const shine: Partial<Voice> = { lowpass: 2600 };
const record = stack(
  [
    ...brass(0, 'A4', 0.05, 0.04, 0.85, shine),
    ...brass(0.09, 'A4', 0.05, 0.04, 0.85, shine),
    ...brass(0.18, 'A4', 0.05, 0.04, 0.85, shine),
    ...brass(0.27, 'D5', 0.12, 0.06, 1, shine),
    ...brass(0.45, 'A4', 0.05, 0.04, 0.85, shine),
    ...brass(0.56, 'A5', 0.5, 0.6, 1, { ...shine, vibrato: 0.2, vibratoRate: 6 }),
    ...brass(0.56, 'F#5', 0.5, 0.6, 0.55, shine),
    ...brass(0.56, 'D5', 0.5, 0.6, 0.5, shine),
    ...boom(0.56, hz('D2'), 0.4, 0.6),
    ...chime(0.62, 'A6', 0.22, 0.3),
    ...chime(0.72, 'D7', 0.18, 0.3),
    ...chime(0.82, 'F#7', 0.14, 0.4),
  ],
  { volume: 0.8, echo: 0.11, echoFeedback: 0.2, echoMix: 0.18, seed: 71 },
);

/** Cash register "ka-ching": a drawer click, then an A6 + D7 bell and a short rattle of coins. */
const buy = stack(
  [
    voice({ wave: 'white', freq: 1000, sustain: 0.002, decay: 0.02, bandpass: 2500, bandpassQ: 1.5 }),
    voice({ wave: 'noise', freq: 200, sustain: 0.004, decay: 0.03, lowpass: 2500, gain: 0.5 }),
    ...chime(0.06, 'A6', 0.8, 0.25),
    ...chime(0.06, 'D7', 0.7, 0.4),
    ...clink(0.1, 'F6', 0.35, 0.06),
    ...clink(0.14, 'A6', 0.3, 0.06),
  ],
  { volume: 0.56, seed: 73 },
);

/** Short low buzz: D3 saw rubbing against a pulse a semitone up. */
const deny = stack(
  [
    voice({ wave: 'saw', freq: hz('D3'), slide: -3, sustain: 0.1, decay: 0.06, lowpass: 1100, drive: 0.25 }),
    voice({ wave: 'square', freq: hz('D3') * 1.06, slide: -3, sustain: 0.1, decay: 0.06, lowpass: 1100, gain: 0.5 }),
    voice({ wave: 'sine', freq: hz('D2'), sustain: 0.1, decay: 0.06, gain: 0.4 }),
  ],
  { volume: 0.42, seed: 75 },
);

/** UI tick: D6 dropping fast over an A5 body and a tiny click of noise. */
const click = stack(
  [
    voice({ wave: 'sine', freq: hz('D6'), slide: -40, sustain: 0.002, decay: 0.028, decayCurve: 3 }),
    voice({ wave: 'sine', freq: hz('A5'), sustain: 0.002, decay: 0.032, decayCurve: 2.5, gain: 0.4 }),
    voice({ wave: 'white', freq: 1000, sustain: 0.001, decay: 0.006, highpass: 3000, gain: 0.25 }),
  ],
  { volume: 0.42, seed: 77 },
);

/** Light slide-click: a short rising band of friction, then an A5/D6 click as the arrow seats. */
const equip = stack(
  [
    voice({ wave: 'white', freq: 1000, attack: 0.01, sustain: 0.02, decay: 0.05, bandpass: 1400, bandpassQ: 2.5, bandpassSweep: 6, lowpass: 2500 }),
    voice({ at: 0.055, wave: 'sine', freq: hz('A5'), slide: -20, sustain: 0.002, decay: 0.035, decayCurve: 3, gain: 1 }),
    voice({ at: 0.055, wave: 'sine', freq: hz('D6'), sustain: 0.002, decay: 0.03, decayCurve: 3, gain: 0.4 }),
    voice({ at: 0.055, wave: 'white', freq: 1000, sustain: 0.001, decay: 0.006, bandpass: 2500, bandpassQ: 1.2, gain: 0.3 }),
  ],
  { volume: 0.55, seed: 79 },
);

export const sfx: Record<string, SfxParams | (() => SfxParams)> = {
  draw,
  shoot,
  hit,
  headshot,
  thunk,
  hurt,
  explode,
  zap,
  poison,
  balloon,
  saw,
  heal,
  apple,
  coin,
  kill,
  boss,
  arrive,
  jump,
  revive,
  gameover,
  record,
  buy,
  deny,
  click,
  equip,
};

// ---------------------------------------------------------------- music

/** Plucked bass string: short Karplus-Strong ring, darker than the default pluck. */
const pluckBass: InstrumentDef = {
  wave: 'pluck',
  pluckDecay: 0.8,
  brightness: 0.5,
  attack: 0.001,
  sustain: 1,
  release: 0.06,
  gain: 1,
  gate: 0.85,
};

/** Taiko: a driven sine dropping onto its pitch, so the drum is tuned to the key. */
const taiko: InstrumentDef = {
  wave: 'sine',
  pitchEnv: 10,
  pitchDecay: 0.03,
  attack: 0.001,
  decay: 0.45,
  sustain: 0,
  release: 0.3,
  drive: 0.35,
  gain: 1,
  gate: 1,
};

/** Dark horn lead: two detuned saws behind a low-pass that opens a little on each note, late vibrato. */
const hornLead: InstrumentDef = {
  wave: 'saw',
  unison: 2,
  detune: 9,
  attack: 0.035,
  decay: 0.4,
  sustain: 0.7,
  release: 0.22,
  filter: 'lowpass',
  cutoff: 1300,
  resonance: 0.7,
  filterEnv: 900,
  filterDecay: 0.18,
  vibrato: 0.12,
  vibratoRate: 5,
  vibratoDelay: 0.35,
  gain: 0.42,
};

/** Harp: bright pluck with a long ring. */
const harp: InstrumentDef = { wave: 'pluck', pluckDecay: 2, brightness: 0.65, attack: 0.001, sustain: 1, release: 0.3, gain: 0.8 };

/** Soft sine sub for long bass notes. */
const subBass: InstrumentDef = { wave: 'sine', attack: 0.01, decay: 0.6, sustain: 0.6, release: 0.3, gain: 0.9 };

const OST = {
  Dm: 'D2 D2 A2 D2 D3 D2 A2 D2',
  Bb: 'Bb1 Bb1 F2 Bb1 Bb2 Bb1 F2 Bb1',
  C: 'C2 C2 G2 C2 C3 C2 G2 C2',
  A: 'A1 A1 E2 A1 A2 A1 E2 A1',
  Gm: 'G1 G1 D2 G1 G2 G1 D2 G1',
} as const;

/** Plucked-bass ostinato in eighths, one bar per chord. */
const ostinato = (...chords: (keyof typeof OST)[]): string => chords.map((c) => `${OST[c]} |`).join(' ');

/**
 * Battle loop in D minor, 110 bpm, 24 bars (52.4 s), seamless:
 *   I  Dm Dm Bb A           ostinato + taiko only, rim "ka" on the offbeats, fill into A
 *   A  Dm Bb C A Dm Bb Gm A the horn motif (low register), pad, taiko groove
 *   B  Bb C Dm Dm Bb C A A  climax: motif an octave up, harp arpeggios, busier taiko, soft shaker
 *   C  Gm Bb Dm A           breakdown: pad, harp and long sub notes, one boom per bar; A leads back to I
 */
const bgm: SongDef = defineSong({
  bpm: 110,
  key: 'D minor',
  seed: 5,
  kbps: 80,
  master: { loudness: -24, ceiling: -1.5, reverb: { room: 0.7, damp: 0.5 } },
  tracks: {
    lead: {
      instrument: hornLead,
      volume: 0.5,
      pan: 0.08,
      humanize: { time: 0.004, velocity: 0.06 },
      effects: { reverb: 0.3, delay: { time: 0.75, feedback: 0.25, mix: 0.12 } },
    },
    pad: { instrument: 'pad', volume: 0.2, octave: 4, pan: -0.15, effects: { reverb: 0.4, lowpass: 1600 } },
    harp: {
      instrument: harp,
      volume: 0.18,
      octave: 5,
      pan: -0.3,
      arp: { pattern: 'up', rate: 2 },
      effects: { reverb: 0.35, lowpass: 4000 },
    },
    bass: { instrument: pluckBass, volume: 0.5, humanize: { velocity: 0.08 }, effects: { lowpass: 1400 } },
    sub: { instrument: subBass, volume: 0.35 },
    taiko: { instrument: taiko, volume: 0.52, humanize: { velocity: 0.08 }, effects: { reverb: 0.15 } },
    kit: { instrument: 'drums', volume: 0.3, humanize: { velocity: 0.1 }, effects: { reverb: 0.1 } },
    shaker: { instrument: 'drums', volume: 0.16, pan: 0.15, humanize: { velocity: 0.15 } },
  },
  sections: {
    I: {
      bass: ostinato('Dm', 'Dm', 'Bb', 'A'),
      taiko: 'D2! - - - D2 - - - | D2! - - - D2 - D2? - | D2! - - - D2 - - - | D2! - D2? - D2 D2? D2 D2! |',
      kit: '. . r? . . . r? . | . . r? . . . r? . | . . r? . . . r? . | . . r . l t l l |',
    },
    A: {
      lead: 'D4 - - - A3 - D4 E4 | F4 - - - D4 - - - | E4 - - - C4 - D4 E4 | C#4 - - - A3 - - - | D4 - - - A3 - D4 E4 | F4 - - - G4 - F4 D4 | Bb4 - - - A4 - G4 F4 | E4 - - - - - . . |',
      pad: 'Dm? | Bb? | C? | A? | Dm? | Bb? | Gm? | A? |',
      bass: ostinato('Dm', 'Bb', 'C', 'A', 'Dm', 'Bb', 'Gm', 'A'),
      taiko: 'D2! - - D2? D2 - - - | D2! - - D2? D2 - D2? - |',
      kit: '. . r . . . r . | . . r . . . r r? | . . r . . . r . | . . r . . r l l |',
    },
    B: {
      lead: 'D5 - - - - - C5 Bb4 | C5 - - - G4 - - - | A4 - - - F4 - E4 F4 | D4 - - - - - . . | D5 - - - - - C5 Bb4 | C5 - - - E5 - - - | C#5 - - - - - E5 - | A4 - - - - - . . |',
      pad: 'Bb? | C? | Dm? | Dm? | Bb? | C? | A? | A? |',
      harp: 'Bb | C | Dm | Dm | Bb | C | A | A |',
      bass: ostinato('Bb', 'C', 'Dm', 'Dm', 'Bb', 'C', 'A', 'A'),
      taiko: 'D2! - D2? D2 D2! - D2? D2? | D2! - D2? D2 D2! - D2 D2 |',
      kit: 'x? . r . . . r . | . . r . . . r . | . . r . . . r . | . . r . . . r r? |',
      shaker: 'p@0.3 p@0.5 p@0.3 p@0.5 p@0.3 p@0.5 p@0.3 p@0.5 |',
    },
    C: {
      pad: 'Gm? | Bb? | Dm? | A? |',
      harp: 'Gm | Bb | Dm | A |',
      sub: 'G1 - - - - - - - | Bb1 - - - - - - - | D2 - - - - - - - | A1 - - - - - - - |',
      taiko: 'D2? - - - - - - - |',
    },
  },
  arrangement: ['I', 'A', 'B', 'C'],
});

/**
 * Menu loop in D minor, 84 bpm, 16 bars (45.7 s), seamless: harp arpeggios, a slow bell tune, pad and sub, a
 * distant taiko every two bars.
 *   A   Dm Bb F C Dm Gm Bb A    bell tune enters on the fifth (A5) and settles on E5 over A
 *   A2  Dm Bb F C Gm Bb A A     tune answers an octave higher, harp arpeggios go up and down; A leads back
 */
const menu: SongDef = defineSong({
  bpm: 84,
  key: 'D minor',
  seed: 9,
  kbps: 64,
  master: { loudness: -25, ceiling: -2, reverb: { room: 0.8, damp: 0.5 } },
  tracks: {
    bell: { instrument: 'bell', volume: 0.22, pan: 0.2, effects: { reverb: 0.45, delay: { time: 0.75, feedback: 0.3, mix: 0.15 } } },
    harp: {
      instrument: harp,
      volume: 0.26,
      octave: 4,
      pan: -0.2,
      arp: { pattern: 'up', rate: 2 },
      effects: { reverb: 0.4, lowpass: 3500 },
    },
    pad: { instrument: 'pad', volume: 0.16, octave: 4, effects: { reverb: 0.5, lowpass: 1400 } },
    sub: { instrument: subBass, volume: 0.32 },
    taiko: { instrument: taiko, volume: 0.35, effects: { reverb: 0.3 } },
  },
  sections: {
    A: {
      bell: 'A5 - - - - - - - | F5 - - - D5 - - - | C5 - - - - - - - | E5 - - - G5 - - - | A5 - - - - - - - | Bb5 - - - A5 - G5 - | F5 - - - - - - - | E5 - - - - - - - |',
      harp: 'Dm | Bb | F | C | Dm | Gm | Bb | A |',
      pad: 'Dm? | Bb? | F? | C? | Dm? | Gm? | Bb? | A? |',
      sub: 'D2 - - - - - - - | Bb1 - - - - - - - | F2 - - - - - - - | C2 - - - - - - - | D2 - - - - - - - | G1 - - - - - - - | Bb1 - - - - - - - | A1 - - - - - - - |',
      taiko: 'D2? - - - - - - - | . . . . . . . . |',
    },
    A2: {
      bell: 'D6 - - - - - C6 - | Bb5 - - - - - - - | A5 - - - F5 - - - | G5 - - - E5 - - - | D5 - - - - - F5 - | G5 - - - Bb5 - - - | A5 - - - - - - - | C#5 - - - E5 - - - |',
      harp: 'Dm | Bb | F | C | Gm | Bb | A | A |',
      pad: 'Dm? | Bb? | F? | C? | Gm? | Bb? | A? | A? |',
      sub: 'D2 - - - - - - - | Bb1 - - - - - - - | F2 - - - - - - - | C2 - - - - - - - | G1 - - - - - - - | Bb1 - - - - - - - | A1 - - - - - - - | A1 - - - - - - - |',
      taiko: 'D2? - - - - - - - | . . . . . . . . |',
    },
  },
  arrangement: ['A', 'A2'],
});

export const music: Record<string, SongDef> = { bgm, menu };
