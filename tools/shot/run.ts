/**
 * Headless screenshot + tree dump of an app scene (no browser needed).
 *
 *   pnpm shot --scene basics                       -> .shots/sandbox-basics-iphone-14.png
 *   pnpm shot --app sandbox --scene ui-kit --device iphone-se,ipad --dump
 *   pnpm shot --scene basics --tap "#counter" --tap "#counter" --seconds 0.5 --out .shots/x.png
 *
 * Options:
 *   --app <dir>        app directory containing main.ts (default: sandbox)
 *   --scene <name>     scene to open (default: the app's start scene)
 *   --params <json>    params passed to the scene
 *   --device <list>    comma list of device names or WxH@dpr (default: iphone-14); 'all' = every profile
 *   --tap <selector>   tap a node (repeatable, in order); --drag "<from>|<to>" also allowed
 *   --wait <seconds>   advance time between actions (e.g. let a scene transition finish)
 *   --seconds <n>      simulated time to advance after setup/taps (default 0.3)
 *   --scale <n>        PNG scale relative to CSS px (default 1)
 *   --out <file>       output path (only with a single device)
 *   --dump             print the stage tree
 *   --lint             print the UI lint report; exit code 1 if any device has lint errors
 *   --bounds           also write <file>-bounds.png with the drawUIBounds overlay (hit areas, text, issues)
 *   --seed <n>         rng seed (default 1)
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { drawUIBounds, formatLint, lintUI, type AppDef } from '@engine';
import { createTestGame, devices } from '@engine/testing';

interface Args {
  app: string;
  scene?: string;
  params?: unknown;
  devices: string[];
  actions: { kind: 'tap' | 'drag' | 'wait'; value: string }[];
  seconds: number;
  scale: number;
  out?: string;
  dump: boolean;
  lint: boolean;
  bounds: boolean;
  seed: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    app: 'sandbox',
    devices: ['iphone-14'],
    actions: [],
    seconds: 0.3,
    scale: 1,
    dump: false,
    lint: false,
    bounds: false,
    seed: 1,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    const v = () => {
      const val = argv[++i];
      if (val === undefined) throw new Error(`missing value for ${k}`);
      return val;
    };
    switch (k) {
      case '--app':
        a.app = v();
        break;
      case '--scene':
        a.scene = v();
        break;
      case '--params':
        a.params = JSON.parse(v());
        break;
      case '--device':
      case '--devices': {
        const d = v();
        a.devices = d === 'all' ? Object.keys(devices) : d.split(',');
        break;
      }
      case '--tap':
        a.actions.push({ kind: 'tap', value: v() });
        break;
      case '--drag':
        a.actions.push({ kind: 'drag', value: v() });
        break;
      case '--wait':
        a.actions.push({ kind: 'wait', value: v() });
        break;
      case '--seconds':
        a.seconds = +v();
        break;
      case '--scale':
        a.scale = +v();
        break;
      case '--out':
        a.out = v();
        break;
      case '--dump':
        a.dump = true;
        break;
      case '--lint':
        a.lint = true;
        break;
      case '--bounds':
        a.bounds = true;
        break;
      case '--seed':
        a.seed = +v();
        break;
      default:
        throw new Error(`unknown option ${k}`);
    }
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const appDir = resolve(args.app);
  const mainFile = resolve(appDir, 'main.ts');
  if (!existsSync(mainFile)) throw new Error(`no main.ts in ${appDir}`);
  const app = (await import(pathToFileURL(mainFile).href)).default as AppDef;
  let lintErrors = 0;
  for (const device of args.devices) {
    const t = await createTestGame({
      app,
      device,
      assetsDir: resolve(appDir, 'assets'),
      seed: args.seed,
      ...(args.scene ? { scene: args.scene } : {}),
      ...(args.params !== undefined ? { params: args.params } : {}),
    });
    for (const act of args.actions) {
      if (act.kind === 'tap') await t.tap(act.value);
      else if (act.kind === 'wait') await t.advance(+act.value);
      else {
        const [from, to] = act.value.split('|');
        if (!from || !to) throw new Error('--drag expects "<from>|<to>"');
        await t.drag(from, to);
      }
    }
    await t.advance(args.seconds);
    const sceneName = t.scene?.sceneName ?? 'none';
    const file =
      args.out && args.devices.length === 1
        ? args.out
        : `.shots/${args.app.replace(/[\\/]/g, '_')}-${sceneName}-${device}.png`;
    const path = await t.screenshot(file, { scale: args.scale });
    console.log(`shot: ${path}  (scene=${sceneName}, device=${device}, view=${Math.round(t.game.view.width)}x${Math.round(t.game.view.height)})`);
    if (args.bounds) {
      const boundsFile = file.replace(/(\.png)?$/i, '-bounds.png');
      const g = t.game;
      console.log(`bounds: ${await t.screenshot(boundsFile, { scale: args.scale, overlay: (ctx) => drawUIBounds(ctx, g.stage, { game: g }) })}`);
    }
    if (args.dump) console.log(t.dump());
    if (args.lint) {
      const issues = lintUI(t.game.stage, t.game);
      lintErrors += issues.filter((i) => i.severity === 'error').length;
      console.log(`[${device}] ${formatLint(issues)}`);
    }
    t.destroy();
  }
  if (lintErrors > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
