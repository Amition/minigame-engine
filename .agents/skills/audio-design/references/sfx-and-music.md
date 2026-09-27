# Sfx and music reference

Sources: `engine/audio/sfx.ts`, `notation.ts`, `song.ts`, `instruments.ts`, `analyze.ts`, `tools/audio/cli.ts`.

## SfxParams (only `wave` and `freq` are required)

Timeline: attack (ramp up), sustain (full level + punch), decay (to silence). Voice chain: oscillator
(+ noiseMix), envelope/tremolo, filters, flanger, drive, crush. Then layers are mixed, and the root's echo,
reverb and normalisation to `volume` apply to the whole mix.

| Group | Fields (defaults) |
|---|---|
| Source | `wave`: `square saw sine triangle noise white metallic` (`noise` follows `freq`, `white` = hiss, `metallic` = pitched LFSR), `freq` Hz, `duty` (0.5), `dutySweep`/s, `noiseMix` 0..1, `seed` |
| Envelope | `attack` (0), `sustain` (0.1), `decay` (0.2) seconds, `punch` 0..1, `decayCurve` (2; 1 linear, 3+ snappier) |
| Pitch | `slide` semitones/s, `slideAccel` semitones/s², `freqMin` (20, sound cut when a falling pitch passes it), `freqMax` (16000), `vibrato` semitones, `vibratoRate` (6 Hz), `arp` (number or offsets like `[0, 4, 7]`), `arpStep` (0.08 s), `repeat` (restart slide/arp every n s) |
| Amplitude | `tremolo` 0..1, `tremoloRate` (8 Hz) |
| Filters | `lowpass` Hz, `lowpassQ` (0.9), `lowpassSweep` oct/s; `highpass`, `highpassSweep`; `bandpass`, `bandpassQ` (1), `bandpassSweep` |
| Color | `flanger` ms, `flangerSweep` ms/s, `drive` 0..1, `crush` bits, `downsample` factor |
| Space (root only) | `echo` s, `echoFeedback` (0.35), `echoMix` (0.35), `reverb` 0..1 |
| Output (root only) | `volume` peak after normalisation (0.8) |
| Layers | `layers: SfxLayer[]`: any voice fields overriding the root's, plus `at` (start, s) and `gain` (relative). A layer inherits every voice param of the root you don't override. |

`renderSfx(params, sampleRate = 44100)` returns mono PCM, trimmed, faded and normalised; deterministic.
`mutateSfx(params, amount = 0.1, seed = 1)` jitters numeric fields for variations.
`sfxPresets` (each `(seed?) => SfxParams`): `coin pickup jump hit hurt explosion powerup laser shoot click blip
select error success whoosh pop bubble win lose`. Other seeds give variations of the same preset.

Pattern from `game/audio/index.ts`: a neutral `CLEAN` layer object that resets every voice field, `voice(v)`
spreading it, and `stack(voices, master)` turning a list of voices into root + layers. Use it when layers must
not inherit the root's filters or slides.

## Notation (one text line per track and section)

```
pattern := bar ('|' bar)* '|'?          a bar lasts beatsPerBar beats, split evenly among its slots
bar     := slot* | '%'                  '%' repeats the previous bar
slot    := note | chord | drums | '.' | '-' | '(' slot+ ')'
note    := C4 F#3 Bb5                   C4 = middle C (MIDI 60)
chord   := [C4 E4 G4] | symbol          symbol has NO octave digit, voiced from the track octave
symbol  := C Am F#m7 Gsus4 Bb/D Gdom7   qualities: '' m maj7 m7 dom7 maj6 m6 dom9 maj9 m9 add9 madd9
                                         sus2 sus4 7sus4 dim dim7 m7b5 aug +
drums   := k s h o c t l x r b p        kick snare closed-hat open-hat clap tom low-tom crash rim cowbell shaker;
                                         several letters = one simultaneous hit (kh)
.       := rest     - := hold (extends the previous note one slot, across bar lines too)
( )     := subdivide one slot           C4 (D4 E4) F4 G4
mod     := ! accent (1) | ? soft (0.5) | @0.65 velocity; default 0.8
```

`G7` is the NOTE G7; write `Gdom7` for the chord. Drum letters only work on tracks with `instrument: 'drums'`.
Patterns shorter than their section loop; `''` silences a track in a section. `parseMusicNotation(text, opts)`
parses one line; `noteNameToMidi('A4')` (null if invalid), `midiToNoteName(69)`, `midiToFreq(69)`.

## SongDef

| Field | Meaning |
|---|---|
| `bpm` | required |
| `key` | e.g. `'F major'`, `'A minor'`, `'F#m'`; only used by the out-of-key check |
| `swing` (0..0.5), `swingUnit` (8 or 16), `beatsPerBar` (4) | feel and meter |
| `bars` | length when there are no sections |
| `tracks` | name -> `SongTrackDef` |
| `sections`, `arrangement` | section -> { track: pattern }; played in arrangement order |
| `loop` (true) | tails wrap to the start; `false` for one-shot jingles |
| `master` | `{ reverb: { room: 0.6, damp: 0.4, width: 1 }, loudness: -16 (RMS dBFS target), ceiling: -1 }` |
| `seed`, `kbps` (128) | humanize/arp/pluck randomness; MP3 bitrate used by the CLI |

`SongTrackDef`: `instrument` (name or `InstrumentDef`), `notes` (default pattern), `volume` (0.7), `pan` -1..1,
`octave` (4, register for chord symbols), `voicing` (`close` default: smooth inversions; `root`), `transpose`,
`gate`, `step` (fixed slot length in beats), `arp` (`{ pattern: 'up' | 'down' | 'updown' | 'random', rate
(notes per beat), octaves }`), `humanize` (`{ time: s, velocity: fraction }`), `effects` (`{ reverb: send 0..1,
delay: { time: beats, feedback, mix }, lowpass, highpass, drive, crush }`).

Built-in instruments: `square pulse triangle sine saw pluck bell epiano marimba organ pad bass` and `drums`.
Custom `InstrumentDef`: `wave` (oscillator shapes, `wavetable` + `harmonics`, `pluck` + `pluckDecay`/`brightness`,
`fm` + `fmRatio`/`fmIndex`/`fmDecay`), `duty`, `unison` + `detune` (cents), `sub`, ADSR (`attack decay sustain
release`), `filter` + `cutoff` + `resonance` + `filterEnv`/`filterDecay`, `pitchEnv`/`pitchDecay`, `vibrato`
(+`vibratoRate`, `vibratoDelay`), `tremolo`(+`tremoloRate`), `drive`, `gain`, `gate`.

Offline helpers: `renderSong(song, { sampleRate, loops })` -> `{ left, right, duration, loopStart, loopEnd,
schedule }`; `scheduleSong(song)` -> notes, duration, bars, sections (no audio, fast; good for tests);
`analyzeSongKey(song)` -> `{ key, total, outOfKey, examples }`.

## Analyzer (`analyzeAudio(pcm, sampleRate, { kind: 'sfx' | 'music', loop })`)

Returns `duration peakDb rmsDb loudnessDb crestDb clipped dcOffset leadingSilence trailingSilence centroidHz zcr
onsets seamJump issues verdict`. Issues:

| Issue | Threshold |
|---|---|
| clipping / no headroom | any sample at full scale / peak > -0.3 dBFS |
| too quiet / quiet | peak < -12 dBFS / loudness < -30 (sfx) or -26 (music) dBFS |
| dense/loud (sfx), very loud (music) | loudness > -6 / > -8 dBFS |
| late start (sfx) | leading silence > 20 ms |
| long silent tail | > 150 ms and > 20% of the sound (not for loops) |
| DC offset | > 0.01 |
| harsh/bright, muddy | centroid > 6000 Hz / < 120 Hz |
| over-compressed (music) | crest < 6 dB |
| long for an sfx | > 3 s |
| loop seam jump | end-to-start jump > 25% of peak |

## CLI (`tools/audio/cli.ts`)

`pnpm audio --app <dir> [--only a,b] [--format mp3|wav] [--preview] [--force]`. Reads `<app>/audio/index.ts`
(named `sfx`/`music` exports or a default `{ sfx, music }`), writes `<app>/assets/audio/<name>.<ext>` +
`manifest.json`, caches by definition + engine synth source in `<app>/audio/.render-cache.json`, removes stale
files on full runs, writes previews to `.shots/audio/<name>.png`. Always pass `--app` (the default is
`sandbox`). Names must match `^[a-z0-9][a-z0-9_-]*$` (case-insensitive) and be unique across sfx and music.
