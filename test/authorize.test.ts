import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizeScope, authorizeScopes, governableScopes } from "../src/authorize.js";
import { NO_SCOPE, type Actor } from "../src/types.js";

const owner: Actor = { id: "u-owner", role: "owner" };
const admin: Actor = { id: "u-admin", role: "scoped-admin" };
const member: Actor = { id: "u-member", role: "member" };

const northAndSouth = new Set(["north", "south"]);

test("no actor is refused, and the empty scope set is not mistaken for unrestricted", () => {
  assert.deepEqual(authorizeScope(null, NO_SCOPE, "north"), {
    allowed: false,
    reason: "unauthenticated",
  });
  assert.equal(authorizeScope(undefined, NO_SCOPE, "north").allowed, false);
});

test("an owner carrying an EMPTY scope set is still allowed", () => {
  // This is the bug the ordering exists to prevent. Owners have no scoped
  // authority to enumerate, so their set is empty and meaningless. Ask about
  // the set before the role and every owner in the system silently loses
  // everything — which presents as a permissions bug in whichever screen
  // somebody opens first, not as what it is.
  assert.equal(authorizeScope(owner, NO_SCOPE, "north").allowed, true);
  assert.equal(authorizeScope(owner, NO_SCOPE, "anything-at-all").allowed, true);
});

test("an owner is allowed before the target is even considered", () => {
  assert.equal(authorizeScope(owner, NO_SCOPE, null).allowed, true);
  assert.equal(authorizeScope(owner, NO_SCOPE, "").allowed, true);
});

test("a member is refused even when the target is in the set they were handed", () => {
  const decision = authorizeScope(member, northAndSouth, "north");
  assert.deepEqual(decision, {
    allowed: false,
    reason: "role-has-no-administrative-authority",
  });
});

test("a scoped admin is allowed inside their set and refused outside it", () => {
  assert.equal(authorizeScope(admin, northAndSouth, "north").allowed, true);
  assert.equal(authorizeScope(admin, northAndSouth, "south").allowed, true);
  assert.deepEqual(authorizeScope(admin, northAndSouth, "east"), {
    allowed: false,
    reason: "scope-not-in-actor-scope",
  });
});

test("a scoped admin with an empty set administers nothing, not everything", () => {
  for (const target of ["north", "south", "east", "west"]) {
    assert.equal(
      authorizeScope(admin, NO_SCOPE, target).allowed,
      false,
      `empty scope must refuse ${target}`,
    );
  }
});

test("a missing target is refused rather than waved through", () => {
  // "This action is not attached to any scope" has to be said by not calling
  // this function, not by passing null and hoping.
  for (const target of [null, undefined, ""]) {
    assert.deepEqual(authorizeScope(admin, northAndSouth, target), {
      allowed: false,
      reason: "no-target-scope",
    });
  }
});

test("a bulk action is all-or-nothing", () => {
  assert.equal(authorizeScopes(admin, northAndSouth, ["north", "south"]).allowed, true);
  // Half-succeeding is worse than refusing: the caller then has to work out
  // which half happened.
  assert.deepEqual(authorizeScopes(admin, northAndSouth, ["north", "east"]), {
    allowed: false,
    reason: "scope-not-in-actor-scope",
  });
});

test("a bulk action over no targets is refused, and an owner still passes by role", () => {
  assert.deepEqual(authorizeScopes(admin, northAndSouth, []), {
    allowed: false,
    reason: "no-target-scope",
  });
  assert.equal(authorizeScopes(owner, NO_SCOPE, ["north", "east"]).allowed, true);
  assert.equal(authorizeScopes(null, northAndSouth, ["north"]).allowed, false);
});

test("narrowing a query distinguishes do-not-narrow from narrow-to-nothing", () => {
  // null and [] are the two answers most easily conflated, and conflating them
  // gives you either a leak or a blank screen. Different types, on purpose.
  assert.equal(governableScopes(owner, NO_SCOPE), null);
  assert.deepEqual(governableScopes(member, northAndSouth), []);
  assert.deepEqual(governableScopes(null, northAndSouth), []);
  assert.deepEqual([...(governableScopes(admin, northAndSouth) ?? [])].sort(), ["north", "south"]);
});
