import type { Clock } from "./types.js";

/**
 * A bounded, time-limited cache — and, more importantly, a stated bound on how
 * stale an authorization answer may be.
 *
 * This is not here to make things fast. It is here so that the delay between
 * revoking someone's authority and that revocation taking effect is a number
 * somebody chose, wrote down, and can test. Both caches in this library are
 * given the SAME ttl by default for exactly that reason: one number to reason
 * about instead of two that drift apart.
 *
 * Eviction is wholesale. An LRU would be kinder to the hit rate and would add
 * a second data structure, a second set of invariants and a second thing to
 * get wrong for a cache whose miss path is a single indexed read. Clearing it
 * costs a burst of misses and cannot leak.
 */
export class TtlCache<V> {
  readonly #entries = new Map<string, { value: V; at: number }>();
  readonly #ttlMs: number;
  readonly #max: number;
  readonly #now: Clock;

  /** Counted so tests can assert the store was not consulted. */
  #hits = 0;
  #misses = 0;
  #clears = 0;

  constructor(options: { ttlMs: number; max: number; now: Clock }) {
    if (options.ttlMs < 0) throw new RangeError("ttlMs must not be negative");
    if (options.max < 1) throw new RangeError("max must be at least 1");
    this.#ttlMs = options.ttlMs;
    this.#max = options.max;
    this.#now = options.now;
  }

  /**
   * The cached value, or undefined if absent or too old.
   *
   * `keepIf` is the escape hatch for an answer that must never be walked back
   * by expiry: revocation uses it so that a token known to be revoked stays
   * revoked in this process regardless of the clock. See revocation.ts.
   */
  get(key: string, keepIf?: (value: V) => boolean): V | undefined {
    const hit = this.#entries.get(key);
    if (!hit) {
      this.#misses += 1;
      return undefined;
    }
    const fresh = this.#now() - hit.at < this.#ttlMs;
    if (fresh || keepIf?.(hit.value)) {
      this.#hits += 1;
      return hit.value;
    }
    this.#misses += 1;
    return undefined;
  }

  set(key: string, value: V): void {
    if (this.#entries.size >= this.#max && !this.#entries.has(key)) {
      this.#entries.clear();
      this.#clears += 1;
    }
    this.#entries.set(key, { value, at: this.#now() });
  }

  delete(key: string): void {
    this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }

  /** Hits, misses and wholesale clears since construction. For tests and metrics. */
  stats(): { hits: number; misses: number; clears: number; size: number } {
    return { hits: this.#hits, misses: this.#misses, clears: this.#clears, size: this.#entries.size };
  }
}
