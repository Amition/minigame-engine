/**
 * Music notation: one compact text line per track and section.
 *
 * Grammar (whitespace separates slots, newlines are whitespace):
 *
 *     pattern := bar ('|' bar)* '|'?
 *     bar     := slot*                       a bar lasts `beatsPerBar` beats, split evenly among its slots
 *                                            (with the `step` option every slot lasts `step` beats instead)
 *                | '%'                       repeat the previous bar
 *     slot    := note | chord | drums | '.' | '-' | group
 *     note    := [A-G] ('#'|'b')? octave mod?      C4 = middle C (MIDI 60), F#3, Bb5
 *     chord   := '[' (note | symbol)+ ']' mod?     explicit chord: [C4 E4 G4]
 *                | symbol mod?                     chord symbol (no octave digit!) voiced from `octave` upward
 *     symbol  := [A-G] ('#'|'b')? quality ('/' [A-G] ('#'|'b')?)?
 *                quality: '' | m | maj7 | m7 | dom7 | maj6 | m6 | dom9 | maj9 | m9 | add9 | madd9 | sus2
 *                         | sus4 | 7sus4 | dim | dim7 | m7b5 | aug | +
 *                e.g. C, Am, F#m7, Gsus4, Bb/D (slash = bass note below the chord).
 *                A letter followed by a digit is always a NOTE: G7 is the note G7 — write Gdom7 for the chord.
 *     drums   := [kshoctlxrbp]+ mod?               drum tracks only; several letters = simultaneous hits
 *                k kick, s snare, h closed hat, o open hat, c clap, t tom, l low tom, x crash, r rim,
 *                b cowbell, p shaker
 *     '.'     := rest                              '-' := hold: extends the previous note by one slot (ties
 *                                                  across bar lines too)
 *     group   := '(' slot+ ')'                     subdivides one slot: C4 (D4 E4) F4 G4 → D4/E4 are halves
 *     mod     := '!' accent (velocity 1) | '?' soft (0.5) | '@0.65' explicit velocity; default 0.8
 *
 * Examples (4/4):
 *
 *     'C5 E5 G5 . | A4 - - . |'            quarter notes; A4 held for three beats
 *     'E5 D5 C5 D5 E5 E5 E5 - |'           eighth notes (8 slots in the bar)
 *     'C | G/B | Am | F Gdom7 |'           one chord symbol per bar, two in the last (use a pad/pluck track)
 *     '[C4 E4 G4] - [B3 D4 G4] - |'        explicit voicings, half notes
 *     'k h s h k k s h |'                  drums, eighths: kick, hat, snare...
 *     'kh h sh h kh kh sh (hh hh) | % |'   combined hits, a 16th-note pair, then repeat the bar
 */

export interface NotationOptions {
  /** Parse drum letters instead of notes. */
  drums?: boolean;
  /** Beats per bar (default 4). */
  beatsPerBar?: number;
  /** Fixed slot length in beats. Default: each bar is split evenly among its slots. */
  step?: number;
  /** Octave of the root for chord symbols (default 4 → C = C4 E4 G4). */
  octave?: number;
}

/** One sounding event. Times in beats from the pattern start. */
export interface NotationEvent {
  start: number;
  dur: number;
  /** MIDI note numbers (empty for drum events). */
  notes: number[];
  /** Drum letters (empty for pitched events). */
  drums: string[];
  velocity: number;
  /** Set when the notes came from a chord symbol (root position; the sequencer may re-voice them). */
  symbol?: { chord: number[]; bass: number | null };
}

export interface ParsedNotation {
  events: NotationEvent[];
  beats: number;
  bars: number;
}

/** Drum letters understood by drum tracks. */
export const DRUM_LETTERS = 'kshoctlxrbp';

const NOTE_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Chord-symbol qualities → semitone intervals above the root. */
export const CHORD_QUALITIES: Record<string, readonly number[]> = {
  '': [0, 4, 7],
  maj: [0, 4, 7],
  M: [0, 4, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  '7': [0, 4, 7, 10],
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  M7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  min7: [0, 3, 7, 10],
  '6': [0, 4, 7, 9],
  maj6: [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '9': [0, 4, 7, 10, 14],
  dom9: [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  sus: [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  aug: [0, 4, 8],
  '+': [0, 4, 8],
};

const NOTE_RE = /^([A-G])(#|b)?(-?\d)$/;
const SYMBOL_RE = /^([A-G])(#|b)?([A-Za-z0-9+#]*?)(?:\/([A-G])(#|b)?)?$/;

/** 'C4' → 60, 'F#3' → 54, 'Bb5' → 82. Returns null for anything else. */
export function noteNameToMidi(name: string): number | null {
  const m = NOTE_RE.exec(name);
  if (!m) return null;
  return 12 * (Number(m[3]) + 1) + NOTE_PC[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** 60 → 'C4'. */
export function midiToNoteName(midi: number): string {
  const m = Math.round(midi);
  return `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

/** Chord symbol → MIDI notes with the root in `octave` ('Am7' → A4 C5 E5 G5). Null if not a chord symbol. */
export function parseChordSymbol(symbol: string, octave = 4): number[] | null {
  const m = SYMBOL_RE.exec(symbol);
  if (!m) return null;
  const intervals = CHORD_QUALITIES[m[3] ?? ''];
  if (!intervals) return null;
  const root = 12 * (octave + 1) + NOTE_PC[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const notes = intervals.map((i) => root + i);
  if (m[4]) {
    let bass = 12 * (octave + 1) + NOTE_PC[m[4]]! + (m[5] === '#' ? 1 : m[5] === 'b' ? -1 : 0);
    while (bass >= root) bass -= 12;
    notes.unshift(bass);
  }
  return notes;
}

type Slot =
  | { k: 'hit'; notes: number[]; drums: string[]; vel: number | null; symbol?: NotationEvent['symbol'] }
  | { k: 'rest' }
  | { k: 'hold' }
  | { k: 'repeat' }
  | { k: 'group'; slots: Slot[] };

const STOP = new Set([' ', '\t', '\n', '\r', '|', '[', ']', '(', ')']);

class NotationReader {
  private i = 0;

  constructor(
    private readonly src: string,
    private readonly drums: boolean,
    private readonly octave: number,
  ) {}

  fail(msg: string): never {
    const a = Math.max(0, this.i - 12);
    const near = this.src.slice(a, this.i + 12).replace(/\s+/g, ' ');
    throw new Error(`notation: ${msg} (at char ${this.i}, near "${near}")`);
  }

  private skipWs(): void {
    while (this.i < this.src.length && /\s/.test(this.src[this.i]!)) this.i++;
  }

  bars(): Slot[][] {
    const bars: Slot[][] = [];
    let cur: Slot[] = [];
    let open = false;
    for (;;) {
      this.skipWs();
      if (this.i >= this.src.length) break;
      if (this.src[this.i] === '|') {
        this.i++;
        bars.push(cur);
        cur = [];
        open = false;
        continue;
      }
      cur.push(this.slot());
      open = true;
    }
    if (open) bars.push(cur);
    return bars;
  }

  private slot(): Slot {
    const c = this.src[this.i]!;
    if (c === '[') {
      this.i++;
      const notes: number[] = [];
      const drums: string[] = [];
      let vel: number | null = null;
      for (;;) {
        this.skipWs();
        if (this.i >= this.src.length) this.fail("missing ']'");
        if (this.src[this.i] === ']') {
          this.i++;
          break;
        }
        const s = this.word();
        if (s.k !== 'hit') this.fail('only notes, chord symbols or drum letters may appear inside [ ]');
        notes.push(...s.notes);
        drums.push(...s.drums);
        if (s.vel !== null) vel = Math.max(vel ?? 0, s.vel);
      }
      if (notes.length + drums.length === 0) this.fail('empty chord [ ]');
      const mod = this.readWord();
      if (mod) vel = this.modifier(mod) ?? this.fail(`unexpected "${mod}" after ]`);
      return { k: 'hit', notes: [...new Set(notes)], drums: [...new Set(drums)], vel };
    }
    if (c === '(') {
      this.i++;
      const slots: Slot[] = [];
      for (;;) {
        this.skipWs();
        if (this.i >= this.src.length) this.fail("missing ')'");
        if (this.src[this.i] === ')') {
          this.i++;
          break;
        }
        if (this.src[this.i] === '|') this.fail("bar line '|' inside ( )");
        const s = this.slot();
        if (s.k === 'repeat') this.fail("'%' inside ( )");
        slots.push(s);
      }
      if (slots.length === 0) this.fail('empty group ( )');
      return { k: 'group', slots };
    }
    if (c === ']' || c === ')') this.fail(`unexpected '${c}'`);
    return this.word();
  }

  private readWord(): string {
    const start = this.i;
    while (this.i < this.src.length && !STOP.has(this.src[this.i]!)) this.i++;
    return this.src.slice(start, this.i);
  }

  private modifier(mod: string): number | null {
    if (mod === '!') return 1;
    if (mod === '?') return 0.5;
    const m = /^@(\d*\.?\d+)$/.exec(mod);
    return m ? Math.min(1, Math.max(0, Number(m[1]))) : null;
  }

  private word(): Slot {
    const raw = this.readWord();
    if (raw === '.') return { k: 'rest' };
    if (raw === '-') return { k: 'hold' };
    if (raw === '%') return { k: 'repeat' };
    let body = raw;
    let vel: number | null = null;
    const m = /(!|\?|@\d*\.?\d+)$/.exec(body);
    if (m && m.index > 0) {
      vel = this.modifier(m[1]!);
      body = body.slice(0, m.index);
    }
    if (this.drums) {
      if (!/^[a-z]+$/.test(body) || [...body].some((ch) => !DRUM_LETTERS.includes(ch))) {
        this.fail(`"${raw}" is not a drum hit (letters: ${DRUM_LETTERS.split('').join(' ')}, '.', '-')`);
      }
      return { k: 'hit', notes: [], drums: [...new Set(body)], vel };
    }
    const midi = noteNameToMidi(body);
    if (midi !== null) return { k: 'hit', notes: [midi], drums: [], vel };
    const chord = parseChordSymbol(body, this.octave);
    if (chord) {
      const slash = body.includes('/');
      return {
        k: 'hit',
        notes: chord,
        drums: [],
        vel,
        symbol: { chord: slash ? chord.slice(1) : chord, bass: slash ? chord[0]! : null },
      };
    }
    return this.fail(`"${raw}" is not a note (C4, F#3, Bb5), chord symbol (Am7, G/B), '.', '-' or '%'`);
  }
}

/** Parses one track pattern. Throws with the position and a hint on syntax errors. */
export function parseMusicNotation(text: string, opts: NotationOptions = {}): ParsedNotation {
  const bpb = opts.beatsPerBar ?? 4;
  const reader = new NotationReader(text, opts.drums ?? false, opts.octave ?? 4);
  const rawBars = reader.bars();
  const bars: Slot[][] = [];
  for (const b of rawBars) {
    if (b.length === 1 && b[0]!.k === 'repeat') {
      if (bars.length === 0) reader.fail("'%' needs a previous bar");
      bars.push(bars[bars.length - 1]!);
    } else if (b.some((s) => s.k === 'repeat')) {
      reader.fail("'%' must be alone in its bar");
    } else bars.push(b);
  }
  const events: NotationEvent[] = [];
  let last: NotationEvent | null = null;
  const place = (slot: Slot, start: number, dur: number): void => {
    switch (slot.k) {
      case 'hit':
        last = { start, dur, notes: slot.notes, drums: slot.drums, velocity: slot.vel ?? 0.8 };
        if (slot.symbol) last.symbol = slot.symbol;
        events.push(last);
        break;
      case 'rest':
        last = null;
        break;
      case 'hold':
        if (last && Math.abs(last.start + last.dur - start) < 1e-9) last.dur += dur;
        break;
      case 'group': {
        const d = dur / slot.slots.length;
        slot.slots.forEach((s, j) => place(s, start + j * d, d));
        break;
      }
      case 'repeat':
        break;
    }
  };
  let t = 0;
  for (const bar of bars) {
    if (bar.length === 0) {
      last = null;
      t += opts.step ? opts.step : bpb;
      continue;
    }
    const barBeats = opts.step ? opts.step * bar.length : bpb;
    const d = barBeats / bar.length;
    bar.forEach((s, j) => place(s, t + j * d, d));
    t += barBeats;
  }
  return { events, beats: t, bars: opts.step ? Math.ceil(t / bpb - 1e-9) : bars.length };
}
