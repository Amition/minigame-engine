type Listener = { fn: (e: any) => void; once: boolean };

/**
 * Minimal typed event emitter. Every event carries a single payload value.
 * `M` maps event names to payload types; unknown names are allowed with `any` payloads.
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
    const i = list.findIndex((l) => l.fn === fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends keyof M & string>(type: K, e: M[K]): void;
  emit(type: string, e?: unknown): void;
  emit(type: string, e?: unknown): void {
    const list = this.listeners?.get(type);
    if (!list || list.length === 0) return;
    for (const l of list.slice()) {
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
