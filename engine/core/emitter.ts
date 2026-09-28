type Listener = { fn: (e: any) => void; once: boolean };

/**
 * Minimal typed event emitter. Every event carries a single payload value.
 * `M` maps event names to payload types; unknown names are allowed with `any` payloads.
 *
 * Listener lists are copy-on-write for removals: `emit()` walks the list it started with, so listeners added
 * during an emit run from the next emit on and listeners removed during it still get the current event.
 */
export class Emitter<M extends object = Record<string, unknown>> {
  private listeners: Map<string, Listener[]> | null = null;

  on<K extends keyof M & string>(type: K, fn: (e: M[K]) => void): () => void;
  on(type: string, fn: (e: any) => void): () => void;
  on(type: string, fn: (e: any) => void): () => void {
    return this.add(type, fn, false);
  }

  once<K extends keyof M & string>(type: K, fn: (e: M[K]) => void): () => void;
  once(type: string, fn: (e: any) => void): () => void;
  once(type: string, fn: (e: any) => void): () => void {
    return this.add(type, fn, true);
  }

  off(type: string, fn?: (e: any) => void): void {
    const list = this.listeners?.get(type);
    if (!list) return;
    if (!fn) {
      this.listeners!.delete(type);
      return;
    }
    let i = 0;
    while (i < list.length && list[i]!.fn !== fn) i++;
    if (i === list.length) return;
    if (list.length === 1) {
      this.listeners!.delete(type);
      return;
    }
    const next = new Array<Listener>(list.length - 1);
    for (let j = 0, k = 0; j < list.length; j++) if (j !== i) next[k++] = list[j]!;
    this.listeners!.set(type, next);
  }

  emit<K extends keyof M & string>(type: K, e: M[K]): void;
  emit(type: string, e?: unknown): void;
  emit(type: string, e?: unknown): void {
    const list = this.listeners?.get(type);
    if (!list) return;
    for (let i = 0, n = list.length; i < n; i++) {
      const l = list[i]!;
      if (l.once) this.off(type, l.fn);
      l.fn(e);
    }
  }

  hasListeners(type: string): boolean {
    return (this.listeners?.get(type)?.length ?? 0) > 0;
  }

  removeAllListeners(): void {
    this.listeners = null;
  }

  private add(type: string, fn: (e: any) => void, once: boolean): () => void {
    if (!this.listeners) this.listeners = new Map();
    let list = this.listeners.get(type);
    if (!list) this.listeners.set(type, (list = []));
    list.push({ fn, once });
    return () => this.off(type, fn);
  }
}
