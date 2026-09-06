import type { RevocationStore, Scope, ScopeStore } from "../src/types.js";

/**
 * A clock you advance by hand.
 *
 * Not a sleep. A test that proves a fifteen-second envelope by sleeping for
 * fifteen seconds is a test nobody runs twice, and one that sleeps for five
 * milliseconds against a five-millisecond TTL is a test that fails on a busy
 * machine. Injecting the clock is what makes the envelope assertable at all.
 */
export function manualClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** A scope store that counts how often it was asked, and can change its mind. */
export class CountingScopeStore implements ScopeStore {
  calls = 0;
  #rows = new Map<string, readonly Scope[]>();

  constructor(rows: Record<string, readonly Scope[]> = {}) {
    for (const [id, scopes] of Object.entries(rows)) this.#rows.set(id, scopes);
  }

  /** Change what the source of truth says, as an administrator would. */
  setScopes(actorId: string, scopes: readonly Scope[]): void {
    this.#rows.set(actorId, scopes);
  }

  async scopesFor(actorId: string): Promise<readonly Scope[]> {
    this.calls += 1;
    return this.#rows.get(actorId) ?? [];
  }
}

/** A revocation store that counts reads and can forget a row, as a sweep would. */
export class CountingRevocationStore implements RevocationStore {
  calls = 0;
  #revoked = new Set<string>();

  constructor(revoked: readonly string[] = []) {
    for (const id of revoked) this.#revoked.add(id);
  }

  revoke(tokenId: string): void {
    this.#revoked.add(tokenId);
  }

  /** The row is swept, or the read fails and the store answers "no". */
  forget(tokenId: string): void {
    this.#revoked.delete(tokenId);
  }

  async isRevoked(tokenId: string): Promise<boolean> {
    this.calls += 1;
    return this.#revoked.has(tokenId);
  }
}
