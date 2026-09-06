import assert from "node:assert/strict";
import { test } from "node:test";
import { ScopeResolver } from "../src/scopeResolver.js";
import { NO_SCOPE } from "../src/types.js";
import { CountingScopeStore, manualClock } from "./fakes.js";

const TTL = 15_000;

function build(rows: Record<string, readonly string[]> = {}, max = 5_000) {
  const clock = manualClock();
  const store = new CountingScopeStore(rows);
  const resolver = new ScopeResolver({ store, now: clock.now, ttlMs: TTL, maxEntries: max });
  return { clock, store, resolver };
}

test("an owner is answered without reading the store", async () => {
  // The cost objection to keeping scope in the store is that every authorized
  // request now pays for a read. Owners and members do not, and this is the
  // test that keeps that true rather than merely claimed.
  const { store, resolver } = build({ "u-1": ["north"] });
  assert.equal(await resolver.resolve("owner", "u-1"), NO_SCOPE);
  assert.equal(store.calls, 0);
});

test("a member is answered without reading the store", async () => {
  const { store, resolver } = build({ "u-1": ["north"] });
  assert.equal(await resolver.resolve("member", "u-1"), NO_SCOPE);
  assert.equal(store.calls, 0);
});

test("a scoped admin reads once, then is served from cache", async () => {
  const { store, resolver } = build({ "u-1": ["north", "south"] });
  const first = await resolver.resolve("scoped-admin", "u-1");
  const second = await resolver.resolve("scoped-admin", "u-1");
  assert.deepEqual([...first].sort(), ["north", "south"]);
  assert.deepEqual([...second].sort(), ["north", "south"]);
  assert.equal(store.calls, 1);
});

test("authority removed mid-session stops working within the envelope", async () => {
  // The whole reason the scope list is not in the token. Here the actor loses
  // "south" while holding a perfectly valid, unexpired token. A token-carried
  // array would keep answering ["north", "south"] until that token expired —
  // on every gate at once, for the whole remaining lifetime.
  const { clock, store, resolver } = build({ "u-1": ["north", "south"] });
  assert.deepEqual([...(await resolver.resolve("scoped-admin", "u-1"))].sort(), ["north", "south"]);

  store.setScopes("u-1", ["north"]);
  clock.advance(TTL + 1);

  assert.deepEqual([...(await resolver.resolve("scoped-admin", "u-1"))], ["north"]);
  assert.equal(store.calls, 2);
});

test("inside the envelope the answer is still stale, and that is the stated bargain", async () => {
  // Stated rather than hidden: the delay is a number somebody chose. A test
  // that only proved the happy direction would be advertising a guarantee the
  // code does not make.
  const { clock, store, resolver } = build({ "u-1": ["north", "south"] });
  await resolver.resolve("scoped-admin", "u-1");
  store.setScopes("u-1", []);
  clock.advance(TTL - 1);

  assert.deepEqual([...(await resolver.resolve("scoped-admin", "u-1"))].sort(), ["north", "south"]);
  assert.equal(store.calls, 1);
});

test("invalidating an actor drops that actor and leaves the others cached", async () => {
  const { store, resolver } = build({ "u-1": ["north"], "u-2": ["south"] });
  await resolver.resolve("scoped-admin", "u-1");
  await resolver.resolve("scoped-admin", "u-2");
  assert.equal(store.calls, 2);

  resolver.invalidate("u-1");
  await resolver.resolve("scoped-admin", "u-1");
  assert.equal(store.calls, 3);
  await resolver.resolve("scoped-admin", "u-2");
  assert.equal(store.calls, 3, "u-2 must still be cached");
});

test("no rows means zero authority, with no fallback to anything else", async () => {
  const { resolver } = build({ "u-1": [] });
  const scopes = await resolver.resolve("scoped-admin", "u-1");
  assert.equal(scopes, NO_SCOPE);
  assert.equal(scopes.size, 0);
});

test("an unknown actor is empty rather than an error", async () => {
  const { resolver } = build({});
  assert.equal((await resolver.resolve("scoped-admin", "nobody")).size, 0);
});

test("the cache is bounded and clears wholesale rather than growing", async () => {
  const { resolver, store } = build({}, 4);
  for (let i = 0; i < 4; i += 1) {
    store.setScopes(`u-${i}`, ["north"]);
    await resolver.resolve("scoped-admin", `u-${i}`);
  }
  assert.equal(resolver.stats().size, 4);

  store.setScopes("u-4", ["north"]);
  await resolver.resolve("scoped-admin", "u-4");

  const stats = resolver.stats();
  assert.equal(stats.clears, 1);
  assert.equal(stats.size, 1, "cleared, then the new entry stored");
});
