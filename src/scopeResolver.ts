import { NO_SCOPE, type Clock, type Role, type Scope, type ScopeStore } from "./types.js";
import { TtlCache } from "./ttlCache.js";

export const DEFAULT_TTL_MS = 15_000;
export const DEFAULT_MAX_ENTRIES = 5_000;

/**
 * Resolves the set of scopes an actor administers.
 *
 * ── WHY A STORE LOOKUP AND NOT AN ARRAY IN THE TOKEN ──────────────────────
 *
 * A token cannot be un-issued. Put the scope list in the access token and
 * taking a scope away from someone does nothing until that token expires: they
 * keep the authority you just removed, on every gate at once, for the whole
 * remaining lifetime of the token. Fifteen minutes is a common lifetime. Fifteen
 * minutes is a long time to be wrong about who may administer what.
 *
 * The usual objection is cost — "now every authorized request hits the
 * database". It does not survive contact with a real codebase. Any system that
 * can revoke a session at all already checks something server-side on the
 * authenticated path (a blocklist, a session row, a version counter), so this
 * adds no round trip *in kind*, and the one it does add is a single indexed
 * read of one row per administered scope, behind the cache below.
 *
 * If your system genuinely has no server-side check on that path, then it
 * cannot revoke a session either, and the scope list is not your first problem.
 *
 * ── ROLE FIRST, ALWAYS ────────────────────────────────────────────────────
 *
 * `resolve` returns the empty set for an owner without touching the store, and
 * that empty set is MEANINGLESS rather than restrictive: an owner is allowed by
 * role, before anything asks about scope. Getting this backwards is the bug
 * this library exists to prevent, and `authorize` is written so it cannot
 * happen — see authorize.ts.
 */
export class ScopeResolver {
  readonly #store: ScopeStore;
  readonly #cache: TtlCache<ReadonlySet<Scope>>;

  constructor(options: {
    store: ScopeStore;
    now?: Clock;
    ttlMs?: number;
    maxEntries?: number;
  }) {
    this.#store = options.store;
    this.#cache = new TtlCache<ReadonlySet<Scope>>({
      ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
      max: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      now: options.now ?? Date.now,
    });
  }

  /**
   * The scopes this actor administers, given their role.
   *
   * An owner and a member are answered without reading the store: neither has a
   * scoped authority to look up, so neither pays for one. This is the claim the
   * cost objection above rests on, and there is a test that counts store calls
   * to keep it true.
   *
   * A scoped-admin with no rows administers NOTHING. There is deliberately no
   * fallback to some other field — a fallback makes the store advisory, and an
   * advisory source of authority silently re-grants what was revoked.
   */
  async resolve(role: Role, actorId: string): Promise<ReadonlySet<Scope>> {
    if (role !== "scoped-admin") return NO_SCOPE;
    return this.scopesOf(actorId);
  }

  /**
   * Raw lookup, role-blind, cached.
   *
   * Exposed because some callers legitimately want "what does this row say"
   * without a role in hand — an admin screen listing someone's scopes, a
   * background job. Do not use it to make an access decision; use `resolve`,
   * then `authorize`.
   */
  async scopesOf(actorId: string): Promise<ReadonlySet<Scope>> {
    const cached = this.#cache.get(actorId);
    if (cached) return cached;

    const rows = await this.#store.scopesFor(actorId);
    const scopes: ReadonlySet<Scope> = rows.length === 0 ? NO_SCOPE : new Set(rows);
    this.#cache.set(actorId, scopes);
    return scopes;
  }

  /**
   * Forget one actor, or all of them.
   *
   * Call it after writing scopes so the actor who made the change sees it
   * immediately rather than waiting out the envelope. Other processes still
   * wait — that is what the envelope is.
   */
  invalidate(actorId?: string): void {
    if (actorId === undefined) this.#cache.clear();
    else this.#cache.delete(actorId);
  }

  stats() {
    return this.#cache.stats();
  }
}
