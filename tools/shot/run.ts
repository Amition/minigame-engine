/**
 * Headless screenshot + tree dump / UI lint of an app scene (no browser needed). Same options as
 * `pnpm shot:browser` (tools/shot/args.ts); `pnpm shot --help` prints them all.
 *
 *   pnpm shot --scene play                                 -> .shots/<app>-play-iphone-14.png (app: package.json engine.app)
 *   pnpm shot --app sandbox --scene ui-kit --device iphone-se,ipad --dump
 *   pnpm shot --scene basics --tap "#counter" --tap 375,900 --wait 0.5 --out .shots/x.png
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { drawUIBounds, formatLint, lintUI, type AppDef } from '@engine';
import { createTestGame, resolveDevice } from '@engine/testing';
import { ActionError, describeAction, exitOnError, shotArgsOrExit, shotFile } from './args';

async function main() {
  const args = shotArgsOrExit(process.argv.slice(2), 'shot');
  const appDir = resolve(args.app);
  const mainFile = resolve(appDir, 'main.ts');
  if (!existsSync(mainFile)) throw new Error(`no main.ts in ${appDir} (--app must point at an app directory)`);
  const app = (await import(pathToFileURL(mainFile).href)).default as AppDef;
  let lintErrors = 0;
  for (const device of args.devices) {
    const spec = resolveDevice(device);
    const t = await createTestGame({
      app,
      device: args.insets ? spec : { ...spec, safeInsets: { top: 0, right: 0, bottom: 0, left: 0 } },
      assetsDir: resolve(appDir, 'assets'),
      seed: args.seed,
      ...(args.scene ? { scene: args.scene } : {}),
      ...(args.params !== undefined ? { params: args.params } : {}),
    });
    for (const act of args.actions) {
      try {
        if (act.kind === 'tap') await t.tap(act.target);
        else if (act.kind === 'wait') await t.advance(act.seconds);
        else await t.drag(act.from, act.to);
      } catch (e) {
        throw new ActionError(`${describeAction(act)} failed on ${device}: ${e instanceof Error ? e.message : e}`);
      }
    }
    await t.advance(args.seconds);
    const sceneName = t.scene?.sceneName ?? 'none';
    const file = shotFile('shot', args, sceneName, device);
    const scale = args.scale === 'css' ? 1 : args.scale === 'device' ? t.game.pixelRatio : args.scale;
    const path = await t.screenshot(file, { scale });
    console.log(`shot: ${path}  (scene=${sceneName}, device=${device}, view=${Math.round(t.game.view.width)}x${Math.round(t.game.view.height)})`);
    if (args.bounds) {
      const boundsFile = file.replace(/(\.png)?$/i, '-bounds.png');
      const g = t.game;
      console.log(`bounds: ${await t.screenshot(boundsFile, { scale, overlay: (ctx) => drawUIBounds(ctx, g.stage, { game: g }) })}`);
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

main().catch(exitOnError);
