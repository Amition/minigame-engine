import { afterEach, describe, expect, it } from 'vitest';
import { Modal, Node, openModalsOf, Scene, showDialog, showModal, showToast, toastHost, ui, type SceneFactory } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

const scenes: Record<string, SceneFactory> = {
  menu: () => new Scene(),
  level: () => new Scene(),
  pause: () => new Scene(),
};

const boot = async (scene = 'menu') => {
  t = await createTestGame({ app: { design: { width: 750, height: 1334 }, scenes, start: '' }, scene });
  return t;
};

/** True once the promise settled (checked after a few frames). */
function settled(p: Promise<unknown>): () => boolean {
  let done = false;
  void p.then(
    () => (done = true),
    () => (done = true),
  );
  return () => done;
}

describe('modal ownership', () => {
  it('a modal opened while a scene is current closes when the scene is left; closed stays pending', async () => {
    const t = await boot();
    const menu = t.game.scenes.current!;
    let onClose = 0;
    const m = showModal({ title: 'Settings', onClose: () => onClose++ }, [ui.text('Body')]);
    expect(m.owner).toBe(menu);
    const closed = settled(m.closed);
    await t.advance(0.5);
    await t.game.scenes.go('level');
    expect(m.destroyed).toBe(true);
    expect(m.isOpen).toBe(false);
    expect(openModalsOf()).toEqual([]);
    expect(t.find('Modal')).toBeNull();
    await t.advance(0.5);
    expect(closed()).toBe(false);
    expect(onClose).toBe(0);
    expect(showModal({ title: 'Next' }).zIndex).toBe(100);
  });

  it('owner: null keeps an app-level dialog open across scene changes', async () => {
    const t = await boot();
    const d = showDialog({ title: 'Update available', owner: null, buttons: [{ text: 'OK', action: 'ok' }] });
    expect(d.owner).toBeNull();
    await t.game.scenes.go('level');
    await t.advance(0.5);
    expect(d.isOpen).toBe(true);
    await t.tap('Dialog Button[text=OK]');
    await t.advance(0.5);
    await expect(d.closed).resolves.toBe('ok');
  });

  it('with a transition the modal goes as soon as the new scene entered, before the old one is destroyed', async () => {
    const t = await boot();
    const menu = t.game.scenes.current!;
    const m = showModal({ title: 'Bye' });
    await t.advance(0.4);
    await t.game.scenes.go('level', undefined, { transition: 'fade', duration: 0.3 });
    expect(menu.destroyed).toBe(false);
    expect(m.destroyed).toBe(true);
    await t.advance(0.5);
    expect(menu.destroyed).toBe(true);
  });

  it('pushed scenes own the modals opened above them; popping one keeps the base scene modal', async () => {
    const t = await boot();
    const base = showModal({ title: 'Base' });
    void t.game.scenes.push('pause');
    await t.step(1);
    const pause = t.game.scenes.top!;
    const top = showModal({ title: 'Top' });
    expect(top.owner).toBe(pause);
    await t.game.scenes.pop();
    await t.step(1);
    expect(top.destroyed).toBe(true);
    expect(base.isOpen).toBe(true);
    expect(openModalsOf()).toEqual([base]);
  });

  it('an explicit parent or owner node decides the lifetime', async () => {
    const t = await boot();
    const scene = t.game.scenes.current!;
    const holder = scene.add(new Node());
    const inHolder = new Modal({ title: 'Local' }).open(holder);
    expect(inHolder.owner).toBeNull();
    const card = scene.add(new Node());
    const owned = showModal({ title: 'Card', owner: card });
    expect(owned.owner).toBe(card);
    card.destroy();
    expect(owned.destroyed).toBe(true);
    expect(inHolder.isOpen).toBe(true);
    await t.game.scenes.go('level');
    expect(inHolder.destroyed).toBe(true);
    expect(openModalsOf()).toEqual([]);
  });
});

describe('toast ownership', () => {
  it("drops the leaving scene's showing and queued toasts; app-level ones stay", async () => {
    const t = await boot();
    showToast('First');
    showToast('Second');
    showToast('Welcome back', { owner: null });
    await t.advance(0.5);
    expect(t.find('Toast[text=First]')?.describe().state).toBe('showing');
    expect(toastHost().pending).toBe(3);
    await t.game.scenes.go('level');
    expect(t.find('Toast[text=First]')).toBeNull();
    expect(t.find('Toast[text=Second]')).toBeNull();
    expect(toastHost().pending).toBe(1);
    await t.advance(0.5);
    expect(t.find('Toast[text=Welcome back]')?.describe().state).toBe('showing');
    showToast('Level 1');
    await t.advance(5);
    expect(t.find('Toast')).toBeNull();
    expect(toastHost().pending).toBe(0);
  });

  it('clear() and hide() keep the pending count exact', async () => {
    const t = await boot();
    const a = showToast('A');
    const b = showToast('B');
    showToast('C');
    b.hide();
    expect(toastHost().pending).toBe(2);
    toastHost().clear();
    expect(toastHost().pending).toBe(1);
    await t.advance(1);
    expect(a.destroyed).toBe(true);
    expect(toastHost().pending).toBe(0);
  });
});

describe('scene restarts with UI open', () => {
  it('restarting (also mid-transition, also mid-close) leaves no modal, toast or error behind', async () => {
    const t = await boot('level');
    const sm = t.game.scenes;
    const d = showDialog({ title: 'Game over', buttons: [{ text: 'Again', action: 'again' }] });
    showToast('Saved');
    const closed = settled(d.closed);
    await t.advance(0.4);
    await sm.restart();
    await t.advance(0.5);
    expect(d.destroyed).toBe(true);
    expect(closed()).toBe(false);

    const m = showModal({ title: 'Pause' });
    showToast('Again');
    await t.advance(0.35);
    m.close('restart');
    await sm.restart({ transition: 'fade', duration: 0.3 });
    showModal({ title: 'Fresh' });
    await t.advance(1);
    await sm.idle();
    expect(m.destroyed).toBe(true);
    expect(openModalsOf().map((x) => x.titleLabel?.text)).toEqual(['Fresh']);
    expect(openModalsOf()[0]!.zIndex).toBe(100);
    expect(toastHost().pending).toBe(0);
  });
});
