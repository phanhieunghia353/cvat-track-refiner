import { test } from "node:test";
import assert from "node:assert/strict";
import { applyProposal } from "../extension/cvat/transaction.js";
const context = { origin: "https://example.test", prefix: "/cvat", jobId: 7 },
  before = { tracks: [], shapes: [], tags: [] };
function fixture(failStorage = false, failApply = false) {
  const calls = [];
  return {
    calls,
    call: async (request) => {
      calls.push(request.op);
      if (request.op === "preflight") return { context, before };
      if (failApply) throw Error("transport lost");
      return { applied: true };
    },
    storage: {
      set: async () => {
        calls.push("backup");
        if (failStorage) throw Error("quota exceeded");
      },
    },
    baseline: { clientID: 1 },
    proposal: { track: {}, range: [0, 2] },
    token: "test",
  };
}
test("backup quota failure stops before any Apply call", async () => {
  const f = fixture(true);
  await assert.rejects(applyProposal(f), /quota/);
  assert.deepEqual(f.calls, ["preflight", "backup"]);
});
test("backup is persisted before the sole Apply call", async () => {
  const f = fixture();
  const r = await applyProposal(f);
  assert.deepEqual(f.calls, ["preflight", "backup", "apply"]);
  assert.equal(r.reply.applied, true);
  assert.equal(r.backup.data, before);
});
test("ambiguous Apply transport failure is never retried automatically", async () => {
  const f = fixture(false, true);
  await assert.rejects(applyProposal(f), /transport/);
  assert.deepEqual(f.calls, ["preflight", "backup", "apply"]);
});
