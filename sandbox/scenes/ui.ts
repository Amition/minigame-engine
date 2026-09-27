import {
  bakeTexture,
  mountScreen,
  showDialog,
  showModal,
  showToast,
  textures,
  ui,
  type Dialog,
  type Modal,
  type Node,
  type SceneFactory,
  type UIChild,
  type UIIconSource,
} from '@engine';
import { DemoScene } from '../common';

function registerDemoTextures(): void {
  textures.getOrCreate('demo:card', () =>
    bakeTexture(
      320,
      200,
      (ctx, w, h) => {
        const sky = ctx.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, '#7dd3fc');
        sky.addColorStop(1, '#c4b5fd');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#fde68a';
        ctx.beginPath();
        ctx.arc(w * 0.78, h * 0.3, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#34d399';
        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.quadraticCurveTo(w * 0.25, h * 0.45, w * 0.55, h * 0.8);
        ctx.quadraticCurveTo(w * 0.8, h * 0.55, w, h * 0.75);
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      },
      { resolution: 2, key: 'demo:card' },
    ),
  );
}

const section = (title: string, children: UIChild[]) =>
  ui.panel({ gap: 'lg', padding: 'lg' }, [ui.text(title, { variant: 'h2', color: 'gold' }), ...children]);

// ---------------------------------------------------------------- ui-kit

class UIKitScene extends DemoScene {
  readonly title = 'UI Kit';

  protected build(): void {
    registerDemoTextures();
    const progress = ui.progress({ id: 'kit-progress', value: 0.65, label: true });
    const volume = ui.text('Volume 70%', { variant: 'caption' });
    mountScreen(
      this,
      ui.scroll({ id: 'kit-scroll', fill: 'bg', padding: [24, 24, 64, 24], gap: 'lg' }, [
        section('Buttons', [
          ui.row({ wrap: true, gap: 'md', justify: 'center' }, [
            ui.button('Primary'),
            ui.button('Secondary', { variant: 'secondary' }),
            ui.button('Success', { variant: 'success' }),
            ui.button('Danger', { variant: 'danger' }),
            ui.button('Warning', { variant: 'warning' }),
            ui.button('Neutral', { variant: 'neutral' }),
            ui.button('Ghost', { variant: 'ghost' }),
            ui.button('Disabled', { disabled: true }),
          ]),
          ui.row({ gap: 'md', justify: 'center', align: 'end' }, [
            ui.button('Small', { size: 'sm', variant: 'secondary' }),
            ui.button('Medium', { variant: 'secondary' }),
            ui.button('Large', { size: 'lg', variant: 'secondary' }),
          ]),
          ui.row({ gap: 'md', justify: 'center' }, [
            ui.button({ id: 'kit-play', text: 'Play', icon: 'play', size: 'lg', variant: 'success' }),
            ui.button({ text: 'Shop', icon: 'shop', size: 'lg', variant: 'primary', badge: 3 }),
          ]),
          ui.row({ gap: 'lg', justify: 'center', wrap: true }, [
            ui.iconButton({ icon: 'settings', label: 'Settings' }),
            ui.iconButton({ icon: 'pause', label: 'Pause', variant: 'secondary' }),
            ui.iconButton({ icon: 'sound', label: 'Sound', variant: 'success' }),
            ui.iconButton({ icon: 'home', label: 'Home', variant: 'primary', shape: 'rounded' }),
            ui.iconButton({ icon: 'mail', label: 'Mail', variant: 'neutral', badge: 'dot' }),
            ui.iconButton({ icon: 'close', label: 'Close', variant: 'danger', size: 'sm' }),
          ]),
        ]),
        section('Text', [
          ui.title('Candy Quest'),
          ui.text('Heading 1', { variant: 'h1' }),
          ui.text('Heading 2', { variant: 'h2' }),
          ui.text('Body text wraps automatically to the width of its container, so long descriptions stay readable on every screen.', {
            variant: 'body',
          }),
          ui.text('Caption text for hints and secondary information', { variant: 'caption' }),
          ui.richText('Collect [color=gold][b]3 stars[/b][/color] [icon=star] to unlock [color=#5eead4]bonus levels[/color] and win [size=40][b]500[/b][/size] [icon=coin] coins!'),
          ui.panel({ variant: 'inset', padding: 'md' }, [
            ui.text('This long label shrinks its font to stay on one line', { size: 34, weight: 'bold', autoFit: 20, align: 'center' }),
          ]),
        ]),
        section('Controls', [
          progress,
          ui.progress({ value: 0.3, color: 'danger', thickness: 24 }),
          ui.row({ gap: 'md' }, [ui.icon('sound', { size: 44, color: 'textDim' }), ui.slider({ id: 'kit-volume', value: 0.7, grow: 1, onChange: (v) => (volume.text = `Volume ${Math.round(v * 100)}%`) })]),
          volume,
          ui.row({ gap: 'lg', justify: 'between' }, [
            ui.row({ gap: 'md' }, [ui.toggle({ id: 'kit-toggle', value: true }), ui.text('Music')]),
            ui.row({ gap: 'md' }, [ui.toggle({ value: false }), ui.text('Haptics')]),
          ]),
          ui.checkbox({ id: 'kit-check', text: 'Remember me', checked: true }),
          ui.segmented({ id: 'kit-seg', options: ['Easy', 'Normal', 'Hard'], selected: 1 }),
        ]),
        section('Display', [
          ui.row({ justify: 'between' }, [ui.stars({ value: 1, size: 52 }), ui.stars({ value: 2, size: 52 }), ui.stars({ value: 3, size: 52 })]),
          ui.row({ gap: 'lg', justify: 'center' }, [
            ui.badge({ dot: true }),
            ui.badge({ count: 5 }),
            ui.badge({ count: 42, color: 'secondary', textColor: 'onSecondary' }),
            ui.badge({ count: 120 }),
          ]),
          ui.row({ gap: 'md', justify: 'center', wrap: true }, [
            ...(['coin', 'gem', 'heart', 'energy', 'star', 'trophy', 'gift', 'lock', 'music', 'video', 'shop', 'user'] as const).map((n) =>
              ui.icon(n, { size: 56, color: n === 'heart' ? 'danger' : n === 'energy' ? 'warning' : 'text' }),
            ),
          ]),
          ui.row({ gap: 'md', justify: 'center' }, [
            ui.image('demo:card', { width: 260, height: 160, fit: 'cover', radius: 'md' }),
            ui.image('demo:card', { width: 160, height: 160, fit: 'contain', fill: 'track', radius: 'md' }),
          ]),
        ]),
        section('Tabs & Grid', [
          ui.tabs({ labels: ['Levels', 'About'], id: 'kit-tabs' }, [
            ui.grid({ columns: 4, gap: 'md', cellAspect: 1 }, levelButtons(12)),
            ui.column({ gap: 'sm' }, [
              ui.text('Tabs switch pages; hidden pages take no space.', { color: 'textDim' }),
              ui.text('Grid cells are equal width.', { color: 'textDim' }),
            ]),
          ]),
        ]),
        section('Overlays', [
          ui.row({ gap: 'md', justify: 'center', wrap: true }, [
            ui.button('Toast', { id: 'kit-toast', variant: 'secondary', onTap: () => showToast('Progress saved!', { icon: 'check', variant: 'success' }) }),
            ui.button('Dialog', {
              id: 'kit-dialog',
              variant: 'secondary',
              onTap: () =>
                showDialog({
                  title: 'Quit level?',
                  message: 'You will lose the 3 moves you have left.',
                  buttons: [
                    { text: 'Stay', variant: 'neutral', action: 'stay' },
                    { text: 'Quit', variant: 'danger', action: 'quit' },
                  ],
                }),
            }),
            ui.button('Sheet', {
              id: 'kit-sheet',
              variant: 'secondary',
              onTap: () =>
                showModal({ title: 'Daily Gift', animation: 'sheet' }, [
                  ui.text('Come back tomorrow for another gift!', { align: 'center', color: 'textDim' }),
                  ui.button({ text: 'Claim', icon: 'gift', size: 'lg', variant: 'success', alignSelf: 'center' }),
                ]),
            }),
          ]),
        ]),
      ]),
      { area: () => this.content },
    );
  }
}

function levelButtons(n: number): Node[] {
  const out: Node[] = [];
  for (let i = 0; i < n; i++) {
    const locked = i >= 8;
    out.push(
      ui.button({
        text: locked ? '' : String(i + 1),
        icon: locked ? 'lock' : undefined,
        iconSize: 52,
        variant: locked ? 'neutral' : i < 5 ? 'primary' : 'secondary',
        disabled: locked,
        size: 'lg',
        padding: 0,
        minWidth: 0,
        radius: 28,
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------- ui-menu

const currency = (id: string, icon: UIIconSource, value: string, label: string) =>
  ui.row({ id, fill: 'track', radius: 'full', padding: [6, 6, 6, 8], gap: 'sm', border: { color: 'border', width: 2 } }, [
    ui.icon(icon, { size: 48 }),
    ui.text(value, { weight: 'bold', size: 30, minWidth: 80 }),
    ui.iconButton({ icon: 'plus', label, size: 'sm', variant: 'success' }),
  ]);

const menuTile = (id: string, icon: UIIconSource, text: string, badge?: number | 'dot') =>
  ui.column({ align: 'center', gap: 'xs' }, [
    ui.iconButton({ id, icon, label: text, size: 'lg', variant: 'secondary', shape: 'rounded', ...(badge !== undefined ? { badge } : {}) }),
    ui.text(text, { size: 24, weight: 'bold', align: 'center' }),
  ]);

class UIMenuScene extends DemoScene {
  readonly title = 'UI Menu';

  protected build(params?: unknown): void {
    const open = (params as { open?: string } | undefined)?.open;
    mountScreen(
      this,
      ui.column(
        { id: 'menu', gradient: ['#3b2a8f', '#1a1b3d'], padding: ['lg', 'lg', 'xl', 'lg'], gap: 'lg', align: 'stretch' },
        [
          ui.row({ gap: 'sm', justify: 'between' }, [
            currency('coins', 'coin', '12,480', 'Buy coins'),
            currency('gems', 'gem', '85', 'Buy gems'),
            ui.iconButton({ id: 'settings', icon: 'settings', label: 'Settings', size: 'md', onTap: () => this.openSettings() }),
          ]),
          ui.spacer(),
          ui.column({ align: 'center', gap: 'sm' }, [
            ui.title('Candy Quest', { size: 96 }),
            ui.text('Match sweets. Collect stars.', { variant: 'h2', color: 'textDim', align: 'center' }),
          ]),
          ui.spacer(),
          ui.stack({ alignSelf: 'center' }, [
            ui.view({ width: 300, height: 300, radius: 'full', gradient: ['#ffcf5c', '#ff8a3d'], border: { color: '#fff3c4', width: 8 }, shadow: 'lg' }),
            ui.column({ align: 'center', gap: 0 }, [
              ui.text('LEVEL', { size: 34, weight: 'bold', color: '#6b2c00' }),
              ui.text('12', { size: 120, weight: 'bold', color: '#ffffff', stroke: { color: '#b4470f', width: 10 }, lineHeight: 1 }),
              ui.stars({ value: 2, size: 40 }),
            ]),
          ]),
          ui.spacer(),
          ui.button({ id: 'play', text: 'PLAY', icon: 'play', size: 'xl', variant: 'success', alignSelf: 'center', minWidth: 440, onTap: () => this.openResult() }),
          ui.row({ gap: 'md', align: 'center' }, [
            ui.icon('energy', { size: 52, color: 'warning' }),
            ui.progress({ id: 'energy', value: 4, max: 5, label: true, color: 'warning', grow: 1, thickness: 40 }),
            ui.text('29:59', { variant: 'caption', color: 'textDim' }),
          ]),
          ui.row({ justify: 'evenly' }, [
            menuTile('shop', 'shop', 'Shop', 'dot'),
            menuTile('rank', 'trophy', 'Rank'),
            menuTile('daily', 'calendar', 'Daily', 1),
            menuTile('friends', 'user', 'Friends', 3),
          ]),
        ],
      ),
      { area: () => this.content },
    );
    if (open === 'settings') this.openSettings();
    else if (open === 'result') this.openResult();
  }

  openSettings(): Modal {
    return showModal({ id: 'settings-modal', title: 'Settings' }, [
      ui.column({ gap: 'md' }, [
        settingRow('music', 'Music', true),
        settingRow('sound', 'Sound FX', true),
        settingRow('vibrate', 'Vibration', false),
      ]),
      ui.divider(),
      ui.column({ gap: 'sm' }, [ui.text('Volume', { variant: 'caption' }), ui.slider({ id: 'volume', value: 0.8 })]),
      ui.column({ gap: 'sm' }, [ui.text('Language', { variant: 'caption' }), ui.segmented({ id: 'language', options: ['English', '\u4e2d\u6587'] })]),
      ui.button({ id: 'settings-done', text: 'Done', size: 'lg', variant: 'primary', onTap: () => this.closeTop() }),
    ]);
  }

  openResult(): Dialog {
    return showDialog({
      id: 'result',
      title: 'Level Complete!',
      closeButton: true,
      closeOnBackdrop: false,
      buttons: [
        { id: 'double', text: 'x2', icon: 'video', variant: 'secondary', action: 'double' },
        { id: 'next', text: 'Next', icon: 'next', iconRight: true, variant: 'success', action: 'next' },
      ],
    }, [
      ui.stars({ id: 'result-stars', value: 3, size: 96, animate: true, alignSelf: 'center' }),
      ui.richText('Score [b][color=gold]12,480[/color][/b]', { size: 40, align: 'center' }),
      ui.row({ justify: 'center', gap: 'lg' }, [reward('coin', '+120'), reward('gem', '+5'), reward('energy', '+1')]),
    ]);
  }

  private closeTop(): void {
    this.game.overlay.findAll<Modal>('Modal').forEach((m) => m.close('done'));
  }
}

const settingRow = (id: string, text: string, on: boolean) =>
  ui.row({ justify: 'between', gap: 'md' }, [ui.text(text, { variant: 'body' }), ui.toggle({ id, value: on })]);

const reward = (icon: UIIconSource, text: string) =>
  ui.column({ align: 'center', gap: 'xs', fill: 'track', radius: 'lg', padding: ['sm', 'lg'], minWidth: 140 }, [
    ui.icon(icon, { size: 56, color: icon === 'energy' ? 'warning' : 'text' }),
    ui.text(text, { weight: 'bold', size: 32 }),
  ]);

// ---------------------------------------------------------------- ui-list

interface MailItem {
  icon: UIIconSource;
  color: string;
  title: string;
  sub: string;
  unread: boolean;
  claimed: boolean;
}

const KINDS: { icon: UIIconSource; color: string; title: string }[] = [
  { icon: 'gift', color: 'danger', title: 'Daily gift' },
  { icon: 'coin', color: 'primary', title: 'Coins from a friend' },
  { icon: 'energy', color: 'warning', title: 'Energy refill' },
  { icon: 'gem', color: 'secondary', title: 'Gem bonus' },
  { icon: 'trophy', color: 'success', title: 'Weekly rank reward' },
];

class UIListScene extends DemoScene {
  readonly title = 'UI List';
  private items: MailItem[] = [];

  protected build(): void {
    for (let i = 0; i < 200; i++) {
      const k = KINDS[(i * 7 + (i >> 2)) % KINDS.length]!;
      this.items.push({
        ...k,
        title: `${k.title} #${i + 1}`,
        sub: `${(i % 23) + 1}h ago \u00b7 from Player${(i * 37) % 900}`,
        unread: i % 3 === 0,
        claimed: i % 5 === 4,
      });
    }
    const unread = () => this.items.filter((m) => m.unread).length;
    const badge = ui.badge({ id: 'unread', count: unread() });
    const list = ui.list({
      id: 'mail-list',
      count: this.items.length,
      itemHeight: 132,
      gap: 12,
      padding: [8, 24, 24, 24],
      grow: 1,
      renderItem: (i) => this.row(i, () => (badge.count = unread())),
    });
    mountScreen(
      this,
      ui.column({ fill: 'bg', gap: 0 }, [
        ui.row({ padding: ['md', 'lg'], gap: 'md' }, [
          ui.text('Inbox', { variant: 'h1' }),
          badge,
          ui.spacer(),
          ui.button({ id: 'claim-all', text: 'Claim all', icon: 'gift', size: 'sm', variant: 'success', onTap: () => this.claimAll(list) }),
        ]),
        ui.view({ padding: [0, 'lg', 'md', 'lg'] }, [ui.segmented({ id: 'mail-filter', options: ['All', 'Gifts', 'System'] })]),
        list,
      ]),
      { area: () => this.content },
    );
  }

  private claimAll(list: { refresh(): void }): void {
    for (const m of this.items) {
      m.claimed = true;
      m.unread = false;
    }
    list.refresh();
    showToast('All rewards claimed!', { icon: 'check', variant: 'success' });
  }

  private row(i: number, changed: () => void): Node {
    const m = this.items[i]!;
    const claim = ui.button({
      text: m.claimed ? 'Done' : 'Claim',
      size: 'sm',
      variant: m.claimed ? 'neutral' : 'success',
      disabled: m.claimed,
      minWidth: 132,
      onTap: () => {
        m.claimed = true;
        m.unread = false;
        claim.text = 'Done';
        claim.setVariant('neutral');
        claim.disabled = true;
        dot.visible = false;
        changed();
      },
    });
    const dot = ui.badge({ dot: true, position: 'absolute', top: -2, right: -2, visible: m.unread });
    return ui.row({ id: `mail-${i}`, fill: 'surface', radius: 'lg', padding: [0, 'md'], gap: 'md', data: { index: i } }, [
      ui.stack({ width: 84, height: 84, fill: m.color, radius: 'full', shrink: 0 }, [ui.icon(m.icon, { size: 50, color: '#ffffff' }), dot]),
      ui.column({ grow: 1, shrink: 1, gap: 2 }, [
        ui.text(m.title, { weight: 'bold', size: 30, maxLines: 1 }),
        ui.text(m.sub, { variant: 'caption', maxLines: 1 }),
      ]),
      claim,
    ]);
  }
}

export const scenes: Record<string, SceneFactory> = {
  'ui-kit': () => new UIKitScene(),
  'ui-menu': () => new UIMenuScene(),
  'ui-list': () => new UIListScene(),
};
