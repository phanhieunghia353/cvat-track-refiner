import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyProposal,
  recoveryPrefix,
  markRestored,
} from "../extension/cvat/transaction.js";
const context = { origin: "https://example.test", prefix: "/cvat", jobId: 7 },
  before = { tracks: [], shapes: [], tags: [] };
function fixture({
  failStorage = false,
  failApply = false,
  corruptRead = false,
} = {}) {
  const calls = [],
    data = {};
  return {
    calls,
    data,
    call: async (request) => {
      calls.push(request.op);
      if (request.op === "preflight")
        return {
          context,
          before,
          receipt: "receipt",
          identity: { nativeOrder: [] },
        };
      if (failApply) throw Error("transport lost");
      return { applied: true, audited: true, identityPreserved: true };
    },
    storage: {
      get: async (keys) => {
        calls.push("read");
        if (corruptRead && Object.keys(data).length) return {};
        if (keys === null) return structuredClone(data);
        return Object.fromEntries(
          (Array.isArray(keys) ? keys : [keys])
            .filter((k) => k in data)
            .map((k) => [k, structuredClone(data[k])]),
        );
      },
      set: async (value) => {
        calls.push("backup");
        if (failStorage) throw Error("quota exceeded");
        Object.assign(data, structuredClone(value));
      },
    },
    baseline: { clientID: 1, id: 101 },
    proposal: { track: {}, range: [0, 2] },
    token: "attempt-1",
  };
}
test("backup quota failure stops before any Apply call", async () => {
  const f = fixture({ failStorage: true });
  await assert.rejects(applyProposal(f), /quota/);
  assert.ok(!f.calls.includes("apply"));
});
test("write-once backup and prepared journal are read back before the sole Apply", async () => {
  const f = fixture(),
    r = await applyProposal(f);
  assert.deepEqual(f.calls.slice(0, 5), [
    "preflight",
    "read",
    "backup",
    "read",
    "apply",
  ]);
  assert.equal(r.reply.applied, true);
  assert.equal(f.calls.filter((x) => x === "apply").length, 1);
  assert.equal(f.data[r.journalKey].status, "complete");
  assert.deepEqual(r.backup.data, before);
});
test("ambiguous transport failure is never retried and blocks later attempts after reopening", async () => {
  const f = fixture({ failApply: true });
  await assert.rejects(applyProposal(f), /transport/);
  assert.equal(f.calls.filter((x) => x === "apply").length, 1);
  f.token = "attempt-2";
  await assert.rejects(applyProposal(f), /chưa được xác minh/);
  assert.equal(f.calls.filter((x) => x === "apply").length, 1);
  assert.equal(
    Object.values(f.data).filter(
      (x) => x.format === "cvat-track-refiner-journal/v2",
    )[0].status,
    "prepared",
  );
});
test("corrupt backup read-back prevents native editing", async () => {
  const f = fixture({ corruptRead: true });
  await assert.rejects(applyProposal(f), /backup\/log/);
  assert.ok(!f.calls.includes("apply"));
});
test("the original recovery backup is never overwritten; every later attempt has its own pre-image", async () => {
  const f = fixture();
  const legacy = `track-refiner-backup:${context.origin}${context.prefix}:${context.jobId}`;
  f.data[legacy] = { original: true };
  await applyProposal(f);
  f.token = "attempt-2";
  await applyProposal(f);
  assert.deepEqual(f.data[legacy], { original: true });
  assert.equal(
    Object.keys(f.data).filter((k) =>
      k.startsWith(recoveryPrefix(context) + "before:"),
    ).length,
    2,
  );
});
test("partial/quarantined logs block another Apply until an audited restore resolves the attempt", async () => {
  const f = fixture();
  const r = await applyProposal(f);
  f.data[r.journalKey].status = "partial";
  f.token = "attempt-2";
  await assert.rejects(applyProposal(f), /khóa/);
  await markRestored(f.storage, r.journalKey, { undone: true, audited: false });
  assert.equal(f.data[r.journalKey].status, "partial");
  await markRestored(f.storage, r.journalKey, { undone: true, audited: true });
  await applyProposal(f);
  assert.equal(f.data[r.journalKey].status, "restored");
});

test("server ID/order changes after a later Save/reload cannot silently become a new baseline", async () => {
  const f = fixture();
  const r = await applyProposal(f);
  f.data[r.journalKey].identity.serverOrder = { tracks: [101, 102] };
  f.token = "attempt-2";
  const writes = f.calls.filter((c) => c === "apply").length;
  await assert.rejects(applyProposal(f), /thứ tự server đổi/);
  assert.equal(f.calls.filter((c) => c === "apply").length, writes);
});

test("client numbering changes across reopening cannot become a new baseline either", async () => {
  const f = fixture(),
    r = await applyProposal(f);
  f.data[r.journalKey].identity.nativeOrder = {
    tracks: [
      [1, 101],
      [3, 102],
    ],
  };
  f.token = "attempt-2";
  await assert.rejects(applyProposal(f), /Client ID/);
  assert.equal(f.calls.filter((x) => x === "apply").length, 1);
});
