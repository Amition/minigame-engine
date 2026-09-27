import { afterEach, describe, expect, it } from 'vitest';
import {
  Box,
  createInputActions,
  gamepadInput,
  inputCodeLabel,
  keyboardInput,
  Scene,
  type Label,
  VirtualJoystick,
  type Platform,
  type PlatformGamepad,
  type PlatformKeyEvent,
} from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';
import sandbox from '../sandbox/main';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

const MAP = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  jump: ['Space', 'ArrowUp', 'KeyW'],
};

describe('keyboardInput', () => {
  it('reports frame-based edges for injected keys', async () => {
    t = await createTestGame();
    const kb = keyboardInput(t.game);
    expect(kb.supported).toBe(true);
    t.platform.key('Space', 'down');
    expect(kb.isDown('Space')).toBe(true);
    expect(kb.justPressed('Space')).toBe(false);
    await t.step();
    expect(kb.justPressed('Space')).toBe(true);
    await t.step();
    expect(kb.justPressed('Space')).toBe(false);
    expect(kb.isDown('Space')).toBe(true);
    t.platform.key('Space', 'up');
    await t.step();
    expect(kb.isDown('Space')).toBe(false);
    expect(kb.justReleased('Space')).toBe(true);
    await t.step();
    expect(kb.justReleased('Space')).toBe(false);
  });

  it('keeps a press and release between two frames as both edges', async () => {
    t = await createTestGame();
    const kb = keyboardInput(t.game);
    t.platform.key('KeyZ', 'down');
    t.platform.key('KeyZ', 'up');
    await t.step();
    expect(kb.justPressed('KeyZ')).toBe(true);
    expect(kb.justReleased('KeyZ')).toBe(true);
    expect(kb.isDown('KeyZ')).toBe(false);
  });

  it('marks repeats, fires onPress once and emits raw events', async () => {
    t = await createTestGame();
    const kb = keyboardInput(t.game);
    const raw: PlatformKeyEvent[] = [];
    const presses: string[] = [];
    kb.on('keydown', (e) => raw.push(e));
    kb.onPress(['KeyA', 'KeyB'], (e) => presses.push(e.code));
    kb.onPress('*', (e) => presses.push(`any:${e.code}`));
    t.platform.key('KeyA');
    t.platform.key('KeyA');
    t.platform.key('KeyC');
    expect(raw.map((e) => `${e.code}:${e.key}:${e.repeat}`)).toEqual(['KeyA:a:false', 'KeyA:a:true', 'KeyC:c:false']);
    expect(presses).toEqual(['KeyA', 'any:KeyA', 'any:KeyC']);
    expect(kb.downCodes()).toEqual(['KeyA', 'KeyC']);
  });

  it('releases held keys when the app is hidden', async () => {
    t = await createTestGame();
    const kb = keyboardInput(t.game);
    const ups: string[] = [];
    kb.onRelease('*', (e) => ups.push(e.code));
    t.platform.key('ArrowLeft');
    t.platform.key('ShiftLeft');
    await t.step();
    t.platform.hide();
    expect(kb.anyDown()).toBe(false);
    expect(ups).toEqual(['ArrowLeft', 'ShiftLeft']);
    t.platform.show();
  });

  it('stops listening when the game stage is destroyed', async () => {
    t = await createTestGame();
    const tg = t;
    const kb = keyboardInput(tg.game);
    tg.destroy();
    t = null;
    tg.platform.key('Space');
    expect(kb.isDown('Space')).toBe(false);
  });
});

describe('createInputActions', () => {
  it('maps keys to down / pressed / released / axis', async () => {
    t = await createTestGame();
    const input = createInputActions(t.game, MAP);
    t.platform.key('KeyA');
    await t.step();
    expect(input.down('left')).toBe(true);
    expect(input.pressed('left')).toBe(true);
    expect(input.axis('left', 'right')).toBe(-1);
    expect(input.downActions()).toEqual(['left']);
    t.platform.key('ArrowRight');
    await t.step();
    expect(input.pressed('left')).toBe(false);
    expect(input.axis('left', 'right')).toBe(0);
    t.platform.key('KeyA', 'up');
    await t.step();
    expect(input.released('left')).toBe(true);
    expect(input.axis('left', 'right')).toBe(1);
    await t.step();
    expect(input.released('left')).toBe(false);
  });

  it('presses once when two keys of one action go down, and catches sub-frame taps', async () => {
    t = await createTestGame();
    const input = createInputActions(t.game, MAP);
    const log: string[] = [];
    input.onPress('jump', (a) => log.push(`press:${a}`));
    input.onRelease('jump', (a) => log.push(`release:${a}`));
    t.platform.key('Space');
    await t.step();
    t.platform.key('KeyW');
    await t.step();
    expect(input.pressed('jump')).toBe(false);
    t.platform.key('Space', 'up');
    t.platform.key('KeyW', 'up');
    await t.step();
    t.platform.key('ArrowUp');
    t.platform.key('ArrowUp', 'up');
    await t.step();
    expect(input.pressed('jump')).toBe(true);
    expect(input.released('jump')).toBe(true);
    expect(input.down('jump')).toBe(false);
    expect(log).toEqual(['press:jump', 'release:jump', 'press:jump', 'release:jump']);
  });

  it('ignores keys that were already held when the actions were created', async () => {
    t = await createTestGame();
    keyboardInput(t.game);
    t.platform.key('Space');
    await t.step();
    const input = createInputActions(t.game, MAP);
    await t.step();
    expect(input.down('jump')).toBe(true);
    expect(input.pressed('jump')).toBe(false);
  });

  it('diagonal vector is normalized', async () => {
    t = await createTestGame();
    const input = createInputActions(t.game, { ...MAP, up: ['KeyW'], down: ['KeyS'] });
    t.platform.key('KeyD');
    t.platform.key('KeyS');
    await t.step();
    const v = input.vector('left', 'right', 'up', 'down');
    expect(v.x).toBeCloseTo(Math.SQRT1_2);
    expect(v.y).toBeCloseTo(Math.SQRT1_2);
  });

  it('rebinds at runtime and exports bindings', async () => {
    t = await createTestGame();
    const input = createInputActions(t.game, MAP);
    input.rebind('jump', ['KeyJ']);
    input.bind('left', 'KeyQ', 'KeyA');
    input.unbind('right', 'KeyD');
    expect(input.toJSON()).toEqual({ left: ['ArrowLeft', 'KeyA', 'KeyQ'], right: ['ArrowRight'], jump: ['KeyJ'] });
    t.platform.key('Space');
    await t.step();
    expect(input.down('jump')).toBe(false);
    t.platform.key('KeyJ');
    t.platform.key('KeyQ');
    await t.step();
    expect(input.pressed('jump')).toBe(true);
    expect(input.down('left')).toBe(true);
    expect(inputCodeLabel('KeyJ')).toBe('J');
    expect(inputCodeLabel('ArrowUp')).toBe('\u2191');
    expect(inputCodeLabel('ControlRight')).toBe('Ctrl');
    expect(inputCodeLabel('PadA')).toBe('A');
  });

  it('virtual sources drive the same actions (boolean and analog)', async () => {
    t = await createTestGame();
    const input = createInputActions(t.game, MAP);
    let jump = false;
    let right = 0;
    const off = input.bindVirtual('jump', () => jump);
    input.bindVirtual('right', () => right);
    jump = true;
    right = 0.3;
    await t.step();
    expect(input.pressed('jump')).toBe(true);
    expect(input.down('right')).toBe(false);
    expect(input.axis('left', 'right')).toBeCloseTo(0.3);
    off();
    await t.step();
    expect(input.released('jump')).toBe(true);
  });

  it('bindHold holds an action while an on-screen button is pressed, even for a sub-frame tap', async () => {
    t = await createTestGame();
    const input = createInputActions(t.game, MAP);
    const btn = t.game.sceneLayer.add(new Box(160, 160, { fill: '#333' }, { x: 100, y: 900 }));
    input.bindHold('jump', btn);
    const p = t.game.stageToScreen(180, 980);
    t.platform.touch('start', [{ id: 1, ...p }]);
    await t.step();
    expect(input.pressed('jump')).toBe(true);
    await t.step(5);
    expect(input.down('jump')).toBe(true);
    t.platform.touch('end', [{ id: 1, ...p }]);
    await t.step();
    expect(input.released('jump')).toBe(true);
    t.platform.touch('start', [{ id: 2, ...p }]);
    t.platform.touch('end', [{ id: 2, ...p }]);
    await t.step();
    expect(input.pressed('jump')).toBe(true);
    await t.step();
    expect(input.released('jump')).toBe(true);
    btn.destroy();
    t.platform.touch('start', [{ id: 3, ...p }]);
    await t.step();
    expect(input.down('jump')).toBe(false);
  });

  it('bindStick maps a VirtualJoystick onto actions', async () => {
    t = await createTestGame();
    const input = createInputActions(t.game, { ...MAP, up: [], down: [] });
    const stick = t.game.sceneLayer.add(new VirtualJoystick({ mode: 'fixed', radius: 100, x: 100, y: 800, deadZone: 0 }));
    input.bindStick(stick, { left: 'left', right: 'right', up: 'up', down: 'down' });
    const c = t.game.stageToScreen(200, 900);
    const e = t.game.stageToScreen(100, 900);
    t.platform.touch('start', [{ id: 1, ...c }]);
    t.platform.touch('move', [{ id: 1, ...e }]);
    await t.step();
    expect(input.down('left')).toBe(true);
    expect(input.axis('left', 'right')).toBeCloseTo(-1);
    expect(input.axis('up', 'down')).toBeCloseTo(0);
    stick.destroy();
    await t.step();
    expect(input.down('left')).toBe(false);
  });

  it('reads gamepad buttons and analog stick directions', async () => {
    t = await createTestGame();
    const pad: PlatformGamepad = { index: 0, id: 'test pad', standard: true, buttons: new Array(17).fill(0), axes: [0, 0, 0, 0] };
    (t.platform as Platform).pollGamepads = () => [pad];
    const input = createInputActions(t.game, { ...MAP, jump: ['Space', 'PadA'], left: ['KeyA', 'PadLStickLeft'] });
    const gp = gamepadInput(t.game);
    gp.deadZone = 0.2;
    pad.buttons[0] = 1;
    pad.axes[0] = -0.7;
    await t.step();
    expect(gp.connected).toBe(true);
    expect(gp.justPressed('PadA')).toBe(true);
    expect(input.pressed('jump')).toBe(true);
    expect(input.value('left')).toBeCloseTo(0.625);
    expect(input.down('left')).toBe(true);
    expect(gp.stick('left').x).toBeCloseTo(-0.625);
    pad.buttons[0] = 0;
    await t.step();
    expect(input.released('jump')).toBe(true);
    expect(gp.justReleased('PadA')).toBe(true);
  });

  it('enabled = false releases everything', async () => {
    t = await createTestGame();
    const input = createInputActions(t.game, MAP);
    t.platform.key('KeyD');
    await t.step();
    input.enabled = false;
    await t.step();
    expect(input.released('right')).toBe(true);
    expect(input.down('right')).toBe(false);
    input.enabled = true;
    await t.step();
    expect(input.pressed('right')).toBe(true);
  });

  it('keeps sampling while the game is paused', async () => {
    t = await createTestGame();
    const input = createInputActions(t.game, MAP);
    t.game.paused = true;
    t.platform.key('Space');
    await t.step();
    expect(input.pressed('jump')).toBe(true);
    t.game.paused = false;
  });

  it('drives the sandbox input-keys scene from keys and on-screen buttons', async () => {
    t = await createTestGame({ app: sandbox, scene: 'input-keys', device: 'iphone-14' });
    await t.step(2);
    const hero = t.get('#hero');
    const x0 = hero.x;
    const y0 = hero.y;
    t.platform.key('KeyD');
    await t.advance(0.3);
    expect(hero.x).toBeGreaterThan(x0 + 100);
    expect(t.get<Label>('#actions').text).toBe('right');
    expect(t.get<Label>('#keys').text).toBe('D');
    t.platform.key('KeyD', 'up');
    await t.tap('#btn-jump');
    expect(hero.y).toBeLessThan(y0 - 20);
    await t.tap('#rebind');
    t.platform.key('KeyJ');
    expect(t.get<Label>('#jump-keys').text).toBe('J');
  });

  it('is destroyed with its owner scene', async () => {
    const app = {
      design: { width: 750, height: 1334 },
      scenes: { a: () => new Scene(), b: () => new Scene() },
      start: 'a',
    };
    t = await createTestGame({ app });
    const input = createInputActions(t.scene!, MAP);
    let presses = 0;
    input.onPress('jump', () => presses++);
    t.platform.key('Space');
    await t.step();
    expect(presses).toBe(1);
    await t.go('b');
    expect(input.destroyed).toBe(true);
    t.platform.key('Space', 'up');
    t.platform.key('Space');
    await t.step();
    expect(presses).toBe(1);
    expect(input.down('jump')).toBe(false);
  });
});
