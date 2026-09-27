// Shared command line of `pnpm shot` (headless, run.ts) and `pnpm shot:browser` (real browser, browser.ts):
// same options, same defaults where both can support them, one usage text generated from OPTIONS.
import { basename, resolve } from 'node:path';
import { defaultDevice, devices, devicesFor } from '../../engine/testing/devices';
import { readAppMeta } from '../build/config';
import { defaultApp } from '../common/app';

export type ShotTool = 'shot' | 'shot:browser';

/** A tap/drag target: a node selector, or a stage point "x,y" in design units. */
export type ShotTarget = string | { x: number; y: number };

export type ShotAction =
  | { kind: 'tap'; target: ShotTarget }
  | { kind: 'drag'; from: ShotTarget; to: ShotTarget }
  | { kind: 'wait'; seconds: number };

export interface ShotArgs {
  app: string;
  scene?: string;
  params?: unknown;
  devices: string[];
  /** Taps, drags and waits in command-line order. */
  actions: ShotAction[];
  /** Time to let run after the actions, before the shot. */
  seconds: number;
  seed: number;
  input: 'engine' | 'touch' | 'mouse';
  out?: string;
  /** 'css' = CSS px (default), 'device' = backing pixels, or a factor relative to CSS px (headless only). */
  scale: 'css' | 'device' | number;
  dump: boolean;
  lint: boolean;
  bounds: boolean;
  insets: boolean;
  browser?: string;
  timeout: number;
  help: boolean;
}

interface OptionDef {
  flag: string;
  arg?: string;
  /** Tools that accept it (default both). */
  only?: ShotTool;
  help: string;
  apply(a: ShotArgs, value: string, tool: ShotTool): void;
}

/** Bad command line: the CLI prints the usage and exits 1. */
export class UsageError extends Error {}

/** A --tap/--drag that could not run (e.g. no node matches): printed without a stack trace, exit 1. */
export class ActionError extends Error {}

export function describeAction(act: ShotAction): string {
  if (act.kind === 'wait') return `--wait ${act.seconds}`;
  if (act.kind === 'tap') return `--tap ${formatTarget(act.target)}`;
  return `--drag ${formatTarget(act.from)}|${formatTarget(act.to)}`;
}

/** Top-level catch of the shot CLIs: stack traces only for real crashes. */
export function exitOnError(e: unknown): never {
  console.error(e instanceof ActionError ? `error: ${e.message}` : e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
}

const POINT = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

export function parseTarget(s: string): ShotTarget {
  const m = POINT.exec(s);
  return m ? { x: +m[1]!, y: +m[2]! } : s;
}

export function formatTarget(t: ShotTarget): string {
  return typeof t === 'string' ? t : `${t.x},${t.y}`;
}

/**
 * JSON, or the same with the double quotes missing (`{open:settings,seed:3}`): PowerShell 5 strips inner double
 * quotes from arguments of native commands, so `--params '{"open":"settings"}'` arrives without them.
 */
export function parseParams(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    const tokens = v.match(/"(?:[^"\\]|\\.)*"|[{}[\]:,]|[^{}[\]:,"]+/g) ?? [];
    const json = tokens
      .map((tok) => {
        const s = tok.trim();
        if (s === '' || tok.startsWith('"') || /^[{}[\]:,]$/.test(s)) return tok;
        if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s) || s === 'true' || s === 'false' || s === 'null') return s;
        return JSON.stringify(s);
      })
      .join('');
    try {
      return JSON.parse(json);
    } catch {
      throw new UsageError(`--params is not valid JSON: ${v}`);
    }
  }
}

function num(flag: string, v: string): number {
  const n = Number(v);
  if (v.trim() === '' || !Number.isFinite(n)) throw new UsageError(`${flag} expects a number, got "${v}"`);
  return n;
}

const OPTIONS: OptionDef[] = [
  {
    flag: '--app',
    arg: '<dir>',
    help: `app directory with main.ts (default: package.json "engine.app" = ${defaultApp()})`,
    apply: (a, v) => (a.app = v),
  },
  { flag: '--scene', arg: '<name>', help: "scene to open (default: the app's start scene)", apply: (a, v) => (a.scene = v) },
  {
    flag: '--params',
    arg: '<json>',
    help: 'params passed to the scene as JSON, e.g. \'{"seed":3}\' (unquoted {open:settings} works too: PowerShell 5 strips inner quotes)',
    apply: (a, v) => (a.params = parseParams(v)),
  },
  {
    flag: '--device',
    arg: '<list>',
    help:
      `comma list of ${Object.keys(devices).join(', ')} or WxH@dpr; 'all' = every profile of the app's orientation ` +
      "(app.json; default iphone-14, or iphone-14-land for landscape apps)",
    apply: (a, v) => (a.devices = v === 'all' ? ['all'] : v.split(',').map((d) => d.trim()).filter(Boolean)),
  },
  {
    flag: '--tap',
    arg: '<target>',
    help: 'tap a node selector or a stage point "x,y" (design units); repeatable, runs in order',
    apply: (a, v) => a.actions.push({ kind: 'tap', target: parseTarget(v) }),
  },
  {
    flag: '--drag',
    arg: '"<from>|<to>"',
    help: 'drag between two targets (selectors or "x,y"), in order with --tap/--wait',
    apply: (a, v) => {
      const [from, to, extra] = v.split('|');
      if (!from || !to || extra !== undefined) throw new UsageError(`--drag expects "<from>|<to>", got "${v}"`);
      a.actions.push({ kind: 'drag', from: parseTarget(from), to: parseTarget(to) });
    },
  },
  {
    flag: '--wait',
    arg: '<seconds>',
    help: 'let time pass between actions (scene transitions, animations); headless = simulated, browser = real time',
    apply: (a, v) => a.actions.push({ kind: 'wait', seconds: num('--wait', v) }),
  },
  {
    flag: '--seconds',
    arg: '<n>',
    help: 'time to let run after the actions, before the shot (default 0.3 headless, 0.5 browser)',
    apply: (a, v) => (a.seconds = num('--seconds', v)),
  },
  { flag: '--seed', arg: '<n>', help: 'rng seed (default 1)', apply: (a, v) => (a.seed = num('--seed', v)) },
  {
    flag: '--input',
    arg: 'engine|touch|mouse',
    help:
      'how taps/drags are delivered (default engine). Browser: engine = injected into the platform, touch = real CDP ' +
      'touch events, mouse = real mouse (DOM input path). Headless: engine and touch are the same raw touches; no mouse',
    apply: (a, v, tool) => {
      if (v !== 'engine' && v !== 'touch' && v !== 'mouse') throw new UsageError(`--input must be engine|touch|mouse, got "${v}"`);
      if (v === 'mouse' && tool === 'shot') throw new UsageError('--input mouse needs a browser: use pnpm shot:browser');
      a.input = v;
    },
  },
  {
    flag: '--out',
    arg: '<file>',
    help: 'output path (single device only; default .shots/<app>-<scene>-<device>.png, browser: .shots/browser-<scene>-<device>.png)',
    apply: (a, v) => (a.out = v),
  },
  {
    flag: '--scale',
    arg: 'css|device|<n>',
    help: 'PNG size: css = CSS px (default, same size in both tools), device = backing pixels, <n> = factor (headless)',
    apply: (a, v, tool) => {
      if (v === 'css' || v === 'device') a.scale = v;
      else {
        const n = num('--scale', v);
        if (n <= 0) throw new UsageError('--scale must be > 0');
        if (tool === 'shot:browser' && n !== 1) throw new UsageError('pnpm shot:browser supports --scale css|device only');
        a.scale = n === 1 ? 'css' : n;
      }
    },
  },
  { flag: '--dump', help: 'print the node tree', apply: (a) => (a.dump = true) },
  { flag: '--lint', help: 'print the UI lint report; exit code 1 if any device has lint errors', apply: (a) => (a.lint = true) },
  {
    flag: '--bounds',
    help: 'also write <file>-bounds.png with hit areas, text boxes and lint issues drawn on top',
    apply: (a) => (a.bounds = true),
  },
  { flag: '--no-insets', help: "ignore the device's safe-area insets (notch, home bar)", apply: (a) => (a.insets = false) },
  {
    flag: '--browser',
    arg: '<exe>',
    only: 'shot:browser',
    help: 'browser executable (default: CHROME_PATH, system Chrome, then Edge)',
    apply: (a, v) => (a.browser = v),
  },
  {
    flag: '--timeout',
    arg: '<seconds>',
    only: 'shot:browser',
    help: 'max wait for the page to boot (default 20)',
    apply: (a, v) => (a.timeout = num('--timeout', v)),
  },
  { flag: '--help', help: 'print this help', apply: (a) => (a.help = true) },
];

const ALIASES: Record<string, string> = { '--devices': '--device', '-h': '--help' };

export function defaultShotArgs(tool: ShotTool): ShotArgs {
  return {
    app: defaultApp(),
    devices: ['iphone-14'],
    actions: [],
    seconds: tool === 'shot' ? 0.3 : 0.5,
    seed: 1,
    input: 'engine',
    scale: 'css',
    dump: false,
    lint: false,
    bounds: false,
    insets: true,
    timeout: 20,
    help: false,
  };
}

/** Parses argv (without node/script). Throws UsageError on unknown options or bad values. */
export function parseShotArgs(argv: readonly string[], tool: ShotTool): ShotArgs {
  const a = defaultShotArgs(tool);
  let devicesGiven = false;
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]!;
    if (raw === '--' && i === 0) continue;
    const eq = raw.startsWith('--') ? raw.indexOf('=') : -1;
    const name = ALIASES[eq > 0 ? raw.slice(0, eq) : raw] ?? (eq > 0 ? raw.slice(0, eq) : raw);
    const def = OPTIONS.find((o) => o.flag === name);
    if (!def) throw new UsageError(`unknown option ${raw}`);
    if (def.only && def.only !== tool) throw new UsageError(`${def.flag} is only supported by pnpm ${def.only}`);
    let value = '';
    if (def.arg) {
      if (eq > 0) value = raw.slice(eq + 1);
      else {
        const next = argv[++i];
        if (next === undefined) throw new UsageError(`missing value for ${def.flag}`);
        value = next;
      }
    } else if (eq > 0) throw new UsageError(`${def.flag} takes no value`);
    def.apply(a, value, tool);
    if (def.flag === '--device') devicesGiven = true;
  }
  const orientation = readAppMeta(resolve(a.app)).orientation;
  if (!devicesGiven) a.devices = [defaultDevice(orientation)];
  else if (a.devices.includes('all')) a.devices = devicesFor(orientation);
  if (a.out && a.devices.length > 1) throw new UsageError('--out needs a single --device');
  return a;
}

/** Full usage text for one tool. */
export function shotUsage(tool: ShotTool): string {
  const head =
    tool === 'shot'
      ? [
          'pnpm shot: headless screenshot + tree dump / UI lint of an app scene (no browser).',
          '',
          '  pnpm shot --scene play                                 -> .shots/<app>-play-iphone-14.png',
          '  pnpm shot --app sandbox --scene ui-kit --device iphone-se,iphone-14,ipad --lint --bounds',
          '  pnpm shot --scene play --tap 375,900 --wait 1 --tap "#pause" --dump',
        ]
      : [
          'pnpm shot:browser: screenshot of an app scene in real Chrome (fallback Edge) with mobile emulation,',
          'through a web --dev build. Prints page console errors; exits 1 when there were any.',
          '',
          '  pnpm shot:browser --scene play                         -> .shots/browser-play-iphone-14.png',
          '  pnpm shot:browser --app sandbox --scene ui-kit --wait 0.5 --tap "#go" --input touch --lint',
        ];
  const rows = OPTIONS.filter((o) => !o.only || o.only === tool).map((o) => [`${o.flag}${o.arg ? ` ${o.arg}` : ''}`, o.help]);
  const w = Math.max(...rows.map((r) => r[0]!.length));
  const other = OPTIONS.filter((o) => o.only && o.only !== tool).map((o) => o.flag);
  const wrap = (text: string, width: number): string[] => {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
      if (line && line.length + 1 + word.length > width) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    return [...lines, line];
  };
  return [
    ...head,
    '',
    'Options:',
    ...rows.flatMap(([k, h]) => wrap(h!, Math.max(40, 116 - w)).map((l, i) => `  ${(i ? '' : k!).padEnd(w)}  ${l}`)),
    ...(other.length ? ['', `Only in pnpm ${tool === 'shot' ? 'shot:browser' : 'shot'}: ${other.join(', ')}`] : []),
  ].join('\n');
}

/** parseShotArgs for a CLI: prints the usage and exits (0 for --help, 1 on errors). */
export function shotArgsOrExit(argv: readonly string[], tool: ShotTool): ShotArgs {
  try {
    const a = parseShotArgs(argv, tool);
    if (a.help) {
      console.log(shotUsage(tool));
      process.exit(0);
    }
    return a;
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`${shotUsage(tool)}\n\nerror: ${e.message}`);
    process.exit(1);
  }
}

/** Default output path of one shot. */
export function shotFile(tool: ShotTool, a: ShotArgs, scene: string, device: string): string {
  if (a.out && a.devices.length === 1) return a.out;
  return tool === 'shot' ? `.shots/${basename(resolve(a.app))}-${scene}-${device}.png` : `.shots/browser-${scene}-${device}.png`;
}
