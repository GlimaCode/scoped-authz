import assert from "node:assert/strict";
import { test } from "node:test";
import { TtlCache } from "../src/ttlCache.js";
import { manualClock } from "./fakes.js";

// The cache had no test file of its own, and that is where the one real defect
// in this library lived: nothing asserted what eviction does, so nothing
// noticed that it silently discards entries another module was relying on.

test("a value is returned inside the ttl and gone after it", () => {
  const clock = manualClock();
  const cache = new TtlCache<string>({ ttlMs: 100, max: 10, now: clock.now });
  cache.set("k", "v");
  clock.advance(99);
  assert.equal(cache.get("k"), "v");
  clock.advance(2);
  assert.equal(cache.get("k"), undefined);
});

test("expiry does not prune, so size counts every distinct key ever seen", () => {
  // This is why the wholesale clear is reachable in ordinary traffic rather
  // than only under a burst: a stale entry stays in the map until something
  // overwrites it or the map is cleared.
  const clock = manualClock();
  const cache = new TtlCache<number>({ ttlMs: 100, max: 50, now: clock.now });
  for (let i = 0; i < 10; i += 1) cache.set(`k${i}`, i);
  clock.advance(1000);
  for (let i = 0; i < 10; i += 1) assert.equal(cache.get(`k${i}`), undefined);
  assert.equal(cache.size, 10, "stale entries are still occupying the map");
});

test("size never exceeds max, and overflow clears wholesale", () => {
  for (const max of [1, 2, 4, 7]) {
    const clock = manualClock();
    const cache = new TtlCache<number>({ ttlMs: 1000, max, now: clock.now });
    let peak = 0;
    for (let i = 0; i < 50; i += 1) {
      cache.set(`k${i}`, i);
      peak = Math.max(peak, cache.size);
    }
    assert.ok(peak <= max, `max=${max}: peak size ${peak} exceeded the bound`);
    assert.ok(cache.stats().clears > 0, `max=${max}: never cleared`);
  }
});

test("overwriting an existing key at capacity does not trigger a clear", () => {
  const clock = manualClock();
  const cache = new TtlCache<number>({ ttlMs: 1000, max: 2, now: clock.now });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("a", 3);
  assert.equal(cache.stats().clears, 0);
  assert.equal(cache.get("a"), 3);
  assert.equal(cache.get("b"), 2);
});

test("NOTHING survives eviction — the property revocation.ts must not rely on", () => {
  // The regression that this whole file exists for. An earlier TtlCache had a
  // `keepIf` predicate so a caller could ask for an entry to outlive expiry.
  // It outlived expiry and not eviction, which is not what "permanent" means.
  const clock = manualClock();
  const cache = new TtlCache<string>({ ttlMs: 1_000_000, max: 8, now: clock.now });
  cache.set("precious", "keep me");
  assert.equal(cache.get("precious"), "keep me");

  for (let i = 0; i < 8; i += 1) cache.set(`filler-${i}`, "x");

  assert.equal(
    cache.get("precious"),
    undefined,
    "if this ever passes, eviction has grown an exception and revocation.ts should be re-read",
  );
});

test("delete and clear do what they say", () => {
  const clock = manualClock();
  const cache = new TtlCache<number>({ ttlMs: 1000, max: 10, now: clock.now });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.delete("a");
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), 2);
  cache.clear();
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.size, 0);
});

test("hits and misses count store round trips avoided, not lookups", () => {
  const clock = manualClock();
  const cache = new TtlCache<number>({ ttlMs: 100, max: 10, now: clock.now });
  cache.get("absent");            // miss
  cache.set("k", 1);
  cache.get("k");                 // hit
  cache.get("k");                 // hit
  clock.advance(101);
  cache.get("k");                 // miss: stale
  const stats = cache.stats();
  assert.equal(stats.hits, 2);
  assert.equal(stats.misses, 2);
});

test("a nonsensical configuration is refused at construction", () => {
  const clock = manualClock();
  assert.throws(() => new TtlCache({ ttlMs: -1, max: 10, now: clock.now }), RangeError);
  assert.throws(() => new TtlCache({ ttlMs: 10, max: 0, now: clock.now }), RangeError);
});
