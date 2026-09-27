import { sfxPresets, type SfxParams, type SongDef } from '@engine';

// 布偶弓箭手 sounds. `pnpm audio --app archer` renders them to archer/assets/audio/*.mp3 + manifest.json; without
// the files the AudioManager synthesizes them at runtime. AUDIO CONTRACT: the names below are what the game plays.
//   draw       bow starts being drawn (string creak), rate 0.9..1.1
//   shoot      arrow released: string twang + whoosh, rate = 0.85 + 0.3 * power (power 0..1)
//   hit        arrow into a body (thud)
//   headshot   arrow into a head (sharper crack + small ding), played instead of hit
//   thunk      arrow into stone (tower / floating block)
//   hurt       the player is hit (lower, heavier than hit)
//   explode    explosive arrow / missile blast
//   zap        electric arrow hit (stun)
//   poison     poison arrow hit (bubbly hiss)
//   balloon    balloon tied to an enemy (rubber squeak / inflate)
//   saw        chainsaw arrow cutting through (short buzz)
//   heal       vampire arrow heals / red or gold apple heals
//   apple      an apple was shot (juicy pop + chime)
//   coin       skulls awarded for a kill (coin-like rattle)
//   kill       enemy dies (low thump)
//   boss       boss enemy arrives (low horn)
//   arrive     a normal enemy arrives (soft swoosh)
//   jump       player hops
//   revive     spare life used / ad revive (rising shimmer)
//   gameover   run over sting
//   record     new best score
//   buy        upgrade bought / arrow unlocked (cash register chime)
//   deny       can't afford / not enough stamina (short low buzz)
//   click      UI button
//   equip      arrow equipped / switched in battle (light click-slide)
// Music:
//   bgm        battle loop (moody minor key, medium tempo), loops seamlessly
//   menu       calm menu loop (same key as bgm)

export const sfx: Record<string, SfxParams | (() => SfxParams)> = {
  draw: () => sfxPresets.whoosh(3),
  shoot: () => sfxPresets.shoot(1),
  hit: () => sfxPresets.hit(1),
  headshot: () => sfxPresets.hit(2),
  thunk: () => sfxPresets.hit(3),
  hurt: () => sfxPresets.hurt(1),
  explode: () => sfxPresets.explosion(1),
  zap: () => sfxPresets.laser(1),
  poison: () => sfxPresets.bubble(1),
  balloon: () => sfxPresets.pop(2),
  saw: () => sfxPresets.laser(3),
  heal: () => sfxPresets.powerup(1),
  apple: () => sfxPresets.pickup(1),
  coin: () => sfxPresets.coin(1),
  kill: () => sfxPresets.hurt(2),
  boss: () => sfxPresets.lose(2),
  arrive: () => sfxPresets.whoosh(1),
  jump: () => sfxPresets.jump(1),
  revive: () => sfxPresets.powerup(2),
  gameover: () => sfxPresets.lose(1),
  record: () => sfxPresets.win(1),
  buy: () => sfxPresets.coin(2),
  deny: () => sfxPresets.error(1),
  click: () => sfxPresets.click(1),
  equip: () => sfxPresets.select(1),
};

export const music: Record<string, SongDef> = {};
