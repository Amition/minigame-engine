---
name: game-feel
description: >-
  Game feel (手感 / 打击感 / juice) with this engine: tweens and timers with owner lifecycle, the juice catalogue
  (shake, punch, popIn, floatUp, flash, blink, countTo...), damped springs (createSpring, springProp, squashSpring
  squash & stretch, wobble), node-bound fixedUpdate for gameplay simulation, scene restart, the onAim
  press-slide-release gesture (drop aiming, slingshot, flick), sound shortcuts (playSound / playSong / stopSong),
  the rewarded / interstitial ads helper, and recipes for merge pops, landing squash, score punch, combo popups,
  screen-shake levels, hit-stop / time scale and particle bursts. Use it when adding feedback or polish to a game
  or UI, when something feels flat, stiff, floaty or unresponsive, when wiring input for aiming or throwing,
  playing sounds, restarting a level, offering "watch an ad to revive", or when subclassing Node / Scene (list of
  reserved member names such as paused, data, visible, alpha that subclasses must not reuse).
---

# Game feel (手感 / 打击感)

Everything here is imported from `'@engine'`. Feedback should be **fast** (react on the same frame as the input),
**layered** (motion + sound + particles + shake, scaled to the size of the event) and **short** (0.1 - 0.5 s).

## Ground rules

- **Owner lifecycle.** Tweens, timers, springs and node-bound helpers take an owner node (default: the animated
  node). Destroying the owner kills them; pausing the owner or any ancestor (`node.paused = true`, or a scene
  pushed above) freezes them. Pass `{ owner: this }` from scenes so nothing outlives the scene.
- **Game time vs realtime.** Default is game time: stops while `game.paused`, follows `game.time.timeScale`.
  `{ realtime: true }` keeps running (pause menus, hit-stop restore timers). Scene transitions are realtime.
- **Deterministic.** Random jitter comes from `rng` / `new Rng(seed)`, never `Math.random()`.
- **Compose, don't fight.** Scale helpers (`punch`, `pulse`, `popIn`, `popOut`) cancel each other and restore the
  rest scale. `squashSpring` multiplies on top of them; `shake` only adds an offset to x/y. Don't tween a property
  that a `springProp` owns.
- Use `anchor: 0.5` for scale / rotation effects around the centre (`[0.5, 1]` to squash onto the floor).

## Juice catalogue (engine/runtime/juice.ts)

`JuiceOptions = { realtime?, game?, onComplete? }`; `HideOptions = JuiceOptions & { destroy? }`. All return the
`Tween` (awaitable, `.kill()`).

| Call | Effect |
| --- | --- |
| `shake(node, intensity = 12, duration = 0.35, opts?)` | decaying random x/y jitter; works on moving nodes |
| `punch(node, scale = 1.25, duration = 0.3, opts?)` | quick scale bump, springs back (buttons, score) |
| `pulse(node, scale = 1.08, period = 0.9, opts?)` | endless breathing; kill the tween to stop |
| `popIn(node, duration = 0.4, opts?)` | visible + scale 0 → rest with overshoot |
| `popOut(node, duration = 0.25, opts?: HideOptions)` | shrink to 0, then hide or destroy |
| `fadeIn(node, duration = 0.3, to = 1, opts?)` / `fadeOut(node, duration = 0.3, opts?: HideOptions)` | alpha; fadeOut hides (stops taps) or destroys |
| `flash(game?, color = '#ffffff', duration = 0.3, opts?: { alpha? })` | full-screen colour flash in `game.overlay` |
| `floatUp(node, distance = 80, duration = 0.8, opts?: HideOptions)` | rise + fade, destroys by default (score popups) |
| `blink(node, times = 4, duration = 0.8, opts?)` | visibility toggling (invulnerability); ends visible |
| `countTo(label, to, duration = 0.8, opts?: { from?, format? })` | number tally on a Text |

## Springs (engine/runtime/spring.ts)

Springs react to changing targets and stack impulses, which tweens can't. Pick them for anything physical.

```ts
const s = createSpring({ frequency: 3, dampingRatio: 0.4, value: 0, target: 100 }); // or stiffness/damping/mass
node.onUpdate((dt) => (node.x = s.step(dt)));
s.target = 300;      // retarget any time, keeps velocity
s.kick(-800);        // impulse
s.snap(0);           // teleport + stop
s.atRest; s.frequency; s.dampingRatio; s.tune(4, 0.3);
```

`dampingRatio`: 0.1-0.3 bouncy/jelly, 0.4-0.6 lively UI, 1 = fastest without overshoot. Sub-stepped (<= 1/120 s)
and deterministic; snaps exactly onto the target at rest.

```ts
// Drive a property; stops with its owner (default: the object if it is a Node).
const fx = springProp(dot, 'x', { frequency: 2, dampingRatio: 0.45 });   // returns SpringProp (a Spring)
fx.target = 400;  fx.stop();
springProp(camState, 'zoom', { owner: scene, frequency: 1.5, dampingRatio: 1 });

// Node effects: calling again on the same node kicks the same effect (kicks add up, capped).
squashSpring(node, strength = 1, opts?: SquashSpringOptions): SpringEffect
wobble(node, strength = 1, opts?: SpringEffectOptions): SpringEffect
squashBaseScale(node): { x, y }   // scale without the running squash
```

- `squashSpring`: volume-preserving (scaleX · scaleY stays constant). Strength 1 widens by up to ~19% and settles
  in ~0.5 s; negative strength stretches first (jump take-off). `axis: 'y'` (default: flatten, landing) or `'x'`.
  Options `{ frequency = 5, dampingRatio = 0.32, kick = 9, max = 0.35, realtime, game }`. Restores the base scale
  exactly at rest / on `stop()`; freezes with a paused subtree; ends when the node is destroyed. Squashes along
  the node's own (rotated) axes.
- `wobble`: rotation spring around the base rotation, strength 1 ≈ 12° then settles in ~0.9 s; negative strength
  swings the other way. Defaults `{ frequency = 4, dampingRatio = 0.25, kick = 8, max = 0.4 }` (radians).
- `SpringEffect = { node, spring, active, stop() }`.

## Tweens and timers (engine/runtime/tween.ts, timers.ts)

```ts
await tween(box, { x: 400, alpha: 0.5, scale: 1.2 }, 0.3, { ease: 'backOut', delay: 0.1 });
tween(coin, { y: '-=40' }, 0.2).to({ y: '+=40' }, 0.2, 'bounceOut').repeat(Infinity);
tween(panel, { fill: '#ff0000' }, 0.5).yoyo();                     // colours too
tweenValue(0, 100, 1, (v) => (bar.value = v), { owner: this });   // plain values
sequence([tween(a, { x: 100 }, 0.3), 0.2, () => flash(this.game)]); parallel([...]);
killTweensOf(node); isTweening(node);
```

`TweenOptions`: `ease` (`linear`, `quadOut` (default), `cubicInOut`, `backOut`, `elasticOut`, `bounceOut`,
`sineInOut`, `expoOut`...), `delay`, `repeat`, `yoyo`, `realtime`, `owner`, `game`, `onUpdate(p)`, `onComplete`,
`onKill`. `tw.kill(true)` jumps to the end; `tw.timeScale`, `pause()` / `resume()`.

```ts
after(1, () => spawn(), { owner: this });                          // Timer: cancel(), pause(), remaining
every(0.5, (n) => spawnEnemy(n), { count: 10, owner: this });     // return false to stop
await wait(1.2, { owner: this });   // never resolves if the scene died first: code after it is safe
await waitUntil(() => boss.dead, { owner: this });
cancelTimersOf(this);
```

## Gameplay simulation: node-bound fixedUpdate (engine/runtime/fixed.ts)

```ts
fixedUpdate(target: Game | Node, hz: number, fn: (step: number, alpha: number) => void,
            opts?: { maxSteps?: number /* 5 */; priority?: number /* 0 */; game?: Game }): () => void
```

- **Node target** (use the scene): runs only while the node is on the stage and neither it nor an ancestor is
  paused (a pushed pause dialog freezes it, no backlog builds up), removes itself when the node is destroyed.
- **Game target**: global system until you call the remover.
- Steps run before the stage updates, so `update()` / `onUpdate` see this frame's simulation. `alpha` (0..1) is
  the leftover fraction for render interpolation. Follows `game.paused` and `timeScale`.

```ts
override onEnter(): void {
  fixedUpdate(this, 60, (dt) => {
    if (this.halted) return;            // soft pause for the sim only (HUD keeps animating)
    this.handle(this.model.step(dt));
  });
}
override update(dt: number): void {
  this.sync(dt);                        // copy bodies → nodes after this frame's steps
}
```

## Scene restart (engine/scene/scene.ts)

```ts
void this.game.scenes.restart({ transition: 'fade', duration: 0.3 }); // same scene, same params, new instance
void this.game.scenes.restart({ params: { seed: 42 } });              // new params (reused by later restarts)
this.game.scenes.currentParams;                                        // what restart() will pass
```

Closes pushed scenes first (their `push()` resolves `undefined`), is queued like `go()`, rejects without a current
scene. Returns `Promise<Scene>` (resolves after the new `onEnter`).

## Aim gesture: onAim (engine/runtime/gestures.ts)

```ts
onAim(zone: Node | Game, handlers: { start?, move?, release?, cancel? }, opts?: {
  space?: Node | null; owner?: Node | null; maxDistance?: number; enabled?: () => boolean }): () => void
```

The first pointer pressing the zone is captured (moves keep coming outside the zone, other fingers are ignored
until release). Each handler gets `AimInfo { pointer, x, y, stageX, stageY, startX, startY, dx, dy, distance,
angle, duration, vx, vy }`: positions in `space` (default: the zone; stage for a Game zone), `dx/dy` clamped to
`maxDistance`, `vx/vy` = velocity over the last 0.1 s. `cancel` fires on pointercancel, or when `enabled()` turns
false / the owner gets paused mid-aim. Tag a playfield-sized zone `lint-surface`.

```ts
// Suika-style drop: slide to aim, release to drop.
const zone = this.add(new Node({ id: 'touch-zone', y: jarTop - 120, width: this.width,
  height: this.height - jarTop + 120, tags: ['lint-surface'] }));
onAim(zone, {
  start: (a) => this.model.setAim(a.x),
  move: (a) => this.model.setAim(a.x),
  release: (a) => { this.model.setAim(a.x); this.model.drop(); },
}, { space: this.jar, enabled: () => !this.halted && this.model.state === 'playing' });

// Slingshot: pull back, fire the opposite way.
onAim(arena, {
  move: (a) => showTrajectory(-a.dx * POWER, -a.dy * POWER),
  release: (a) => a.distance > 20 && launch(-a.dx * POWER, -a.dy * POWER),
  cancel: () => hideTrajectory(),
}, { space: arena, maxDistance: 200 });
```

Other gestures: `draggable(node, opts)`, `onSwipe(target, fn, opts)`, `onLongPress(node, fn, s)`,
`onDoubleTap(node, fn)`, `pinch(target, fn)`, `VirtualJoystick`.

## Sound shortcuts (engine/audio/shortcuts.ts)

No-ops without an AudioManager (tests, tools), so no `getAudioManager(game)?.` chains:

```ts
playSound(name, opts?: PlaySfxOptions & { game? }): AudioInstance | null   // volume, rate, pitchJitter, cooldownMs, maxVoices
playSong(name, opts?: PlayMusicOptions & { game? }): void                  // fadeMs, volume, restart
stopSong(fadeMs?, opts?: { game? }): void
isAudioMuted(channel = 'master', opts?): boolean
setAudioMuted(channel: 'master' | 'music' | 'sfx', muted, opts?): void
```

Vary repeated sounds: `pitchJitter: 1` (semitones) or `rate` rising with combo / level. The manager's per-sound
cooldown (40 ms) and voice limit keep spam from clipping.

## Ads helper (engine/platform/ads.ts)

```ts
import appJson from '../app.json';
configureAds(appJson.ads);                              // once (AppDef boot); ids per platform: ads.wx.rewarded...
const canRevive = !this.revived && canShowAd('rewarded'); // unit id + ad service, or web/headless (simulated)
if (await showRewardedAd()) this.revive(); else showToast('广告未看完，无法复活');
await showInterstitialAd();                             // between rounds; resolves even without an ad
```

Also `adUnitId(kind, platformName?)`, `adsSimulated()`, `isAdShowing()`, types `AppJsonConfig`, `AdsConfig`,
`AdUnits`, `AdKind` (any key works: `showRewardedAd('revive')` reads `ads.<platform>.revive`). Only one ad at a
time; the promises never reject.

## Recipes

**Merge pop** (two things become one):

```ts
const n = layer.add(new FruitNode(level, { x, y }));
popIn(n, 0.25);                                   // grow in with overshoot
squashSpring(n, 0.8);                             // jelly wobble on top (composes with popIn)
spawnParticles(fx, 'hitSpark', { x, y, colors: [juice, '#ffffff'] });
playSound('merge', { rate: 1.25 - Math.min(level, 10) * 0.05 });   // bigger = lower
if (level >= 8) shake(playfield, 6 + level, 0.35);
```

**Landing squash**: on an impact event `squashSpring(node, clamp((impact - 300) / 1000, 0, 1.5))`; add `'dust'`
particles and a `playSound('land', { volume })` scaled by impact above a threshold. Jump: `squashSpring(p, -0.6)`.

**Score punch**: `label.text = String(score); punch(label, 1.12, 0.2);` or tally big gains with
`countTo(label, score, 0.4)` and punch at the end (`onComplete`).

**Combo popup text**:

```ts
const t = fx.add(new Text(`连击 ×${combo}`, { fontSize: 34 + Math.min(combo, 8) * 3, fontWeight: 'bold',
  color: '#fff3b0', stroke: { color: '#b45309', width: 7 } }, { x, y, anchor: 0.5 }));
t.zIndex = 10;
popIn(t, 0.2);                // scale
floatUp(t, 90, 0.9);          // y + alpha, destroys at the end
playSound('combo', { rate: Math.min(1.5, 1 + 0.08 * (combo - 2)) });
```

**Screen-shake levels** (shake the playfield / world, not the HUD):

| Level | Call | Use for |
| --- | --- | --- |
| light | `shake(field, 4, 0.15)` | every hit, small merge |
| medium | `shake(field, 10, 0.3)` | big merge, damage taken |
| heavy | `shake(scene, 18, 0.5)` + `flash(game, '#fff', 0.25, { alpha: 0.6 })` | boss, max level, explosion |

With a `World`: `camera.shake(0.2 | 0.5 | 1)` adds trauma (0..1) instead.

**Hit-stop / slow motion** (`game.time.timeScale` scales game-time tweens, timers, fixedUpdate, update dt and
springs; realtime timers and scene transitions ignore it):

```ts
function hitStop(game: Game, seconds = 0.06): void {
  game.time.timeScale = 0;
  after(seconds, () => (game.time.timeScale = 1), { realtime: true, game });
}
tweenValue(0.2, 1, 0.6, (v) => (game.time.timeScale = v), { realtime: true, ease: 'quadIn' }); // slow-mo out
```

**Particles**: `spawnParticles(parent, preset, { x, y, ...overrides })`, presets `explosion`, `confetti`,
`coinBurst`, `hitSpark`, `dust` (one-shot, auto-destroy) and `sparkle`, `smoke`, `fire`, `rain`, `snow`, `magic`,
`trail` (continuous: `emitter.stop()`). Pass a full `ParticleConfig` for custom bursts (`bursts`, `speed`,
`gravity`, `colors`, `alpha` curve, `radial`, `spawn`). Keep `maxParticles` small on mini-games.

**Button feel**: `b.onTap(() => { punch(b, 1.08, 0.2); playSound('click'); ... })`, or `squashSpring(b, 0.6)` +
`wobble(b, 0.4)` for a jelly button. Haptics: `platform().vibrate('short')` on hits, `'long'` on game over.

**Loop of a satisfying action**: anticipation (squash -0.3 before a jump), action (tween / physics), impact
(squash + shake + particles + sound + hit-stop scaled by strength), settle (spring back), reward (popup, punch).

## Node reserved member names

Subclasses of `Node` / `Scene` must not declare fields, getters or methods with these names unless they mean to
override them with the same meaning and type. A clash is a type error (`private paused` → "is private in type X
but not in type Node") or, worse, a silent behaviour change (a custom `paused` flag stops `update()` for the
whole subtree; a `data` or `children` field breaks dumps and selectors). Pick another word: `halted`, `frozen`,
`info`, `items`, `fade`, `shown`...

- **State**: `uid`, `id`, `tags`, `parent`, `children`, `x`, `y`, `scaleX`, `scaleY`, `rotation`, `skewX`,
  `skewY`, `anchorX`, `anchorY`, `width`, `height`, `alpha`, `visible`, `interactive`, `interactiveChildren`,
  `hitPadding`, `clip`, `blend`, `paused`, `destroyed`, `data`, `zIndex`, `kind`, `root`, `worldVisible`.
- **Private (still reserved)**: `_zIndex`, `sortDirty`, `events`, `updaters`.
- **Methods**: `set`, `setPosition`, `setSize`, `setScale`, `setAnchor`, `add`, `append`, `addAt`, `remove`,
  `removeFromParent`, `removeChildren`, `destroy`, `isDescendantOf`, `sortChildren`, `localMatrix`,
  `worldMatrix`, `toLocal`, `toWorld`, `worldBounds`, `worldCenter`, `onUpdate`, `tick`, `render`, `on`, `once`,
  `off`, `emit`, `hasListeners`, `onTap`, `walk`, `find`, `findAll`, `matches`.
- **Meant to be overridden** (keep the signature): `kind` (getter), `update(dt)`, `draw(ctx)`, `drawOver(ctx)`,
  `describe()`, `onDestroy()`, `hitTest(lx, ly)`, `hitClip(lx, ly)`, `renderContent(ctx)`, `renderChildren(ctx)`.
- **Scene adds**: `game`, `sceneName`, `pushed`, `close()`; override `onEnter(params)`, `onExit()`,
  `onResize(w, h)`. (`restart` is free: it lives on `game.scenes`, not on Scene.)

## Verify

- Unit-test feel code with the headless harness: `const t = await createTestGame(); squashSpring(n, 1);
  await t.step(3); expect(n.scaleX).toBeGreaterThan(1); await t.advance(1); expect(n.scaleX).toBe(1);`.
- Look at it: `pnpm shot --app sandbox --scene helpers-aim --drag "#slingshot|#ground" --seconds 0.3` and Read
  the PNG; sandbox demos `helpers-aim` (slingshot, trajectory, squash on landing) and `helpers-spring` (jelly
  buttons, spring followers, step-response curves) show every helper in this file.
