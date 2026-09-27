import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTargets, type BuildResult } from './build';
import { findNodeImports, ROOT } from './config';

let out = '';
let web: BuildResult;
let wx: BuildResult;

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'engine-build-test-'));
  [web, wx] = (await buildTargets(['web', 'wx'], { app: join(ROOT, 'sandbox'), out, log: () => {} })) as [BuildResult, BuildResult];
}, 120_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

function assertPortable(code: string): void {
  expect(findNodeImports(code)).toEqual([]);
  expect(code).not.toMatch(/["'`]node:/);
  expect(code).not.toContain('@napi-rs');
  expect(code).not.toMatch(/(^|[^\w$.])require\s*\(/m);
}

describe('build', () => {
  it('builds the sandbox for the web', () => {
    expect(web.problems).toEqual([]);
    expect(web.ok).toBe(true);
    for (const f of ['index.html', 'game.js']) expect(existsSync(join(web.dir, f)), f).toBe(true);
    expect(existsSync(join(web.dir, 'game.js.map'))).toBe(false);
    const html = readFileSync(join(web.dir, 'index.html'), 'utf8');
    expect(html).toContain('<script src="game.js"></script>');
    expect(html).toContain('Engine Sandbox');
    expect(html).not.toContain('__reload');
    assertPortable(readFileSync(join(web.dir, 'game.js'), 'utf8'));
  });

  it('builds the sandbox for WeChat', () => {
    expect(wx.problems).toEqual([]);
    expect(wx.ok).toBe(true);
    for (const f of ['game.js', 'game.json', 'project.config.json']) expect(existsSync(join(wx.dir, f)), f).toBe(true);
    const game = JSON.parse(readFileSync(join(wx.dir, 'game.json'), 'utf8'));
    expect(game.deviceOrientation).toBe('portrait');
    const project = JSON.parse(readFileSync(join(wx.dir, 'project.config.json'), 'utf8'));
    expect(project).toMatchObject({ compileType: 'game', appid: 'touristappid', projectname: 'Engine Sandbox' });
    const code = readFileSync(join(wx.dir, 'game.js'), 'utf8');
    assertPortable(code);
    expect(code).toContain('createWxPlatform');
    expect(code).not.toMatch(/\bdocument\.|\bwindow\./);
    expect(wx.size!.total).toBeLessThan(wx.limit!);
  });

  it('flags node imports in bundles', () => {
    expect(findNodeImports('import("node:fs")')).toHaveLength(1);
    expect(findNodeImports('var x = require("fs");')).toHaveLength(1);
    expect(findNodeImports('var x = __require("fs");')).toHaveLength(1);
    expect(findNodeImports('const s = "node: text"; obj.require("x"); t.node = 1;')).toEqual([]);
  });
});

/** Minimal `wx` global over @napi-rs/canvas: enough for the sandbox to boot and draw its home scene. */
function fakeWx(width: number, height: number) {
  const canvases: Canvas[] = [];
  const touchStart: ((e: unknown) => void)[] = [];
  const api = {
    createCanvas: () => {
      const c = createCanvas(width, height);
      canvases.push(c);
      return c;
    },
    getWindowInfo: () => ({
      pixelRatio: 2,
      screenWidth: width,
      screenHeight: height,
      windowWidth: width,
      windowHeight: height,
      statusBarHeight: 20,
      safeArea: { left: 0, right: width, top: 20, bottom: height, width, height: height - 20 },
    }),
    getPerformance: () => ({ now: () => performance.now() * 1000 }),
    onTouchStart: (cb: (e: unknown) => void) => touchStart.push(cb),
    getStorageSync: () => '',
    setStorageSync: () => {},
    getStorageInfoSync: () => ({ keys: [] }),
  };
  return { api, canvases, touchStart };
}

describe('wx bundle', () => {
  it('boots the sandbox in a wx-like runtime and draws a frame', async () => {
    const code = readFileSync(join(wx.dir, 'game.js'), 'utf8');
    const { api, canvases, touchStart } = fakeWx(375, 667);
    const errors: string[] = [];
    let frames: (() => void)[] = [];
    const context = vm.createContext({
      wx: api,
      console: {
        log: () => {},
        info: () => {},
        warn: () => {},
        error: (...a: unknown[]) => errors.push(a.map(String).join(' ')),
      },
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (cb: () => void) => frames.push(cb),
      cancelAnimationFrame: () => {},
    });
    vm.runInContext(code, context, { filename: 'game.js' });
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 5));
      const run = frames;
      frames = [];
      for (const f of run) f();
    }
    expect(errors).toEqual([]);
    expect(touchStart).toHaveLength(1);
    const screen = canvases[0]!;
    expect(screen.width).toBe(750);
    const { data } = screen.getContext('2d').getImageData(0, 0, screen.width, screen.height);
    const colors = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 97) colors.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
    expect(colors.size).toBeGreaterThan(8);
  });
});
