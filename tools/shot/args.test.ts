import { describe, expect, it } from 'vitest';
import { defaultApp } from '../common/app';
import { parseParams, parseShotArgs, shotFile, shotUsage, UsageError } from './args';

describe('shot args', () => {
  it('has the same defaults in both tools except the settle time', () => {
    const h = parseShotArgs([], 'shot');
    const b = parseShotArgs([], 'shot:browser');
    expect(h).toMatchObject({ app: defaultApp(), devices: ['iphone-14'], seconds: 0.3, seed: 1, input: 'engine', scale: 'css' });
    expect({ ...b, seconds: 0.3 }).toEqual(h);
    expect(b.seconds).toBe(0.5);
  });

  it('keeps taps, drags and waits in order; targets are selectors or x,y points', () => {
    const a = parseShotArgs(['--tap', '#start', '--wait', '0.5', '--drag', '#a|375,900', '--tap=120.5, 300', '--seconds=1'], 'shot:browser');
    expect(a.actions).toEqual([
      { kind: 'tap', target: '#start' },
      { kind: 'wait', seconds: 0.5 },
      { kind: 'drag', from: '#a', to: { x: 375, y: 900 } },
      { kind: 'tap', target: { x: 120.5, y: 300 } },
    ]);
    expect(a.seconds).toBe(1);
  });

  it('parses devices, flags and tool-specific options', () => {
    const a = parseShotArgs(['--devices', 'iphone-se, ipad', '--dump', '--lint', '--bounds', '--no-insets', '--seed', '7'], 'shot');
    expect(a).toMatchObject({ devices: ['iphone-se', 'ipad'], dump: true, lint: true, bounds: true, insets: false, seed: 7 });
    expect(parseShotArgs(['--device', 'all'], 'shot').devices.length).toBeGreaterThan(3);
    expect(parseShotArgs(['--browser', 'x.exe', '--timeout', '5', '--input', 'mouse'], 'shot:browser')).toMatchObject({
      browser: 'x.exe',
      timeout: 5,
      input: 'mouse',
    });
    expect(parseShotArgs(['--scale', 'device'], 'shot').scale).toBe('device');
    expect(parseShotArgs(['--scale', '2'], 'shot').scale).toBe(2);
  });

  it('rejects unknown options, bad values and options of the other tool', () => {
    const bad: [string[], 'shot' | 'shot:browser', RegExp][] = [
      [['--bogus'], 'shot', /unknown option --bogus/],
      [['--browser', 'x'], 'shot', /only supported by pnpm shot:browser/],
      [['--input', 'mouse'], 'shot', /needs a browser/],
      [['--scale', '2'], 'shot:browser', /css\|device only/],
      [['--wait', 'soon'], 'shot', /expects a number/],
      [['--drag', '#a'], 'shot', /<from>\|<to>/],
      [['--scene'], 'shot', /missing value/],
      [['--out', 'x.png', '--device', 'iphone-se,ipad'], 'shot', /single --device/],
    ];
    for (const [argv, tool, msg] of bad) {
      expect(() => parseShotArgs(argv, tool), argv.join(' ')).toThrow(UsageError);
      expect(() => parseShotArgs(argv, tool), argv.join(' ')).toThrow(msg);
    }
  });

  it('accepts --params without inner quotes (PowerShell 5 strips them)', () => {
    expect(parseParams('{"open":"settings","seed":3}')).toEqual({ open: 'settings', seed: 3 });
    expect(parseParams('{open:settings,seed:3,on:true,list:[1,a]}')).toEqual({ open: 'settings', seed: 3, on: true, list: [1, 'a'] });
    expect(() => parseParams('{open:')).toThrow(UsageError);
  });

  it('names files per tool and lists only the options each tool supports', () => {
    const a = parseShotArgs(['--app', 'sandbox'], 'shot');
    expect(shotFile('shot', a, 'ui-kit', 'ipad')).toBe('.shots/sandbox-ui-kit-ipad.png');
    expect(shotFile('shot:browser', a, 'ui-kit', 'ipad')).toBe('.shots/browser-ui-kit-ipad.png');
    expect(shotFile('shot', parseShotArgs(['--out', 'x.png'], 'shot'), 's', 'd')).toBe('x.png');
    expect(shotUsage('shot')).not.toMatch(/--timeout <seconds>/);
    expect(shotUsage('shot:browser')).toMatch(/--timeout <seconds>/);
    expect(shotUsage('shot')).toMatch(/Only in pnpm shot:browser: --browser, --timeout/);
  });
});
