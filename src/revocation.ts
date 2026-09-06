import type { Clock, RevocationStore } from "./types.js";
import { TtlCache } from "./ttlCache.js";
import { DEFAULT_MAX_ENTRIES, DEFAULT_TTL_MS } from "./scopeResolver.js";

/**
 * Is this token still allowed to act?
 *
 * Permits are cached with the same envelope as the scope resolver, on purpose:
 * two caches with two different TTLs mean two different answers to "how stale
 * can this be", and nobody remembers both. One number.
 *
 * ── THE ONE ASYMMETRY, AND WHERE IT LIVES ─────────────────────────────────
 *
 * A cached "not revoked" expires. A known "revoked" does NOT.
 *
 * Revocation is monotonic — a token that has been revoked is never un-revoked
 * — so letting a refusal lapse back into a store round trip buys nothing and
 * risks answering `false` if that round trip fails or the row has been swept.
 * Freshness protects you from a stale *permit*. There is no such thing as a
 * dangerous stale *refusal*.
 *
 * Refusals therefore live in `#known`, a plain Set, and NOT in the TtlCache.
 * That is the fix for a real defect rather than a stylistic preference. The
 * first version kept refusals in the cache behind a `keepIf` predicate, which
 * survived expiry and did not survive eviction: `TtlCache.set` clears the whole
 * map on overflow. Measured at the shipped defaults with the clock frozen, a
 * revoked token silently un-revoked itself after 5,000 unrelated lookups, and
 * the suite stayed green because it only advanced the clock.
 *
 * ── WHAT BOUNDS `#known` ──────────────────────────────────────────────────
 *
 * It grows only with tokens actually found revoked, so in a process that
 * revokes a hundred sessions a day it holds a hundred strings. `maxKnown`
 * exists for the pathological case, and when it is reached the set STOPS
 * ACCEPTING new ids rather than dropping old ones. Overflow therefore
 * degrades to "ask the store every time" for tokens revoked after that point,
 * which is the honest weaker answer, and never to "forget that this token was
 * revoked", which is the dangerous one. `stats()` reports whether it happened.
 */
export const DEFAULT_MAX_KNOWN_REVOKED = 100_000;

export class RevocationChecker {
  readonly #store: RevocationStore;
  /** Permits only. Refusals are never put here — see above. */
  readonly #permits: TtlCache<false>;
  /** Refusals. Monotonic, never evicted. */
  readonly #known = new Set<string>();
  readonly #maxKnown: number;
  #overflowed = false;

  constructor(options: {
    store: RevocationStore;
    now?: Clock;
    ttlMs?: number;
    maxEntries?: number;
    maxKnown?: number;
  }) {
    this.#store = options.store;
    this.#maxKnown = options.maxKnown ?? DEFAULT_MAX_KNOWN_REVOKED;
    this.#permits = new TtlCache<false>({
      ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
      max: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      now: options.now ?? Date.now,
    });
  }

  async isRevoked(tokenId: string): Promise<boolean> {
    if (this.#known.has(tokenId)) return true;
    if (this.#permits.get(tokenId) === false) return false;

    const revoked = await this.#store.isRevoked(tokenId);
    if (revoked) this.#remember(tokenId);
    else this.#permits.set(tokenId, false);
    return revoked;
  }

  /**
   * Record a revocation the caller has just written to the store.
   *
   * This process stops honouring the token immediately; every other process
   * stops within the envelope. That difference is the whole reason the envelope
   * is a number you chose rather than one you inherited.
   */
  markRevoked(tokenId: string): void {
    this.#remember(tokenId);
  }

  #remember(tokenId: string): void {
    if (this.#known.size >= this.#maxKnown && !this.#known.has(tokenId)) {
      // Refuse to grow rather than drop somebody. The caller still gets `true`
      // for this call; later calls fall through to the store, which is the
      // weaker answer and not the wrong one.
      this.#overflowed = true;
      return;
    }
    this.#known.add(tokenId);
    // A token cannot be both permitted and revoked. Dropping the stale permit
    // costs nothing and removes a state that should never be readable.
    this.#permits.delete(tokenId);
  }

  stats(): {
    hits: number;
    misses: number;
    clears: number;
    size: number;
    knownRevoked: number;
    knownRevokedOverflowed: boolean;
  } {
    return {
      ...this.#permits.stats(),
      knownRevoked: this.#known.size,
      knownRevokedOverflowed: this.#overflowed,
    };
  }
}
