import assert from "node:assert/strict";
import { test } from "node:test";
import { RevocationChecker } from "../src/revocation.js";
import { CountingRevocationStore, manualClock } from "./fakes.js";

const TTL = 15_000;

function build(revoked: readonly string[] = []) {
  const clock = manualClock();
  const store = new CountingRevocationStore(revoked);
  const checker = new RevocationChecker({ store, now: clock.now, ttlMs: TTL });
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

test("a refusal never lapses, even when the store forgets the row", async () => {
  // The one asymmetry in this library. Revocation is monotonic, so re-reading a
  // known "revoked" buys nothing and risks answering "no" if the row has been
  // swept or the read fails. A stale permit is dangerous; a stale refusal is
  // not, so refusals are kept and permits are not.
  const { clock, store, checker } = build(["t-1"]);
  assert.equal(await checker.isRevoked("t-1"), true);
  assert.equal(store.calls, 1);

  store.forget("t-1");
  clock.advance(TTL * 100);

  assert.equal(await checker.isRevoked("t-1"), true, "must not un-revoke");
  assert.equal(store.calls, 1, "and must not have gone back to the store to find out");
});

test("marking a revocation takes effect immediately in this process", async () => {
  const { store, checker } = build();
  assert.equal(await checker.isRevoked("t-1"), false);

  checker.markRevoked("t-1");

  assert.equal(await checker.isRevoked("t-1"), true);
  assert.equal(store.calls, 1, "no second read needed for a revocation we performed");
});

test("distinct tokens do not shadow one another", async () => {
  const { checker } = build(["t-bad"]);
  assert.equal(await checker.isRevoked("t-bad"), true);
  assert.equal(await checker.isRevoked("t-good"), false);
  assert.equal(await checker.isRevoked("t-bad"), true);
});
