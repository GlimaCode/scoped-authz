# scoped-authz

> Built by [GlimaCode](https://glimacode.com) — a two-developer web studio.

Role-and-scope authorization for systems where some administrators govern
everything and others govern only part of it — a department, a region, a
tenant, a workspace.

Zero runtime dependencies. TypeScript, Node 20+. 287 lines of code, rather more
of commentary, and 44 tests. It plugs into whatever you already store users in:
you implement two one-method interfaces, it owns the decision.

```bash
npm install @glimacode/scoped-authz
```

---

## The problem it solves

Scoped administration looks trivial and fails in ways that are all quiet — no
crash, no error log, just the wrong answer.

```ts
import { Guard, ScopeResolver, RevocationChecker, authorizeScope } from "@glimacode/scoped-authz";

const guard = new Guard({
  scopes: new ScopeResolver({ store: myScopeStore }),
  revocation: new RevocationChecker({ store: myRevocationStore }),
});

// Once, at the edge of the request.
const session = await guard.resolve(actor, tokenId);
if (!session) return res.status(401).end();

// Then as many times as you like, synchronously.
if (!authorizeScope(session.actor, session.scopes, task.department).allowed) {
  return res.status(403).end();
}
```

---

## Four decisions, and why

### 1. Scope lives in a store, not in the token

A token cannot be un-issued. Put the scope list in the access token and taking
a scope away from someone does nothing until that token expires: they keep the
authority you just removed, on every gate at once, for the whole remaining
lifetime of the token. Fifteen minutes is a common access-token lifetime.
Fifteen minutes is a long time to be wrong about who may administer what.

The usual objection is cost — *now every authorized request hits the database.*
It does not survive contact with a real codebase. Any system that can revoke a
session at all already checks something server-side on the authenticated path:
a blocklist, a session row, a version counter. This adds no round trip **in
kind**, and the one it adds is a single indexed read behind a cache.

If your system genuinely has no server-side check on that path, then it cannot
revoke a session either, and the scope list is not your first problem.

### 2. Role is checked before scope, always

An owner's authority comes from their role, so they carry an **empty** scope
set — there is nothing scoped to enumerate. Ask *"is the target in the actor's
scopes?"* first and every owner in the system is instantly narrowed from full
access to none.

That failure does not announce itself. It presents as a permissions bug in
whichever screen somebody happens to open first, and the fix people reach for
is to give owners a scope row, which papers over the ordering and leaves it
waiting for the next caller.

`authorizeScope` is ordered so it cannot happen, and three tests fail if the
order is changed.

### 3. An empty scope set means zero, never everything

Not "everything", and — the tempting one — never "fall back to the user's old
single-department field". A fallback makes the store advisory, and an advisory
source of authority silently re-grants exactly what somebody just revoked.

A scoped-admin with no rows is refused everywhere. That is the whole rule.

### 4. The cache is a stated staleness envelope

Both caches take the **same** TTL by default (15s). Two caches with two TTLs
means two answers to *"how stale can this be"*, and nobody remembers both.

One asymmetry, on purpose: **a permit expires; a known revocation does not.**
Revocation is monotonic — a revoked token is never un-revoked — so re-reading a
known refusal buys nothing and risks answering "allowed" if the row has been
swept or the read fails. A stale permit is dangerous. A stale refusal is not.

Revocations therefore do not live in the cache at all. They live in a plain Set
that eviction never touches, and this is worth a paragraph because the first
version got it wrong in a way the tests did not catch. Refusals were kept in the
cache behind a "don't expire this one" predicate, which survived the clock and
not eviction: the cache clears wholesale when it fills. At the shipped defaults,
with the clock frozen, a revoked token un-revoked itself after 5,000 unrelated
lookups. Every test passed, because every test advanced the clock and none of
them filled the cache.

That Set is bounded by `maxKnown` (default 100,000, and it only ever holds
tokens actually revoked). At the bound it stops *accepting* rather than
dropping: overflow degrades to "ask the store every time", never to "this token
was never revoked", and `stats().knownRevokedOverflowed` says it happened.

The clock is injectable, so the envelope is asserted in tests rather than
advertised in a comment:

```ts
store.setScopes("u-1", ["north"]);   // "south" revoked
clock.advance(TTL + 1);
assert.deepEqual([...await resolver.resolve("scoped-admin", "u-1")], ["north"]);
```

---

## What you implement

```ts
type ScopeStore = { scopesFor(actorId: string): Promise<readonly Scope[]> };
type RevocationStore = { isRevoked(tokenId: string): Promise<boolean> };
```

Two methods. A `Scope` is a plain string — a department, a region, a tenant id.
An enum here would make the library know something about your business, and the
one thing it should be is ignorant of it.

## API

| Export | Does |
|---|---|
| `Guard` | The request path: session valid → scopes resolved. Two cached awaits. |
| `ScopeResolver` | Scopes for an actor, cached, store untouched for owners and members. |
| `RevocationChecker` | Is this token still allowed to act. |
| `authorizeScope` | One target. Role first, then membership. |
| `authorizeScopes` | Several targets, all-or-nothing. |
| `governableScopes` | For narrowing a query: `{narrow:false}` = do not narrow, `{narrow:true,scopes}` = narrow to these. |
| `TtlCache` | The bounded cache, exported because the envelope is yours to reuse. Nothing in it is permanent — see decision 4. |

### `governableScopes` returns two different kinds of nothing

`{ narrow: false }` means *do not narrow this query* — the actor is an owner.
`{ narrow: true, scopes: [] }` means *narrow it to nothing* — the actor sees no
rows at all. Conflate them and you get either a leak or a blank screen.

This returned `readonly Scope[] | null` at first, and this section claimed the
compiler made you say which you meant. It did not: `null` is falsy, so
`governableScopes(...) ?? []` type-checked perfectly and silently turned "show
everything" into "show nothing" — the exact conflation, in the idiom a reader
reaches for first. One of this library's own tests was written that way.

A discriminated union has no falsy member. There is no `??` to reach for, and
`.scopes` cannot be read until `.narrow` has been. Now the claim is true.

---

## Resolve once, gate synchronously

`Guard.resolve` is awaited once per request; every gate after it is a plain
synchronous call. That is deliberate.

A gate you must `await` is a gate somebody eventually forgets to `await` — and
a forgotten `await` on a function returning a `Decision` yields a Promise,
which is truthy, so the gate **fails open**. Resolving at the edge and passing
the resolved set down removes that failure mode rather than documenting it.

---

## Tests

```bash
npm test        # tsc, then node --test
```

44 tests, no framework, no mocks library — a hand-advanced clock and two
counting fakes. Each invariant above was verified by breaking it on purpose and
checking that the right tests, and only those, went red:

| Mutation | Tests that caught it |
|---|---|
| Scope checked before role | 3 |
| Store consulted for every role | 3 |
| Refusals put back in the evictable cache | 5 |
| Cached refusals allowed to expire | 1 |

A test suite that has never been seen to fail is a claim, not evidence — and
the fourth row is why. It passed for a version of this library whose headline
guarantee did not hold, because it only ever tested the clock. The third row
is the test that was missing: fill the cache, never touch the clock, sweep the
row, and check the token is still revoked.

---

## What this is not

Not a policy engine, not RBAC-with-permissions, not row-level security. It
answers exactly one question — *may this actor govern this scope?* — and leaves
"may they read this row" to your application, which is the only thing that
knows.

## Licence

MIT — see [LICENSE](LICENSE).
