import { Emitter } from '../core/emitter';
import type { Node } from '../scene/node';

export interface UIEventMap {
  /** A control was activated (button tap, toggle flip, segment pick...). Hook sfx/haptics here. */
  tap: Node;
  /** A value control changed (Slider, Toggle, Checkbox, SegmentedControl, Tabs). */
  change: { node: Node; value: unknown };
  /** A string `onTap` (e.g. from a JSON spec) fired: `uiEvents.on('action', ({ name }) => ...)`. */
  action: { name: string; node: Node };
}

/** Global UI event bus (sounds, analytics, JSON-spec actions). */
export const uiEvents = new Emitter<UIEventMap>();
