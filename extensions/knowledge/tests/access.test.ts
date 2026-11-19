import { strict as assert } from "node:assert";
import { test } from "node:test";
import { KnowledgeAccess, type KnowledgeOwner } from "../access.ts";
import { openPrimaryActivity } from "../../primary-activity.ts";

const owner = (cwd = "/workspace"): KnowledgeOwner => ({
  cwd, sessionManager: { getSessionId: () => "session" } as KnowledgeOwner["sessionManager"],
});

test("requires genuine activity in the owner, and cancels claims on invalidation", () => {
  const access = new KnowledgeAccess(), current = owner();
  access.start(current);
  access.input(owner(), "rpc");
  access.input(current, "extension");
  assert.equal(access.claim(current, false), undefined);
  access.input(current, "rpc");
  const claim = access.claim(current, true)!;
  assert.equal(claim.valid(), true);
  assert.equal(access.claim({ ...current, cwd: "/other" }, false), undefined);
  access.invalidate();
  assert.equal(claim.signal.aborted, true);
  assert.equal(claim.valid(), false);
  assert.equal(access.claim(current, false), undefined);
});

test("only committed authenticated activity primes peer reads and has no write grant", () => {
  const access = new KnowledgeAccess(), current = owner();
  access.start(current);
  let valid = true;
  const peer = openPrimaryActivity(current, () => true, () => {});
  try {
    assert.equal(access.claim(current, false), undefined);
    peer.committed(Date.now() + 60_000, () => valid);
    const claim = access.claim(current, false)!;
    assert.equal(claim.valid(), true);
    assert.equal(access.claim(current, true), undefined);
    valid = false;
    assert.equal(claim.valid(), false);
    assert.equal(access.claim(current, false), undefined);
  } finally { peer.close(); }
});
