/** Parsed character grid: `cells[y * cols + x]`. */
export interface AsciiGrid<T> {
  cols: number;
  rows: number;
  cells: T[];
}

/**
 * Splits map text into rows. Arrays are used verbatim; a string is split on newlines, blank first/last lines are
 * dropped and the common indentation removed, so template literals can be indented with the code.
 */
export function asciiRows(src: string | readonly string[]): string[] {
  if (typeof src !== 'string') return src.slice();
  const lines = src.replace(/\r/g, '').split('\n');
  while (lines.length && lines[0]!.trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();
  let indent = Infinity;
  for (const l of lines) {
    if (l.trim() === '') continue;
    indent = Math.min(indent, l.length - l.trimStart().length);
  }
  if (!Number.isFinite(indent) || indent === 0) return lines;
  return lines.map((l) => l.slice(indent));
}

/**
 * Maps every character through `legend`. Short rows are padded with `fill` (required when rows differ in length).
 * Unknown characters throw with their row/column so map typos are easy to find.
 *
 *     parseAsciiGrid(['#..#', '#P.#'], { '#': 1, '.': 0, P: 0 })  // → { cols: 4, rows: 2, cells: [...] }
 */
export function parseAsciiGrid<T>(src: string | readonly string[], legend: Readonly<Record<string, T>>, fill?: T): AsciiGrid<T> {
  const rows = asciiRows(src).map((r) => [...r]);
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const cells: T[] = new Array(cols * rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < cols; x++) {
      const ch = row[x];
      let v: T | undefined;
      if (ch === undefined) {
        if (fill === undefined) throw new Error(`ascii map: row ${y} is shorter (${row.length}) than ${cols} and no fill given`);
        v = fill;
      } else {
        v = legend[ch];
        if (v === undefined) {
          const known = Object.keys(legend).map((k) => JSON.stringify(k)).join(' ');
          throw new Error(`ascii map: unknown char ${JSON.stringify(ch)} at row ${y}, col ${x} (legend: ${known})`);
        }
      }
      cells[y * cols + x] = v;
    }
  });
  return { cols, rows: rows.length, cells };
}
