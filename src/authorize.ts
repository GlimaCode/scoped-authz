import { ALLOW, deny, type Actor, type Decision, type Scope } from "./types.js";

/**
 * May this actor govern this scope?
 *
 * The order of these four checks is the entire point of the file.
 *
 * ── 1. NO ACTOR ───────────────────────────────────────────────────────────
 * Refuse. An unauthenticated request arrives with an empty scope set, and an
 * empty scope set must never be mistaken for "unrestricted".
 *
 * ── 2. OWNER, BEFORE ANY MENTION OF SCOPE ─────────────────────────────────
 * An owner's authority comes from the role. They are allowed here, before the
 * function has looked at `scopes` or `target` at all.
 *
 * This ordering is not a micro-optimisation, it is the guard against a
 * specific and very quiet failure: owners carry an EMPTY scope set, because
 * they have no scoped authority to enumerate. Ask "is the target in the
 * actor's scopes?" first and every owner in the system is instantly narrowed
 * from full access to none — and it will look like a permissions bug in
 * whichever screen someone happens to open first, not like what it is.
 *
 * ── 3. MEMBER ─────────────────────────────────────────────────────────────
 * Refuse. A member may well be able to see and edit their own work; that is a
 * different question, asked elsewhere. This one is about governing a scope.
 *
 * ── 4. SCOPED ADMIN ───────────────────────────────────────────────────────
 * Allowed only for a target that is present AND in their set. A missing target
 * is refused rather than waved through: "this action is not attached to any
 * scope" is a statement the caller has to make deliberately, by not calling
 * this function, instead of by passing null and hoping.
 *
 * An empty set means zero authority. It never means everything, and it never
 * falls back to some other field.
 */
export function authorizeScope(
  actor: Actor | null | undefined,
  scopes: ReadonlySet<Scope>,
  target: Scope | null | undefined,
): Decision {
  if (!actor) return deny("unauthenticated");
  if (actor.role === "owner") return ALLOW;
  if (actor.role === "member") return deny("role-has-no-administrative-authority");
  // An allow-list, not an else. TypeScript says Role is one of three, and the
  // actor on a real request came out of a database column or a token claim, so
  // at runtime it is whatever was written there. Reaching the scope test by
  // falling through means an unrecognised role is silently treated as a scoped
  // admin, and a typo in a seed script becomes an authority grant.
  if (actor.role !== "scoped-admin") return deny("unknown-role");

  if (target === null || target === undefined || target === "") return deny("no-target-scope");
  if (!scopes.has(target)) return deny("scope-not-in-actor-scope");
  return ALLOW;
}

/**
 * The same decision for several scopes at once — a bulk action, a filter, a
 * report spanning departments.
 *
 * ALL of them, not any: a bulk operation that half-succeeds because one target
 * was in scope is worse than one that is refused, because the caller has to
 * discover which half. An owner is still allowed by role, and an empty list is
 * refused rather than trivially allowed, on the grounds that "govern nothing"
 * is never a thing anyone means to ask for.
 */
export function authorizeScopes(
  actor: Actor | null | undefined,
  scopes: ReadonlySet<Scope>,
  targets: readonly Scope[],
): Decision {
  if (!actor) return deny("unauthenticated");
  if (actor.role === "owner") return ALLOW;
  if (actor.role === "member") return deny("role-has-no-administrative-authority");
  if (actor.role !== "scoped-admin") return deny("unknown-role");
  if (targets.length === 0) return deny("no-target-scope");

  for (const target of targets) {
    const decision = authorizeScope(actor, scopes, target);
    if (!decision.allowed) return decision;
  }
  return ALLOW;
}

/**
 * For narrowing a query rather than refusing a request.
 *
 * There are two different kinds of nothing here, and conflating them gives you
 * either a leak or a blank screen:
 *
 *   { narrow: false }             an owner — do not narrow, they see everything
 *   { narrow: true, scopes: [] }  narrow to nothing — this actor sees no rows
 *
 * This returned a `readonly Scope[] | null` at first, and the README claimed
 * the compiler made you say which you meant. It did not. `null` is falsy and
 * an array is not, so `governableScopes(...) ?? []` type-checks perfectly and
 * silently turns "show everything" into "show nothing" — the exact conflation
 * the type was supposed to prevent, in the idiom a reader is most likely to
 * reach for. One of this library's own tests was written that way.
 *
 * A discriminated union has no falsy member, so there is no `??` to reach for
 * and the narrowing has to be read before the array can be. That is the claim
 * actually being enforced.
 */
export type ScopeNarrowing =
  | { readonly narrow: false }
  | { readonly narrow: true; readonly scopes: readonly Scope[] };

const NARROW_TO_NOTHING: ScopeNarrowing = Object.freeze({ narrow: true as const, scopes: Object.freeze([]) });
const DO_NOT_NARROW: ScopeNarrowing = Object.freeze({ narrow: false as const });

export function governableScopes(
  actor: Actor | null | undefined,
  scopes: ReadonlySet<Scope>,
): ScopeNarrowing {
  if (!actor) return NARROW_TO_NOTHING;
  if (actor.role === "owner") return DO_NOT_NARROW;
  // Same allow-list rule as authorizeScope: an unrecognised role narrows to
  // nothing rather than inheriting whatever set it was handed.
  if (actor.role !== "scoped-admin") return NARROW_TO_NOTHING;
  return { narrow: true, scopes: [...scopes] };
}
