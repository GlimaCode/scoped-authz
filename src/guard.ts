import { authorizeScope } from "./authorize.js";
import type { RevocationChecker } from "./revocation.js";
import type { ScopeResolver } from "./scopeResolver.js";
import { deny, type Actor, type Decision, type Scope } from "./types.js";

/**
 * The whole path, in the order it has to happen: is the session still valid,
 * then what may this actor govern, then may they govern THIS.
 *
 * Two awaits, both cached, both bounded by the same envelope. Everything after
 * them is synchronous, which is deliberate — a gate that has to be awaited is
 * a gate somebody eventually forgets to await, and a forgotten await on a
 * function returning a Decision object is truthy, so it fails OPEN. Resolving
 * once at the edge and passing the resolved set down keeps every gate a plain
 * boolean expression that cannot be got wrong that way.
 */
export class Guard {
  readonly #revocation: RevocationChecker;
  readonly #scopes: ScopeResolver;

  constructor(options: { revocation: RevocationChecker; scopes: ScopeResolver }) {
    this.#revocation = options.revocation;
    this.#scopes = options.scopes;
  }

  /**
   * Resolve a request's actor once, at the edge.
   *
   * Returns null when the session has been revoked, so the caller stops. The
   * returned scope set is empty for owners and members alike — meaningless for
   * the first, restrictive for the second, and `authorizeScope` is what knows
   * the difference.
   */
  async resolve(
    actor: Actor,
    tokenId: string,
  ): Promise<{ actor: Actor; scopes: ReadonlySet<Scope> } | null> {
    if (await this.#revocation.isRevoked(tokenId)) return null;
    const scopes = await this.#scopes.resolve(actor.role, actor.id);
    return { actor, scopes };
  }

  /** Convenience for a one-shot check; prefer resolve() once plus many sync gates. */
  async check(actor: Actor, tokenId: string, target: Scope | null): Promise<Decision> {
    const resolved = await this.resolve(actor, tokenId);
    if (!resolved) return deny("session-revoked");
    return authorizeScope(resolved.actor, resolved.scopes, target);
  }
}
