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
  if (targets.length === 0) return deny("no-target-scope");

  for (const target of targets) {
    const decision = authorizeScope(actor, scopes, target);
    if (!decision.allowed) return decision;
  }
  return ALLOW;
}

/**
 * The scopes an actor may govern, for narrowing a query rather than refusing a
 * request.
 *
 * Returns null for an owner — meaning "do not narrow", which is different from
 * an empty array meaning "narrow to nothing, this actor sees no rows". Callers
 * that conflate the two produce either a leak or an empty screen, so the two
 * are different types and the compiler makes you say which you meant.
 */
export function governableScopes(
  actor: Actor | null | undefined,
  scopes: ReadonlySet<Scope>,
): readonly Scope[] | null {
  if (!actor) return [];
  if (actor.role === "owner") return null;
  if (actor.role === "member") return [];
  return [...scopes];
}
