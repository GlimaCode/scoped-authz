import assert from "node:assert/strict";
import { test } from "node:test";
import { RevocationChecker } from "../src/revocation.js";
import { CountingRevocationStore, manualClock } from "./fakes.js";

const TTL = 15_000;

function build(revoked: readonly string[] = [], options: { maxEntries?: number; maxKnown?: number } = {}) {
  const clock = manualClock();
  const store = new CountingRevocationStore(revoked);
  const checker = new RevocationChecker({
    store,
    now: clock.now,
    ttlMs: TTL,
    ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
    ...(options.maxKnown === undefined ? {} : { maxKnown: options.maxKnown }),
  });
  return { clock, store, checker };
}

test("a live token is permitted, and the answer is cached", async () => {
  const { store, checker } = build();
  assert.equal(await checker.isRevoked("t-1"), false);
  assert.equal(await checker.isRevoked("t-1"), false);
  assert.equal(store.calls, 1);
});

test("a revoked token is refused", async () => {
  const { checker } = build(["t-1"]);
  assert.equal(await checker.isRevoked("t-1"), true);
});

test("a permit expires and is re-read, so revocation lands within the envelope", async () => {
  const { clock, store, checker } = build();
  assert.equal(await checker.isRevoked("t-1"), false);

  store.revoke("t-1");
  clock.advance(TTL + 1);

  assert.equal(await checker.isRevoked("t-1"), true);
  assert.equal(store.calls, 2);
});

test("a refusal never lapses with time, even when the store forgets the row", async () => {
  const { clock, store, checker } = build(["t-1"]);
  assert.equal(await checker.isRevoked("t-1"), true);
  assert.equal(store.calls, 1);

  store.forget("t-1");
  clock.advance(TTL * 100);

  assert.equal(await checker.isRevoked("t-1"), true, "must not un-revoke");
  assert.equal(store.calls, 1, "and must not have gone back to the store to find out");
});

test("a refusal never lapses under CACHE PRESSURE either — the clock is not the only way out", async () => {
  // The test this suite was missing, and the defect it was missing.
  //
  // Refusals used to live in the TtlCache behind a `keepIf` predicate. That
  // survived expiry and not eviction: TtlCache.set clears the whole map on
  // overflow. At the shipped defaults, with the clock FROZEN, a revoked token
  // un-revoked itself after 5,000 unrelated lookups — and the suite stayed
  // green, because every existing test advanced the clock and none of them
  // filled the cache.
  //
  // Note what this test does NOT do: it never advances the clock. If it ever
  // starts passing for that reason, it has stopped testing anything.
  const { clock, store, checker } = build(["t-bad"], { maxEntries: 8 });
  const before = clock.now();

  assert.equal(await checker.isRevoked("t-bad"), true);
  for (let i = 0; i < 40; i += 1) await checker.isRevoked(`ordinary-${i}`);
  assert.ok(checker.stats().clears > 0, "the cache must actually have overflowed");

  store.forget("t-bad");
  assert.equal(clock.now(), before, "this test must not depend on the clock");
  assert.equal(await checker.isRevoked("t-bad"), true, "*** un-revoked by eviction ***");
});

test("marking a revocation takes effect immediately and survives pressure too", async () => {
  const { store, checker } = build([], { maxEntries: 4 });
  assert.equal(await checker.isRevoked("t-1"), false);

  checker.markRevoked("t-1");
  assert.equal(await checker.isRevoked("t-1"), true);
  assert.equal(store.calls, 1, "no second read needed for a revocation we performed");

  for (let i = 0; i < 20; i += 1) await checker.isRevoked(`ordinary-${i}`);
  assert.equal(await checker.isRevoked("t-1"), true);
});

test("marking a revocation drops any permit already cached for that token", async () => {
  const { checker } = build();
  assert.equal(await checker.isRevoked("t-1"), false);
  checker.markRevoked("t-1");
  assert.equal(checker.stats().knownRevoked, 1);
  assert.equal(await checker.isRevoked("t-1"), true);
});

test("at maxKnown the set stops accepting rather than forgetting somebody", async () => {
  // Overflow degrades to "ask the store every time", which is the weaker
  // answer. It must never degrade to "this token was never revoked".
  const { store, checker } = build(["a", "b", "c"], { maxKnown: 2 });
  assert.equal(await checker.isRevoked("a"), true);
  assert.equal(await checker.isRevoked("b"), true);
  assert.equal(await checker.isRevoked("c"), true, "the caller still gets the right answer");

  const stats = checker.stats();
  assert.equal(stats.knownRevoked, 2);
  assert.equal(stats.knownRevokedOverflowed, true, "and the overflow is reported, not hidden");

  // 'a' and 'b' were remembered and stay remembered even if the rows vanish.
  store.forget("a");
  assert.equal(await checker.isRevoked("a"), true);
  // 'c' was not, so it falls back to the store — weaker, and still not wrong
  // while the row is there.
  assert.equal(await checker.isRevoked("c"), true);
});

test("distinct tokens do not shadow one another", async () => {
  const { checker } = build(["t-bad"]);
  assert.equal(await checker.isRevoked("t-bad"), true);
  assert.equal(await checker.isRevoked("t-good"), false);
  assert.equal(await checker.isRevoked("t-bad"), true);
});
