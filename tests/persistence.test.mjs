import { test } from "node:test";
import assert from "node:assert/strict";
import { upstreamImport } from "./fixtures/cvat-import-contract.js";
import { checkPreviousIdentity } from "../extension/cvat/transaction.js";
function load(data) {
  let counter = 0;
  class Model {
    constructor(item, clientID) {
      Object.assign(this, structuredClone(item));
      this.clientID = clientID;
    }
  }
  const collection = {
    injection: { nextClientID: () => ++counter },
    tags: {},
    shapes: {},
    tracks: [],
    intervals: [],
    objects: {},
  };
  return upstreamImport.call(collection, data, {
    Tag: Model,
    AudioInterval: Model,
    shapeFactory: (d, id) => new Model(d, id),
    trackFactory: (d, id) => new Model(d, id),
    colors: ["red", "blue"],
  });
}
const objects = () =>
  Array.from({ length: 80 }, (_, i) => ({
    id: 1001 + i,
    frame: 0,
    shapes: [{ id: 10000 + i, frame: 0, points: [i, 1, 1] }],
  }));
test("upstream CVAT import allocates native client IDs from persistent object order", () => {
  const before = { tags: [], shapes: [], tracks: objects(), intervals: [] },
    after = structuredClone(before);
  after.tracks[22].shapes[0].points[1] = 2;
  const a = load(before),
    b = load(after);
  assert.deepEqual(
    a.tracks.map((t) => [t.clientID, t.id]),
    b.tracks.map((t) => [t.clientID, t.id]),
  );
  assert.equal(b.tracks[22].clientID, 23);
});
test("known replacement/reload regression is rejected by the persisted identity guard", () => {
  const before = { tags: [], shapes: [], tracks: objects(), intervals: [] },
    broken = structuredClone(before);
  const replacement = broken.tracks.splice(22, 1)[0];
  replacement.id = 9999;
  broken.tracks.push(replacement);
  const loaded = load(broken);
  assert.equal(loaded.tracks.at(-1).clientID, 80);
  assert.equal(loaded.tracks.at(-1).id, 9999);
  const prefix = "job:",
    identity = {
      serverOrder: { tracks: before.tracks.map((t) => t.id) },
      serverKeyIDs: [],
    };
  const records = {
    [prefix + "journal:first"]: {
      status: "complete",
      savedAt: "2026-10-22T00:00:00Z",
      identity,
    },
  };
  assert.throws(
    () =>
      checkPreviousIdentity(records, prefix, {
        serverOrder: { tracks: broken.tracks.map((t) => t.id) },
      }),
    /thứ tự server đổi/,
  );
});
test("upstream reload ordering includes tags and standalone shapes before tracks", () => {
  const data = {
    tags: [{ id: 9, frame: 0 }],
    shapes: [{ id: 10, frame: 0 }],
    tracks: objects(),
    intervals: [],
  };
  const loaded = load(data);
  assert.equal(loaded.tags[0].clientID, 1);
  assert.equal(loaded.shapes[0].clientID, 2);
  assert.equal(loaded.tracks[0].clientID, 3);
});
