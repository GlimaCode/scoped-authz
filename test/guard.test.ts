import assert from "node:assert/strict";
import { test } from "node:test";
import { Guard } from "../src/guard.js";
import { RevocationChecker } from "../src/revocation.js";
import { ScopeResolver } from "../src/scopeResolver.js";
import type { Actor } from "../src/types.js";
import { CountingRevocationStore, CountingScopeStore, manualClock } from "./fakes.js";

const TTL = 15_000;

function build(rows: Record<string, readonly string[]> = {}, revoked: readonly string[] = []) {
  const clock = manualClock();
  const scopeStore = new CountingScopeStore(rows);
  const revocationStore = new CountingRevocationStore(revoked);
  const guard = new Guard({
    revocation: new RevocationChecker({ store: revocationStore, now: clock.now, ttlMs: TTL }),
    scopes: new ScopeResolver({ store: scopeStore, now: clock.now, ttlMs: TTL }),
  });
  return { clock, scopeStore, revocationStore, guard };
}

const admin: Actor = { id: "u-1", role: "scoped-admin" };
const owner: Actor = { id: "u-owner", role: "owner" };

test("a revoked session stops before scope is ever resolved", async () => {
  const { scopeStore, guard } = build({ "u-1": ["north"] }, ["t-1"]);
  assert.equal(await guard.resolve(admin, "t-1"), null);
  assert.equal(scopeStore.calls, 0, "no point resolving scope for a dead session");
});

test("a live session resolves to the actor and their scopes", async () => {
  const { guard } = build({ "u-1": ["north", "south"] });
  const resolved = await guard.resolve(admin, "t-1");
  assert.ok(resolved);
  assert.equal(resolved.actor.id, "u-1");
  assert.deepEqual([...resolved.scopes].sort(), ["north", "south"]);
});

test("resolving once at the edge leaves every gate synchronous", async () => {
  // A gate that must be awaited is a gate somebody eventually forgets to
  // await — and a forgotten await returns a Promise, which is truthy, so the
  // gate fails OPEN. Resolving once and passing the set down is what removes
  // that whole failure mode; this test is here to keep the shape.
  const { guard, scopeStore } = build({ "u-1": ["north"] });
  const resolved = await guard.resolve(admin, "t-1");
  assert.ok(resolved);
  assert.equal(scopeStore.calls, 1);
  assert.equal(typeof resolved.scopes.has, "function");
  assert.equal(resolved.scopes.has("north"), true);
  assert.equal(resolved.scopes.has("east"), false);
});

test("check() names a revoked session as revoked, not as unauthenticated", async () => {
  // Two different events: nobody presented a session, versus a session that was
  // valid and was killed and is still being used. The second is worth alerting
  // on, and a library about revocation should be able to say it.
  const { guard } = build({ "u-1": ["north"] }, ["t-1"]);
  assert.deepEqual(await guard.check(admin, "t-1", "north"), {
    allowed: false,
    reason: "session-revoked",
  });
});

test("check() applies role before scope, so an owner passes with no rows at all", async () => {
  const { guard, scopeStore } = build({});
  assert.equal((await guard.check(owner, "t-1", "north")).allowed, true);
  assert.equal(scopeStore.calls, 0);
});

test("check() refuses a scope the actor does not hold", async () => {
  const { guard } = build({ "u-1": ["north"] });
  assert.equal((await guard.check(admin, "t-1", "north")).allowed, true);
  assert.deepEqual(await guard.check(admin, "t-1", "east"), {
    allowed: false,
    reason: "scope-not-in-actor-scope",
  });
});

test("revoking mid-session closes the session within the envelope", async () => {
  const { clock, revocationStore, guard } = build({ "u-1": ["north"] });
  assert.equal((await guard.check(admin, "t-1", "north")).allowed, true);

  revocationStore.revoke("t-1");
  clock.advance(TTL + 1);

  assert.deepEqual(await guard.check(admin, "t-1", "north"), {
    allowed: false,
    reason: "session-revoked",
  });
});
