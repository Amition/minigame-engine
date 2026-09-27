import {
  Box,
  createAudioManager,
  getAudioManager,
  Node,
  renderSfx,
  Text,
  type AudioChannel,
  type AudioManager,
  type Ctx2D,
  type SceneFactory,
} from '@engine';
import { music, sfx } from '../audio/index';
import { DemoScene } from '../common';

/** Min/max waveform of a mono buffer. */
class WaveView extends Node {
  pcm: Float32Array | null = null;
  label = '';

  override get kind(): string {
    return 'Waveform';
  }

  override draw(ctx: Ctx2D): void {
    const { width: w, height: h } = this;
    ctx.fillStyle = '#10131a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2a3142';
    ctx.fillRect(0, h / 2, w, 1);
    const pcm = this.pcm;
    if (!pcm || pcm.length === 0) return;
    const per = pcm.length / w;
    ctx.fillStyle = '#5ec8ff';
    for (let x = 0; x < w; x++) {
      let lo = 0;
      let hi = 0;
      const end = Math.min(pcm.length, Math.floor((x + 1) * per));
      for (let i = Math.floor(x * per); i < end; i++) {
        const v = pcm[i]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      ctx.fillRect(x, h / 2 - hi * (h / 2 - 4), 1, Math.max(1, (hi - lo) * (h / 2 - 4)));
    }
  }

  override describe() {
    return { ...super.describe(), sound: this.label || undefined, samples: this.pcm?.length };
  }
}

/** Audio lab: every sandbox sfx and song as a button, channel volumes and mutes, last-played waveform. */
class AudioLabScene extends DemoScene {
  readonly title = 'Audio Lab';
  private audio!: AudioManager;
  private status!: Text;
  private wave!: WaveView;

  protected async build(): Promise<void> {
    const g = this.game;
    this.audio = getAudioManager(g) ?? createAudioManager(g, { library: { sfx, music } });
    const audio = this.audio;
    const { x, y, w } = this.content;
    const m = 28;
    let cy = y + 16;

    this.status = this.add(
      new Text('loading…', { fontSize: 22, color: '#9aa3b8', wrapWidth: w - m * 2, maxLines: 2 }, {
        id: 'audio-status',
        x: x + m,
        y: cy,
      }),
    );
    cy += 64;
    this.wave = this.add(new WaveView({ id: 'wave', x: x + m, y: cy, width: w - m * 2, height: 110 }));
    cy += 126;

    const header = (text: string) => {
      this.add(new Text(text, { fontSize: 24, fontWeight: 'bold', color: '#e6e9f2' }, { x: x + m, y: cy }));
      cy += 40;
    };
    const button = (id: string, label: string, bx: number, by: number, bw: number, bh: number, fill: string, tag: string) => {
      const b = this.add(new Box(bw, bh, { fill, radius: 14 }, { id, tags: [tag], x: bx, y: by, hitPadding: 4 }));
      b.add(new Text(label, { fontSize: 22, color: '#ffffff' }, { id: `${id}-label`, x: bw / 2, y: bh / 2, anchor: 0.5 }));
      return b;
    };
    const flash = (b: Box, base: string) => {
      b.fill = '#f5b83d';
      let t = 0.15;
      const off = b.onUpdate((dt) => {
        t -= dt;
        if (t <= 0) {
          b.fill = base;
          off();
        }
      });
    };

    header(`Sound effects (${Object.keys(sfx).length})`);
    const cols = 4;
    const gap = 12;
    const bw = (w - m * 2 - gap * (cols - 1)) / cols;
    const bh = 64;
    Object.keys(sfx).forEach((name, i) => {
      const base = '#2d3a55';
      const b = button(`sfx-${name}`, name, x + m + (i % cols) * (bw + gap), cy + Math.floor(i / cols) * (bh + gap), bw, bh, base, 'sfx-button');
      b.onTap(() => {
        flash(b, base);
        const inst = audio.playSfx(name, { pitchJitter: name === 'coin' || name === 'pop' ? 0.5 : 0 });
        const def = sfx[name]!;
        this.wave.pcm = renderSfx(typeof def === 'function' ? def() : def, 8000);
        this.wave.label = name;
        this.showStatus(inst ? `played ${name}` : `${name} skipped (cooldown/muted/loading)`);
      });
    });
    cy += Math.ceil(Object.keys(sfx).length / cols) * (bh + gap) + 16;

    header('Music');
    const names = [...Object.keys(music), 'stop'];
    const mw = (w - m * 2 - gap * (names.length - 1)) / names.length;
    names.forEach((name, i) => {
      const base = name === 'stop' ? '#5a2d3a' : '#2d5540';
      const b = button(`music-${name}`, name === 'stop' ? 'stop' : `play ${name}`, x + m + i * (mw + gap), cy, mw, 72, base, 'music-button');
      b.onTap(() => {
        flash(b, base);
        if (name === 'stop') audio.stopMusic(600);
        else audio.playMusic(name, { fadeMs: 800 });
        this.showStatus(name === 'stop' ? 'music stopped' : `music: ${name}`);
      });
    });
    cy += 72 + 28;

    header('Volume');
    const channels: AudioChannel[] = ['master', 'music', 'sfx'];
    for (const ch of channels) {
      const rowY = cy;
      this.add(new Text(ch, { fontSize: 24, color: '#cfd5e6' }, { x: x + m, y: rowY + 36, anchorY: 0.5 }));
      const value = this.add(
        new Text('', { fontSize: 24, color: '#ffffff', align: 'center', wrapWidth: 120 }, {
          id: `vol-${ch}-value`,
          x: x + 290,
          y: rowY + 36,
          anchor: 0.5,
        }),
      );
      const down = button(`vol-${ch}-down`, '-', x + 150, rowY, 80, 72, '#2d3345', 'vol-button');
      const up = button(`vol-${ch}-up`, '+', x + 350, rowY, 80, 72, '#2d3345', 'vol-button');
      const mute = button(`mute-${ch}`, '', x + 460, rowY, w - m - 460 - x, 72, '#2d3345', 'mute-button');
      const muteLabel = mute.children[0] as Text;
      const refresh = () => {
        value.text = `${Math.round(audio.getVolume(ch) * 100)}%`;
        const muted = audio.isMuted(ch);
        muteLabel.text = muted ? 'muted' : 'on';
        mute.fill = muted ? '#7a2e3b' : '#2d4a3a';
      };
      down.onTap(() => audio.setVolume(ch, Math.round((audio.getVolume(ch) - 0.1) * 10) / 10));
      up.onTap(() => audio.setVolume(ch, Math.round((audio.getVolume(ch) + 0.1) * 10) / 10));
      mute.onTap(() => audio.toggleMute(ch));
      refresh();
      const offSettings = audio.on('settings', refresh);
      this.on('destroyed', offSettings);
      cy += 88;
    }

    await audio.ready;
    await audio.preload(audio.names('sfx'));
    const src = audio.hasManifest ? 'files from audio/manifest.json' : 'synthesized (no manifest; run pnpm audio)';
    this.showStatus(`${audio.names().length} sounds, ${src}`);
  }

  private showStatus(msg: string): void {
    const cur = this.audio.music;
    this.status.text = `${msg}${cur ? ` · music: ${cur}` : ''}`;
  }

  override onExit(): void {
    this.audio?.stopMusic(200);
  }
}

export const scenes: Record<string, SceneFactory> = {
  'audio-lab': () => new AudioLabScene(),
};
