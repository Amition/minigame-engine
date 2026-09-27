# Templates

Copy, rename, fill in. All APIs are from `'@engine'` (tests also use `'@engine/testing'` and `vitest`).

## main.ts

```ts
import { autoTextureResolution, configureAds, createAudioManager, defineApp, setUITheme } from '@engine';
import appJson from './app.json';
import { bakeGameArt } from './art/game-art';
import { music, sfx } from './audio/index';
import { PlayScene } from './scenes/play';
import { TitleScene } from './scenes/title';

export default defineApp({
  design: { width: 750, height: 1334 },
  scaleMode: 'expand',
  background: '#ffe9a8',
  scenes: { title: () => new TitleScene(), play: () => new PlayScene() },
  start: 'title',
  boot(game) {
    setUITheme('light');
    configureAds(appJson.ads);
    bakeGameArt(autoTextureResolution());
    createAudioManager(game, { library: { sfx, music } });
  },
});
```

`AppDef` = `GameConfig` (`design`, `scaleMode`, `background`, `maxDt`, `maxPixelRatio`, `tapSlop`, `pauseOnHide`)
+ `scenes`, `start`, `boot(game)`. `boot` may be async (loading); if it opens a scene itself, `start` is skipped.
The skeletons below assume `audio/index.ts` defines `sfx.score` and `music.bgm` (see the audio-design skill)
and `art/game-art.ts` exports `bakeGameArt(resolution)`.

## app.json

```json
{
  "name": "My Game",
  "version": "0.1.0",
  "orientation": "portrait",
  "background": "#ffe9a8",
  "appid": { "wx": "", "tt": "", "tap": "" },
  "ads": {
    "wx": { "rewarded": "", "interstitial": "" },
    "tt": { "rewarded": "", "interstitial": "" },
    "tap": { "rewarded": "", "interstitial": "" }
  },
  "share": { "title": "Share title" }
}
```

`configureAds(appJson.ads)` in `boot()` makes `canShowAd()` / `showRewardedAd()` pick the current platform's unit
id (JSON imports are enabled; the typed shape is `AppJsonConfig`).

## Play scene skeleton

```ts
import { fixedUpdate, mountScreen, Node, onAim, playSong, playSound, Scene, ui, type Label } from '@engine';
import { MatchModel, type MatchEvent } from '../model';

export class PlayScene extends Scene {
  model!: MatchModel;
  private halted = false;
  private scoreLabel!: Label;

  override get kind(): string {
    return 'PlayScene';
  }

  override onEnter(params?: { seed?: number }): void {
    const safe = this.game.safe;
    this.model = new MatchModel({ seed: params?.seed ?? 1 });
    const zone = this.add(new Node({ id: 'touch-zone', x: 0, y: safe.y + 190, width: this.width, height: safe.h - 190 }));
    zone.tags.add('lint-surface');
    onAim(zone, { release: (a) => this.model.tap(a.y < zone.height / 2 ? 10 : 20) }, { enabled: () => !this.halted });
    fixedUpdate(this, 60, (step) => {
      if (!this.halted) this.handle(this.model.step(step));
    });
    this.scoreLabel = ui.text('0', { id: 'score', variant: 'title', size: 76 });
    mountScreen(
      this.add(new Node({ id: 'hud', width: this.width, height: this.height })),
      ui.row({ justify: 'between', align: 'start', padding: [20, 28, 0, 28] }, [
        this.scoreLabel,
        ui.iconButton({ id: 'pause', icon: 'pause', label: 'Pause', variant: 'primary', onTap: () => (this.halted = !this.halted) }),
      ]),
    );
    playSong('bgm', { fadeMs: 1200 });
  }

  private handle(events: MatchEvent[]): void {
    for (const e of events) {
      if (e.type === 'score') {
        this.scoreLabel.text = String(this.model.score);
        playSound('score');
      } else if (e.type === 'gameover') {
        this.halted = true;
      }
    }
  }
}
```

## Headless playtest

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { formatLint, lintUI } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';
import app from './main';
import type { PlayScene } from './scenes/play';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

const shots = !!process.env.GAME_SHOTS;

describe('play', () => {
  it('scores when tapped and ends the game', async () => {
    t = await createTestGame({ app, device: 'iphone-14', scene: 'play', params: { seed: 3 }, render: 'none' });
    const scene = t.scene as PlayScene;
    for (let i = 0; i < 12 && scene.model.state === 'playing'; i++) {
      await t.tap('#touch-zone');
      await t.advance(0.2);
    }
    if (shots) await t.screenshot('.shots/game-play-iphone-14.png');
    expect(scene.model.state).toBe('over');
    expect(t.played()).toContain('score');
  });

  it('lints clean on three devices', async () => {
    for (const device of ['iphone-se', 'iphone-14', 'ipad']) {
      t = await createTestGame({ app, device, scene: 'play', params: { seed: 1 }, render: 'none' });
      await t.advance(0.5);
      const issues = lintUI(t.game.stage, t.game);
      expect(issues.filter((i) => i.severity === 'error'), `${device}\n${formatLint(issues)}`).toHaveLength(0);
      t.destroy();
      t = null;
    }
  });
});
```

Harness cheatsheet (`await` every action: `step`, `advance`, `tap`, `press`, `drag`, `go`, `screenshot` return
promises): `t.step(frames)`, `t.advance(seconds)`, `t.tap(selector | node | {x, y})`, `t.press(target, s)`,
`t.drag(from, to)`, `t.go(scene, params)`, `t.find/findAll/get(selector)`, `t.dump()`,
`t.screenshot(file, { overlay })`, `t.png()`, `t.played()`, `t.platform.ads.rewardedResult = false` (failed ad).
Tests run the headless platform without `assetsDir`, so the AudioManager synthesizes sounds from the library.
