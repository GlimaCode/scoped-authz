import type { Clock, RevocationStore } from "./types.js";
import { TtlCache } from "./ttlCache.js";
import { DEFAULT_MAX_ENTRIES, DEFAULT_TTL_MS } from "./scopeResolver.js";

/**
 * Is this token still allowed to act?
 *
 * The same shape as the scope resolver, given the same default envelope on
 * purpose: two caches with two different TTLs mean two different answers to
 * "how stale can this be", and nobody remembers both. One number.
 *
 * ── THE ONE ASYMMETRY ─────────────────────────────────────────────────────
 *
 * A cached "not revoked" expires. A cached "revoked" does NOT.
 *
 * Revocation is monotonic — a token that has been revoked is never un-revoked
 * — so letting a `true` lapse back into a store round trip buys nothing and
 * risks answering `false` if that round trip fails or the row has been swept.
 * Freshness protects you from a stale *permit*. There is no such thing as a
 * dangerous stale *refusal*, so refusals are kept.
 */
export class RevocationChecker {
  readonly #store: RevocationStore;
  readonly #cache: TtlCache<boolean>;

  constructor(options: {
    store: RevocationStore;
    now?: Clock;
    ttlMs?: number;
    maxEntries?: number;
  }) {
    this.#store = options.store;
    this.#cache = new TtlCache<boolean>({
      ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
      max: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      now: options.now ?? Date.now,
    });
  }

  /** `keepIf` is what makes a revoked answer permanent in this process. */
  async isRevoked(tokenId: string): Promise<boolean> {
    const cached = this.#cache.get(tokenId, (revoked) => revoked === true);
    if (cached !== undefined) return cached;

    const revoked = await this.#store.isRevoked(tokenId);
    this.#cache.set(tokenId, revoked);
    return revoked;
  }

  /**
   * Record a revocation the caller has just written to the store.
   *
   * This process stops honouring the token immediately; every other process
   * stops within the envelope. That difference is the whole reason the envelope
   * is a number you chose rather than a number you inherited.
   */
  markRevoked(tokenId: string): void {
    this.#cache.set(tokenId, true);
  }

  stats() {
    return this.#cache.stats();
  }
}
