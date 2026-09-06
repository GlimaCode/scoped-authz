/**
 * The vocabulary. Three roles, one question, two stores.
 *
 * The question this kernel answers is always the same:
 *
 *     may this actor GOVERN this scope?
 *
 * Not "may they see it", not "may they edit this one row" — those are the host
 * application's business and depend on things a kernel cannot know. What a
 * kernel can own is the part that is easy to get subtly, silently wrong, and
 * that is the interaction between a role and a scope.
 */

/**
 * A scope is whatever unit of authority the host application divides itself
 * into: a department, a region, a tenant, a workspace. It is a plain string on
 * purpose. An enum here would make this library know something about your
 * business, and the one thing it should be is ignorant of it.
 */
export type Scope = string;

/**
 * `owner` — authority comes from the role and is never scoped.
 * `scoped-admin` — authority only inside an explicit, revocable set of scopes.
 * `member` — no administrative authority at all.
 */
export type Role = "owner" | "scoped-admin" | "member";

export type Actor = {
  id: string;
  role: Role;
};

/** The empty scope set: ZERO authority. Shared so callers never allocate one. */
export const NO_SCOPE: ReadonlySet<Scope> = new Set<Scope>();

/**
 * Where the scopes actually live.
 *
 * A store, not a token claim — see the README. Implement it over whatever you
 * already have; the kernel only ever reads, and only for one actor at a time.
 */
export type ScopeStore = {
  /**
   * Every scope this actor administers, or an empty list.
   *
   * ROLE-BLIND ON PURPOSE. This is a raw lookup of the source of truth.
   * Deciding *who should be asked* belongs to the resolver, not here — a store
   * that second-guessed the role would have to be kept in step with the role
   * rules, and two places that must agree eventually will not.
   */
  scopesFor(actorId: string): Promise<readonly Scope[]>;
};

/** Where revoked token ids live. Same shape, same reasoning. */
export type RevocationStore = {
  isRevoked(tokenId: string): Promise<boolean>;
};

/**
 * Injected clock, in milliseconds.
 *
 * Every cache in here is a staleness envelope, and an envelope you cannot
 * advance in a test is an envelope you are only claiming to have. Tests pass a
 * counter; production passes Date.now.
 */
export type Clock = () => number;

/** Why a request was refused. Never shown to the actor; logged, and asserted on. */
export type Denial =
  | "unauthenticated"
  | "role-has-no-administrative-authority"
  | "scope-not-in-actor-scope"
  | "no-target-scope";

export type Decision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: Denial };

export const ALLOW: Decision = Object.freeze({ allowed: true as const });

export function deny(reason: Denial): Decision {
  return Object.freeze({ allowed: false as const, reason });
}
