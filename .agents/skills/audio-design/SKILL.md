---
name: audio-design
description: Designs, renders, checks and plays game sound with the engine's audio module - parametric sound effects (SfxParams, layers, sfxPresets, mutateSfx), music written as text notation (defineSong with tracks, chord symbols, drums, sections, arrangement), the pnpm audio CLI that renders MP3s plus a manifest and prints a loudness/clipping/key analysis table with preview PNGs, and the runtime AudioManager (playSfx with rate/volume/cooldown, playMusic with cross-fades, master/music/sfx mute and volume persisted, preload, web autoplay unlock, synth fallback) within the package size budget. Use when adding or changing sound effects, background music, jingles, UI clicks, mute/volume settings, or when audio is too loud, too quiet, clipping, late, off-key, repetitive or missing on a device ("sound", "sfx", "audio", "music", "bgm", "jingle", "volume", "mute", "音效", "音乐", "背景音乐", "声音", "静音", "配乐").
---

# Audio design

Sounds are data in `<app>/audio/index.ts`: `sfx` (SfxParams) and `music` (SongDef). `pnpm audio --app <app>`
renders them to `<app>/assets/audio/*.mp3` + `manifest.json` and prints an analysis you can judge without
listening. At runtime the `AudioManager` plays the files (or synthesizes missing ones from the same library).
All names are exported from `'@engine'` (source `engine/audio/`). Worked example: `game/audio/index.ts`
(10 sfx tuned to F major + a 44 s five-section loop) and its contract test `game/audio/audio.test.ts`.
Timing sounds to hits, squash and shake is covered by the `game-feel` skill.

## Workflow

1. **Write the sound contract** before designing: names (file-safe, unique across sfx and music), when each
   plays, max length, and how it varies (e.g. `merge` rate falls with fruit size). Put it in a comment at the
   top of `<app>/audio/index.ts` and in a test (step 5).
2. **Pick one key** for the music and tune pitched sfx to its scale (use `noteNameToMidi` + `midiToFreq`), so
   effects and music sound like one family.
3. **Design** each sfx from a preset (`sfxPresets.coin(seed)`) or from scratch with layered voices; write music
   as notation (grammar in `references/sfx-and-music.md`).
4. **Render and read the analysis**: `pnpm audio --app game` (all), `pnpm audio --app game --only "merge,bgm" --preview`
   (quote comma lists in PowerShell). Fix every verdict that is not `ok`, then Read `.shots/audio/<name>.png`
   (waveform, spectrogram, piano roll for songs).
5. **Test** lengths, verdicts, key and loop seam with `renderSfx`/`renderSong` + `analyzeAudio` (pattern of
   `game/audio/audio.test.ts`), and `t.played()` in gameplay tests.
6. **Play** through the AudioManager; commit the rendered MP3s and manifest so builds ship them.

## Define sounds

```ts
import { defineSong, mutateSfx, sfxPresets, type SfxParams, type SongDef } from '@engine';

/** Rising square blip; layers inherit every voice param of the root. */
const jump: SfxParams = { wave: 'square', freq: 330, duty: 0.25, sustain: 0.04, decay: 0.16, slide: 24, lowpass: 3000, volume: 0.45, seed: 2 };

/** C major arpeggio: root C5 plus two later layers (E5, G5). */
const levelUp: SfxParams = {
  wave: 'triangle',
  freq: 523.25,
  sustain: 0.05,
  decay: 0.2,
  volume: 0.6,
  layers: [{ at: 0.08, freq: 659.26 }, { at: 0.16, freq: 783.99, decay: 0.4 }],
};

export const sfx: Record<string, SfxParams | (() => SfxParams)> = {
  coin: { ...sfxPresets.coin(3), volume: 0.5 },
  jump,
  'level-up': levelUp,
  hit: () => mutateSfx(sfxPresets.hit(2), 0.1, 5),
  click: () => sfxPresets.click(1),
};

export const music: Record<string, SongDef> = {
  menu: defineSong({
    bpm: 100,
    key: 'C major',
    master: { loudness: -22 },
    tracks: {
      lead: { instrument: 'marimba', volume: 0.6, effects: { reverb: 0.2 } },
      chords: { instrument: 'pad', volume: 0.3 },
      bass: { instrument: 'bass', volume: 0.5 },
      kit: { instrument: 'drums', volume: 0.35 },
    },
    sections: {
      A: {
        lead: 'E5 . G5 . C6 - B5 A5 | G5 - E5 - D5 - . . | F5 . A5 . C6 - A5 F5 | G5 - - - . . . . |',
        chords: 'C | Am | F | G |',
        bass: 'C3 . C3 . | A2 . A2 . | F2 . F2 . | G2 . G2 . |',
        kit: 'k h s h k k s h |',
      },
      B: {
        lead: 'A5 - G5 - E5 - C5 - | F5 - E5 - D5 - . . | E5 - C5 - A4 - C5 - | D5 - - - G4 - - - |',
        chords: 'Am | F | C | G |',
        bass: 'A2 . A2 . | F2 . F2 . | C3 . C3 . | G2 . G2 . |',
        kit: 'k h h h s h h h |',
      },
    },
    arrangement: ['A', 'B', 'A'],
  }),
};
```

Sfx rules of thumb: start instantly (no attack on hits), keep UI sounds under 0.1 s and frequent sounds soft
(low `volume`, few highs: `lowpass`), use `slide`/`arp` for "up = good, down = bad", layer a noise transient
(`wave: 'white'`, short decay, `bandpass`) for impact, set `seed` so renders are stable. `volume` is the peak
after normalisation (default 0.8): balance sounds against each other with it.

Music rules: 30-60 s loops, 2+ sections, `loop: true` (default) for seamless tails, `master.loudness` around
-22..-24 so music sits under sfx, chord symbols never with an octave digit (`G7` is a note; write `Gdom7`).
`defineSong` throws with the track and section on any notation error.

## Read the analysis

`pnpm audio` prints one row per sound: `peak`, `loud` (loudest 400 ms), `rms`, `crest`, `clip`, `lead`/`tail`
silence, `bright` (spectral centroid), `zcr`, `on` (onsets), `KB`, `verdict`, plus `key check:` lines for songs
(notes outside `key`). Unchanged sounds show `cached` (`--force` re-renders). The command does not fail on bad
verdicts: read them.

| Verdict | Fix |
|---|---|
| `clipping` / `no headroom` | lower `volume` (sfx) or `master.ceiling` / `master.loudness` (music) |
| `too quiet` / `quiet` | raise `volume`, shorten a long quiet tail, add a brighter layer |
| `dense/loud` (sfx) / `very loud` (music) | lower volume/loudness; music must not dominate sfx |
| `late start` | remove the root voice's `attack`; put a short transient layer at `at: 0` |
| `long silent tail` | shorter `decay`, less `echo`/`reverb` |
| `harsh/bright` | `lowpass`, fewer square/saw/noise highs, lower `freq` |
| `muddy` | `highpass`, raise the pitch, less sub bass |
| `over-compressed` (music) | lower `master.loudness`, fewer simultaneous loud tracks |
| `long for an sfx` | sfx over 3 s belongs in `music` (`loop: false` for jingles) |
| `loop seam jump` | keep `loop: true`; end sections so tails ring into the start |
| key check notes out of key | fix the notes, or correct `key` |

## Play at runtime

```ts
import { createAudioManager, playSound, uiEvents, type Game } from '@engine';
import { music, sfx } from './audio/index';

export function setupAudio(game: Game): void {
  const audio = createAudioManager(game, { library: { sfx, music } });
  void audio.preload();
  uiEvents.on('tap', () => playSound('click'));
}

export function onMerge(level: number, combo: number): void {
  playSound('merge', { rate: 1.25 - level * 0.05 });
  if (combo > 1) playSound('combo', { rate: Math.min(1.5, 1 + 0.08 * (combo - 2)), volume: 0.8 });
}
```

- Call `setupAudio(game)` from the app's `boot()`. Always pass `library`: without it, sounds missing from the
  manifest are silent. Game code plays through the shortcuts `playSound` / `playSong` / `stopSong` /
  `isAudioMuted` / `setAudioMuted` (no-ops when no manager exists); use `getAudioManager()` only for the rest of
  the manager API (volumes, preload).
- `playSfx(name, { volume, rate, pitchJitter, cooldownMs, maxVoices })` returns `null` when skipped (muted,
  hidden, within the 40 ms cooldown, or not loaded: the first call only starts loading). `preload()` at boot
  avoids missing the first play. Max 4 voices per sfx by default (oldest stops).
- `playMusic(name, { fadeMs, volume, restart })` cross-fades (same track again is a no-op); `stopMusic(fadeMs)`.
- Settings: `isMuted/setMuted/toggleMute('master' | 'music' | 'sfx')`, `getVolume/setVolume`, persisted under
  `audio.settings`; `on('settings', ...)` fires on changes. Wire toggles as in `game/scenes/play.ts` `openPause`.
- Web: the AudioContext starts suspended and unlocks on the first tap/click/key, so music requested on the title
  screen becomes audible at the first gesture. Hide/show (app background) pauses and resumes automatically.
- The synth fallback renders at runtime on the main thread (a song takes noticeable time on phones): it is a dev
  convenience. Run `pnpm audio --app <app>` before every build so the MP3s exist.

## Budget

MP3 sizes: sfx mono 64 kbps (about 1-16 KB each), music stereo 128 kbps by default (about 16 KB per second) or
`kbps` on the song (the Suika bgm uses 80 kbps: 44 s = 435 KB). WeChat/Douyin main packages are capped at
4 MB including code and all assets (see the `release-platforms` skill): keep total audio under about 1 MB, one or
two music loops, and prefer shorter loops or lower `kbps` over cutting sfx. `pnpm audio` prints the total.

## Pitfalls

- A name used in `playSfx` but missing from the library/manifest fails silently: keep a contract test.
- Renaming or deleting a sound: run `pnpm audio` without `--only` so stale files are removed from the manifest.
- `rate` changes pitch and length together; keep sounds short and pure (sines/triangles) if they are played at
  many rates. Douyin needs base library 2.33.0+ for playback rate.
- Mini-game backends loop the whole MP3 file; the CLI fades loop edges by 3 ms, so a tiny dip at the seam is
  expected there. Keep `seamJump` low in tests (`< 0.05`).
- Don't call `createAudioManager` per scene: one per game (a second call replaces the first).

Reference (every SfxParams field, notation grammar, instruments, song options, analyzer thresholds):
`references/sfx-and-music.md`.
