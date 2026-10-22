import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import { cvatBridge } from "../extension/cvat/bridge.js";
import { makeDemo } from "../extension/demo/generate.js";
import { clone } from "../extension/core/geometry.js";
import { buildDraft } from "../extension/core/draft.js";
import { stateAt } from "../extension/core/geometry.js";
const same = (v) => JSON.stringify(v);
function setup({
  corrupt = false,
  refreshFailure = false,
  locked = false,
  network = false,
  step = 1,
  commitFailure = false,
  switchJobAfterCommit = false,
  missingPrefix = false,
  requiresSlash = false,
  count = 4,
  normalizeAngles = false,
  wrongIdentity = false,
  missingSave = false,
  failOnWrite = 1,
  legacyStore = false,
  serverUnavailable = false,
  reorderOnWrite = false,
  serverCorruptOnWrite = false,
} = {}) {
  const track = makeDemo(count).track;
  track.shapes.forEach((shape) => {
    shape.id = 1000 + shape.frame;
  });
  let data = {
    tracks: [
      track,
      {
        ...clone(track),
        clientID: 2,
        id: 102,
        shapes: track.shapes.map((s) => ({ ...clone(s), id: 2000 + s.frame })),
      },
    ],
    shapes: [],
    tags: [],
  };
  let persisted = null;
  const state = {
    annotation: {
      job: { fetching: false, saving: false },
      annotations: {
        initialized: true,
        states: [],
        filters: [],
        saving: { uploading: false },
        activatedStateID: 1,
      },
      player: { frame: { number: 0 }, playing: false },
      canvas: { ready: true, activeControl: "cursor" },
      workspace: "Standard 3D",
    },
    settings: { workspace: { autoSave: true } },
  };
  let commits = 0,
    saves = 0,
    writes = 0,
    overlays = 0,
    listeners = 0,
    entries = [],
    redoEntries = [],
    history = { undo: [], redo: [] };
  const urls = [];
  const job = {
    id: 7,
    taskId: 3,
    dimension: "3d",
    startFrame: 0,
    stopFrame: count - 1,
    labels: [{ id: 1, name: "car" }],
    annotations: {
      export: async () => clone(data),
      get: async (frame) => {
        if (refreshFailure && writes) throw Error("refresh failed");
        return data.tracks
          .map((t) => {
            const snapshot = stateAt(t, frame);
            if (!snapshot) return null;
            let points = [...snapshot.points],
              keyframe = t.shapes.some((s) => s.frame === frame);
            if (normalizeAngles)
              for (let i = 3; i <= 5; i++) points[i] += 2 * Math.PI;
            let pointFlag = false,
              keyFlag = false;
            return {
              clientID: t.clientID,
              serverID: t.id ?? null,
              frame,
              lock: locked,
              objectType: "track",
              shapeType: "cuboid",
              isGroundTruth: false,
              get points() {
                return [...points];
              },
              set points(value) {
                pointFlag = true;
                points = [...value];
              },
              get keyframe() {
                return keyframe;
              },
              set keyframe(value) {
                keyFlag = true;
                keyframe = value;
              },
              save: missingSave
                ? undefined
                : async () => {
                    writes++;
                    const previous = clone(data);
                    const current = data.tracks.find(
                      (x) => x.clientID === t.clientID,
                    );
                    assert.ok(
                      current,
                      "Native save must address an existing identity",
                    );
                    let action;
                    if (pointFlag) {
                      const old = current.shapes.find((s) => s.frame === frame);
                      const next = old ? clone(old) : stateAt(current, frame);
                      next.points = [...points];
                      current.shapes = current.shapes.filter(
                        (s) => s.frame !== frame,
                      );
                      current.shapes.push(next);
                      action = "Changed points";
                    } else if (keyFlag && !keyframe) {
                      current.shapes = current.shapes.filter(
                        (s) => s.frame !== frame,
                      );
                      action = "Changed keyframe";
                    } else throw Error("Unexpected mutation or no update flag");
                    current.shapes.sort((a, b) => a.frame - b.frame);
                    current.source = ["auto", "semi-auto"].includes(
                      current.source,
                    )
                      ? "semi-auto"
                      : "manual";
                    if (wrongIdentity) current.clientID = 3;
                    if (reorderOnWrite) data.tracks.reverse();
                    if (serverCorruptOnWrite) {
                      persisted = clone(data);
                      persisted.tracks[0].id = 999;
                    }
                    if (corrupt)
                      data.tracks.find((t) => t.clientID === 2).group = 99;
                    entries.push({
                      before: previous,
                      after: clone(data),
                      item: [action, frame],
                    });
                    entries = entries.slice(-32);
                    redoEntries = [];
                    history = { undo: entries.map((e) => e.item), redo: [] };
                    if (switchJobAfterCommit)
                      state.annotation.job.instance = { id: 99 };
                    pointFlag = keyFlag = false;
                    if (commitFailure && writes === failOnWrite)
                      throw Error("ambiguous native failure");
                  },
            };
          })
          .filter(Boolean);
      },
      commit: async () => {
        commits++;
        throw Error("Replacement Commit is forbidden");
      },
      save: () => {
        saves++;
        throw Error("Server Save forbidden");
      },
    },
    actions: {
      get: async () => clone(history),
      undo: async (count = 1) => {
        for (let i = 0; i < count; i++) {
          const entry = entries.pop();
          if (!entry) break;
          data = clone(entry.before);
          redoEntries.push(entry);
        }
        history = {
          undo: entries.map((e) => e.item),
          redo: redoEntries.map((e) => e.item),
        };
      },
      redo: async (count = 1) => {
        for (let i = 0; i < count; i++) {
          const entry = redoEntries.pop();
          if (!entry) break;
          data = clone(entry.after);
          entries.push(entry);
        }
        history = {
          undo: entries.map((e) => e.item),
          redo: redoEntries.map((e) => e.item),
        };
      },
    },
  };
  state.annotation.job.instance = job;
  const store = {
    getState: () => state,
    dispatch: (a) => {
      state.annotation.annotations.states = a.payload.states;
    },
  };
  const sandbox = {
    request: null,
    console,
    crypto: { randomUUID },
    performance: { timeOrigin: 123 },
    location: {
      origin: "https://example.test",
      pathname: "/cvat/tasks/3/jobs/7",
    },
    cvatUI: { registerComponent: (fn) => fn({ store }) },
    document: { querySelectorAll: () => [], getElementById: () => null },
    AbortController,
    TextDecoder,
    setTimeout,
    clearTimeout,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    fetch: async (url, options = {}) => {
      urls.push(url);
      assert.equal(
        options.method || "GET",
        "GET",
        "Only read-only HTTP is permitted",
      );
      if (url.includes("/annotations")) {
        if (serverUnavailable) return { status: 403, ok: false };
        if (requiresSlash && !url.endsWith("/"))
          return { status: 0, ok: false, type: "opaqueredirect" };
        if (missingPrefix && url.startsWith("/cvat/api"))
          return { status: 404, ok: false };
        if (!persisted) persisted = clone(data);
        const bytes = new TextEncoder().encode(JSON.stringify(persisted));
        let read = false;
        return {
          status: 200,
          ok: true,
          body: {
            getReader: () => ({
              read: async () =>
                read
                  ? { done: true }
                  : ((read = true), { done: false, value: bytes }),
              cancel: async () => {},
            }),
          },
        };
      }
      if (!network) throw Error("Unexpected network call");
      if (requiresSlash && !url.split("?")[0].endsWith("/"))
        return { status: 0, ok: false, type: "opaqueredirect" };
      if (missingPrefix && url.startsWith("/cvat/api"))
        return { status: 404, ok: false };
      if (url.includes("/meta"))
        return {
          status: 200,
          ok: true,
          json: async () => ({ size: 4, frame_filter: `step=${step}` }),
        };
      const bytes = new TextEncoder().encode("DATA ascii\n");
      let read = false;
      return {
        status: 200,
        ok: true,
        body: {
          getReader: () => ({
            read: async () =>
              read
                ? { done: true }
                : ((read = true), { done: false, value: bytes }),
            cancel: async () => {},
          }),
        },
      };
    },
  };
  if (legacyStore) {
    sandbox.legacyStore = store;
    sandbox.cvatUI.registerComponent = () => {
      throw Error("Duplicate component registration");
    };
    sandbox.document.createElement = () => ({
      style: {},
      setAttribute() {},
      remove() {
        overlays--;
      },
    });
    sandbox.document.body = {
      appendChild() {
        overlays++;
      },
    };
    sandbox.addEventListener = () => {
      listeners++;
    };
    sandbox.removeEventListener = () => {
      listeners--;
    };
  }
  const context = vm.createContext(sandbox);
  if (legacyStore)
    vm.runInContext(
      `globalThis[Symbol.for("cvat.trackRefiner.v1")] = { store: legacyStore, latest: { invalidLegacyCommitUndo: true } };`,
      context,
    );
  async function call(request) {
    sandbox.request = request;
    return clone(
      await vm.runInContext(`(${cvatBridge.toString()})(request)`, context),
    );
  }
  return {
    call,
    state,
    job,
    urls,
    get server() {
      if (!persisted) persisted = clone(data);
      return persisted;
    },
    syncServer() {
      persisted = clone(data);
    },
    // Simulate native CVAT Save preserving existing PKs, followed by a fresh
    // page import assigning new client IDs in persistent server order.
    saveAndReload() {
      persisted = clone(data);
      for (const kind of ["tags", "shapes", "tracks"])
        persisted[kind].sort((a, b) => a.id - b.id);
      let id = 0;
      data = clone(persisted);
      for (const kind of ["tags", "shapes", "tracks"])
        for (const item of data[kind]) item.clientID = ++id;
      history = { undo: [], redo: [] };
      entries = [];
      redoEntries = [];
      return clone(data);
    },
    get data() {
      return data;
    },
    get overlays() {
      return overlays;
    },
    get listeners() {
      return listeners;
    },
    get writes() {
      return writes;
    },
    get commits() {
      return commits;
    },
    get saves() {
      return saves;
    },
    async plan() {
      const snap = await call({ op: "snapshot" });
      const baseline = clone(snap.annotations.tracks[0]),
        track = clone(baseline);
      track.shapes[1].points[6] += 0.1;
      const pre = await call({
        op: "preflight",
        context: snap.context,
        baseline,
      });
      return {
        op: "apply",
        context: snap.context,
        baseline,
        track,
        range: [0, 3],
        receipt: pre.receipt,
        backup: pre.before,
        backupStored: true,
        token: randomUUID(),
      };
    },
  };
}
test("snapshot/preflight are read-only; in-place Apply preserves IDs and allows auto-save setting without calling server Save", async () => {
  const app = setup(),
    p = await app.plan();
  assert.equal(app.commits, 0);
  app.data.tracks[1].group = 5;
  const refreshedPre = await app.call({
    op: "preflight",
    context: p.context,
    baseline: p.baseline,
  });
  p.backup = refreshedPre.before;
  p.receipt = refreshedPre.receipt;
  const other = clone(app.data.tracks[1]),
    r = await app.call(p);
  assert.equal(r.ok, true);
  assert.equal(r.applied, true);
  assert.equal(r.warning, "");
  assert.equal(r.clientID, 1);
  assert.equal(r.serverID, 101);
  assert.equal(r.identityPreserved, true);
  assert.deepEqual(
    app.data.tracks[0].shapes.map((s) => s.id),
    [1000, 1001, 1002, 1003],
  );
  assert.equal(app.commits, 0);
  assert.ok(app.writes > 0);
  assert.equal(app.saves, 0);
  assert.ok(app.urls.every((url) => url.includes("/annotations")));
  assert.deepEqual(
    app.data.tracks.find((t) => t.clientID === 2),
    other,
  );
  assert.equal((await app.call(p)).ok, false);
  assert.equal(app.commits, 0);
  assert.ok(app.writes > 0);
});
test("stale target, missing backup and editing states fail before commit", async () => {
  for (const mode of [
    "stale",
    "no-backup",
    "playing",
    "saving",
    "review",
    "drawing",
    "locked",
  ]) {
    const app = setup({ locked: mode === "locked" }),
      p = await app.plan();
    if (mode === "stale") app.data.tracks[0].group++;
    if (mode === "no-backup") p.backupStored = false;
    if (mode === "playing") app.state.annotation.player.playing = true;
    if (mode === "saving") app.state.annotation.job.saving = true;
    if (mode === "review") app.state.annotation.workspace = "Review";
    if (mode === "drawing")
      app.state.annotation.canvas.activeControl = "draw_cuboid";
    assert.equal((await app.call(p)).ok, false, mode);
    assert.equal(app.commits, 0, mode);
    assert.equal(app.writes, 0, mode);
  }
});
test("metadata changes, nonfinite geometry and out-of-job synthesized keys are rejected", async () => {
  for (const mode of [
    "label",
    "outside",
    "padding",
    "nan",
    "range",
    "newkey",
    "track-id",
    "key-id",
  ]) {
    const app = setup(),
      p = await app.plan();
    if (mode === "label") p.track.label_id = 2;
    if (mode === "track-id") p.track.id = 999;
    if (mode === "key-id") p.track.shapes[1].id = 999;
    if (mode === "outside") p.track.shapes[1].outside = true;
    if (mode === "padding") p.track.shapes[1].points[15] = 123;
    if (mode === "nan") p.track.shapes[1].points[0] = NaN;
    if (mode === "range") p.range = [2, 3];
    if (mode === "newkey") {
      const k = clone(p.track.shapes[3]);
      k.frame = 4;
      p.track.shapes.push(k);
    }
    assert.equal((await app.call(p)).ok, false, mode);
    assert.equal(app.commits, 0, mode);
    assert.equal(app.writes, 0, mode);
  }
});
test("post-write audit and render failures never retry a mutation", async () => {
  for (const options of [{ corrupt: true }, { refreshFailure: true }]) {
    const app = setup(options),
      p = await app.plan(),
      r = await app.call(p);
    assert.equal(r.ok, true);
    assert.equal(r.applied, options.corrupt ? null : true);
    assert.ok(r.warning);
    assert.equal(app.commits, 0);
    assert.ok(app.writes > 0);
    assert.equal(r.canUndo, !options.corrupt);
  }
});
test("dedicated Undo restores the entire audited batch and refuses newer unrelated edits", async () => {
  const app = setup(),
    p = await app.plan(),
    before = clone(app.data);
  await app.call(p);
  const r = await app.call({ op: "undo", context: p.context });
  assert.equal(r.undone, true);
  assert.deepEqual(app.data, before);
  assert.equal(app.saves, 0);
  const other = setup(),
    q = await other.plan();
  await other.call(q);
  other.data.tracks[0].group = 9;
  assert.equal(
    (await other.call({ op: "undo", context: q.context })).ok,
    false,
  );
});
test("reload/job context mismatch prevents reads and edits", async () => {
  const app = setup(),
    p = await app.plan();
  p.context.documentID++;
  assert.equal((await app.call(p)).ok, false);
  assert.equal(app.commits, 0);
});
test("cloud download is same-origin GET, bounded and honors explicit API prefix", async () => {
  const app = setup({ network: true }),
    s = await app.call({ op: "snapshot" });
  const r = await app.call({
    op: "cloud",
    context: s.context,
    frame: 1,
    apiBase: "/custom/api",
  });
  assert.equal(r.ok, true);
  assert.equal(Buffer.from(r.base64, "base64").toString(), "DATA ascii\n");
  assert.ok(app.urls.some((url) => url.startsWith("/custom/api/jobs/7/data?")));
  assert.ok(!app.urls.some((url) => url.includes("token")));
  assert.equal(
    (
      await app.call({
        op: "cloud",
        context: s.context,
        frame: 1,
        apiBase: "//evil.test/api",
      })
    ).ok,
    false,
  );
  assert.equal(
    (await app.call({ op: "cloud", context: s.context, frame: 99 })).ok,
    false,
  );
});
test("filtered/strided frames are refused before downloading or fitting wrong frame numbers", async () => {
  const app = setup({ network: true, step: 2 }),
    s = await app.call({ op: "snapshot" });
  const r = await app.call({ op: "cloud", context: s.context, frame: 1 });
  assert.equal(r.ok, false);
  assert.match(r.error, /step/);
  assert.equal(app.urls.length, 1);
});
test("partial native save is not misreported as a completed or safe-to-retry batch", async () => {
  const app = setup({ commitFailure: true }),
    p = await app.plan(),
    r = await app.call(p);
  assert.equal(r.ok, true);
  assert.equal(r.applied, null);
  assert.equal(r.audited, true);
  assert.equal(r.canUndo, true);
  assert.match(r.warning, /Apply dừng/);
  assert.equal(app.commits, 0);
  assert.ok(app.writes > 0);
  assert.equal((await app.call(p)).ok, false);
  assert.equal(app.commits, 0);
  assert.ok(app.writes > 0);
});
test("navigation after a successful native save remains an applied outcome with a warning", async () => {
  const app = setup({ switchJobAfterCommit: true }),
    p = await app.plan(),
    r = await app.call(p);
  assert.equal(r.ok, true);
  assert.equal(r.applied, null);
  assert.equal(r.audited, false);
  assert.ok(r.warning);
  assert.equal(app.commits, 0);
  assert.ok(app.writes > 0);
});
test("API discovery can fall back from reverse-proxy prefix to root /api on 404", async () => {
  const app = setup({ network: true, missingPrefix: true }),
    s = await app.call({ op: "snapshot" }),
    r = await app.call({ op: "cloud", context: s.context, frame: 0 });
  assert.equal(r.ok, true);
  assert.ok(app.urls.some((url) => url.startsWith("/api/jobs/7/data?")));
});
test("trailing-slash API redirects are not followed; the same-origin slash route is tried", async () => {
  const app = setup({ network: true, requiresSlash: true }),
    s = await app.call({ op: "snapshot" }),
    r = await app.call({ op: "cloud", context: s.context, frame: 0 });
  assert.equal(r.ok, true);
  assert.ok(app.urls.some((url) => url.includes("/data/?")));
});
test("sparse-track draft can add keys while preserving inherited metadata and range boundaries", async () => {
  const app = setup();
  app.data.tracks[0].shapes = [
    app.data.tracks[0].shapes[0],
    app.data.tracks[0].shapes[3],
  ];
  app.data.tracks[0].shapes[0].attributes = [{ spec_id: 9, value: "left" }];
  const p = await app.plan();
  const frames = [1, 2].map((frame) => {
    const original = stateAt(p.baseline, frame).points,
      pose = [...original];
    pose[0] += 0.1;
    return { frame, original, pose, accepted: true, yaw: 0 };
  });
  const proposal = buildDraft(
    p.baseline,
    {
      applicable: true,
      size: [4.2, 1.8, 1.5],
      measuredAxes: [true, true, true],
      frames,
    },
    [1, 2],
    { size: true, pose: true, jobStart: 0, jobEnd: 3 },
  );
  p.track = proposal.track;
  p.range = proposal.range;
  const r = await app.call(p);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.warning, "");
  assert.equal(app.commits, 0);
  assert.ok(app.writes > 0);
  const after = app.data.tracks.find((t) => t.clientID === 1);
  assert.equal(after.shapes.length, 4);
  assert.deepEqual(after.shapes[0], p.baseline.shapes[0]);
  assert.deepEqual(after.shapes[1].attributes, []);
});
test("reconstruction plus user box updates the same identity through native states", async () => {
  const { makeReconstructionDemo } = await import(
    "../extension/demo/reconstruction.js"
  );
  const { reconstruct } = await import("../extension/reconstruction/core.js");
  const { manualBoxProposal } = await import(
    "../extension/reconstruction/box.js"
  );
  const app = setup(),
    d = makeReconstructionDemo(4);
  app.data.tracks[0] = d.track;
  const other = clone(app.data.tracks[1]),
    snap = await app.call({ op: "snapshot" });
  const r = await reconstruct(d.frames, { referenceFrame: 0 });
  const proposal = manualBoxProposal(
      r,
      [0, 0, 0, 0, 0, 0, 4.7, 1.9, 1.65, 0, 0, 0, 0, 0, 0, 0],
    ),
    draft = buildDraft(d.track, proposal, [0, 3], { size: true, pose: true });
  assert.equal(app.commits, 0);
  const pre = await app.call({
    op: "preflight",
    context: snap.context,
    baseline: d.track,
  });
  const reply = await app.call({
    op: "apply",
    context: snap.context,
    baseline: d.track,
    track: draft.track,
    range: [0, 3],
    backup: pre.before,
    backupStored: true,
    token: randomUUID(),
    receipt: pre.receipt,
  });
  assert.equal(reply.ok, true, reply.error);
  assert.equal(reply.applied, true);
  assert.equal(reply.audited, true);
  assert.equal(app.commits, 0);
  assert.ok(app.writes > 0);
  assert.equal(app.saves, 0);
  assert.ok(app.urls.every((url) => url.includes("/annotations")));
  assert.deepEqual(
    app.data.tracks.find((t) => t.clientID === 2),
    other,
  );
});

test("regression: native Apply/Undo/Redo preserve selected client/server/keyframe IDs and every unrelated object", async () => {
  const app = setup();
  app.data.shapes.push({
    id: 800,
    clientID: 8,
    type: "cuboid",
    points: Array(16).fill(1),
  });
  app.data.tags.push({ id: 900, clientID: 9, frame: 0, label_id: 1 });
  app.data.tags[0].clientID = 1;
  app.data.shapes[0].clientID = 2;
  app.data.tracks[0].clientID = 3;
  app.data.tracks[1].clientID = 4;
  app.state.annotation.annotations.activatedStateID = 3;
  const p = await app.plan(),
    before = clone(app.data);
  const r = await app.call(p);
  assert.equal(r.identityPreserved, true);
  assert.equal(r.clientID, p.baseline.clientID);
  assert.equal(r.serverID, p.baseline.id);
  assert.equal(app.data.tracks.length, before.tracks.length);
  assert.deepEqual(
    app.data.tracks.map((t) => [t.clientID, t.id]),
    before.tracks.map((t) => [t.clientID, t.id]),
  );
  assert.equal(
    app.state.annotation.annotations.activatedStateID,
    p.baseline.clientID,
  );
  const applied = clone(app.data);
  assert.equal(
    (await app.call({ op: "undo", context: p.context })).audited,
    true,
  );
  assert.deepEqual(app.data, before);
  await app.job.actions.redo(1);
  assert.deepEqual(app.data, applied);
  assert.equal(app.commits, 0);
  assert.equal(app.saves, 0);
  assert.ok(app.urls.every((url) => url.includes("/annotations")));
});

test("all native states must be verifiable before any write; missing native save has no Commit fallback", async () => {
  for (const options of [{ missingSave: true }, { locked: true }]) {
    const app = setup(options),
      p = await app.plan(),
      before = clone(app.data);
    assert.equal((await app.call(p)).ok, false);
    assert.equal(app.writes, 0);
    assert.equal(app.commits, 0);
    assert.deepEqual(app.data, before);
  }
  const app = setup(),
    p = await app.plan();
  p.baseline.id = 999;
  assert.equal((await app.call(p)).ok, false);
  assert.equal(app.writes, 0);
});

test("normalized-angle reads do not reject native cuboid frames or change stored pose/padding", async () => {
  const app = setup({ normalizeAngles: true }),
    p = await app.plan();
  const r = await app.call(p);
  assert.equal(r.audited, true, r.warning);
  assert.deepEqual(
    app.data.tracks[0].shapes[1].points.slice(0, 6),
    p.baseline.shapes[1].points.slice(0, 6),
  );
  assert.deepEqual(
    app.data.tracks[0].shapes[1].points.slice(9),
    p.baseline.shapes[1].points.slice(9),
  );
  assert.equal(r.clientID, 1);
});

test("ID mutation by an incompatible host is an audit failure, never a successful replacement", async () => {
  const app = setup({ wrongIdentity: true }),
    p = await app.plan(),
    r = await app.call(p);
  assert.equal(r.audited, false);
  assert.equal(r.identityPreserved, false);
  assert.equal(r.canUndo, false);
  assert.match(r.warning, /Audit/);
  assert.equal(app.commits, 0);
});

test("a 60-frame Apply keeps identity; dedicated restore works beyond the 32-action native history", async () => {
  const app = setup({ count: 60 }),
    p = await app.plan(),
    before = clone(app.data);
  p.range = [0, 59];
  p.track.shapes.forEach((s) => {
    s.points[6] = 4.1;
    s.points[0] += 0.1;
  });
  const r = await app.call(p);
  assert.equal(r.audited, true, r.warning);
  assert.equal(r.changedFrames, 60);
  assert.equal((await app.job.actions.get()).undo.length, 32);
  assert.equal(app.data.tracks[0].clientID, 1);
  const undo = await app.call({ op: "undo", context: p.context });
  assert.equal(undo.undone, true, undo.warning);
  assert.equal(undo.audited, true);
  assert.match(undo.warning, /nguồn annotation.*semi-auto/);
  const expected = clone(before);
  expected.tracks[0].source = "semi-auto";
  assert.deepEqual(app.data, expected);
  assert.equal(app.commits, 0);
});

test("sparse long-batch restore removes only new keys and restores exact original geometry and IDs", async () => {
  const app = setup({ count: 70 });
  app.data.tracks[0].shapes = [
    app.data.tracks[0].shapes[0],
    app.data.tracks[0].shapes[69],
  ];
  const p = await app.plan(),
    before = clone(app.data);
  p.range = [0, 69];
  p.track = clone(p.baseline);
  p.track.shapes = Array.from({ length: 70 }, (_, frame) => {
    const s = stateAt(p.baseline, frame);
    s.points[6] = 4.1;
    return s;
  });
  assert.equal((await app.call(p)).audited, true);
  assert.equal(app.data.tracks[0].shapes.length, 70);
  const r = await app.call({ op: "undo", context: p.context });
  assert.equal(r.undone, true, r.warning);
  const expected = clone(before);
  expected.tracks[0].source = "semi-auto";
  assert.deepEqual(app.data, expected);
  assert.equal(app.data.tracks[0].id, 101);
});

test("partial save failures are recoverable through an explicit restore, without retrying Apply", async () => {
  const app = setup({ count: 8, commitFailure: true, failOnWrite: 3 }),
    p = await app.plan(),
    before = clone(app.data);
  p.range = [0, 7];
  p.track.shapes.forEach((s) => {
    s.points[6] = 4.1;
  });
  const r = await app.call(p);
  assert.equal(r.applied, null);
  assert.equal(r.partial, true);
  assert.equal(r.audited, true, r.warning);
  assert.equal(r.canUndo, true);
  const writes = app.writes;
  assert.equal((await app.call(p)).ok, false);
  assert.equal(app.writes, writes);
  const undo = await app.call({ op: "undo", context: p.context });
  assert.equal(undo.undone, true, undo.warning);
  const expected = clone(before);
  expected.tracks[0].source = "semi-auto";
  assert.deepEqual(app.data, expected);
});

test("new boundary keys get their intended points even after adjacent native edits change interpolation", async () => {
  const app = setup({ count: 10 });
  app.data.tracks[0].shapes = [
    app.data.tracks[0].shapes[0],
    app.data.tracks[0].shapes[9],
  ];
  const p = await app.plan();
  const frames = [3, 6].map((frame) => {
    const original = stateAt(p.baseline, frame).points,
      pose = [...original];
    pose[0] += 0.2;
    return { frame, original, pose, accepted: true, yaw: 0 };
  });
  const d = buildDraft(
    p.baseline,
    {
      applicable: true,
      size: [4.1, 1.8, 1.5],
      measuredAxes: [true, true, true],
      frames,
    },
    [3, 6],
    { size: true, pose: true, jobStart: 0, jobEnd: 9 },
  );
  p.track = d.track;
  p.range = d.range;
  const r = await app.call(p);
  assert.equal(r.audited, true, r.warning);
  for (const f of [2, 7]) {
    const actual = app.data.tracks[0].shapes.find((s) => s.frame === f);
    assert.deepEqual(actual.points, stateAt(p.baseline, f).points);
  }
});

test("updating from v0.3.0 reuses only the live store, isolates legacy undo and cleans UI locks", async () => {
  const app = setup({ legacyStore: true });
  assert.equal((await app.call({ op: "undo" })).ok, false);
  const p = await app.plan(),
    before = clone(app.data);
  const r = await app.call(p);
  assert.equal(r.identityPreserved, true, r.warning);
  assert.equal(app.overlays, 0);
  assert.equal(app.listeners, 0);
  const u = await app.call({ op: "undo", context: p.context });
  assert.equal(u.undone, true, u.warning);
  assert.deepEqual(app.data, before);
  assert.equal(app.overlays, 0);
  assert.equal(app.listeners, 0);
  assert.equal(app.commits, 0);
});

test("unreadable server identity fails before any native mutation", async () => {
  const app = setup({ serverUnavailable: true });
  const snapshot = await app.call({ op: "snapshot" });
  const pre = await app.call({
    op: "preflight",
    baseline: snapshot.annotations.tracks[0],
    context: snapshot.context,
  });
  assert.equal(pre.ok, false);
  assert.match(pre.error, /ID trên server/);
  assert.equal(app.writes, 0);
  assert.equal(app.commits, 0);
});
test("reordering only the selected track is caught immediately and quarantines later Apply", async () => {
  const app = setup({ count: 8, reorderOnWrite: true }),
    p = await app.plan();
  p.range = [0, 7];
  p.track.shapes.forEach((s) => {
    s.points[6] = 4.1;
  });
  const r = await app.call(p);
  assert.equal(r.applied, null);
  assert.equal(r.quarantined, true);
  assert.equal(r.audited, false);
  assert.equal(
    app.writes,
    1,
    "Stop at the first changed frame, not at batch end",
  );
  const s = await app.call({ op: "snapshot" });
  const pre = await app.call({
    op: "preflight",
    baseline: s.annotations.tracks.find((t) => t.clientID === 1),
  });
  assert.equal(pre.ok, false);
  assert.equal(app.writes, 1);
  assert.equal(app.commits, 0);
});
test("a side effect on an unrelated label stops the batch after one native write", async () => {
  const app = setup({ count: 8, corrupt: true }),
    p = await app.plan();
  p.range = [0, 7];
  p.track.shapes.forEach((s) => {
    s.points[6] = 4.1;
  });
  const r = await app.call(p);
  assert.equal(r.quarantined, true);
  assert.equal(app.writes, 1);
  assert.equal(r.identityPreserved, false);
});
test("a server-side reidentification cannot be reported as an audited success", async () => {
  const app = setup({ serverCorruptOnWrite: true }),
    p = await app.plan();
  const r = await app.call(p);
  assert.equal(r.applied, null);
  assert.equal(r.audited, false);
  assert.equal(r.quarantined, true);
  assert.match(r.warning, /ID server|thứ tự object/);
  assert.equal(app.saves, 0);
});
test("read-only verification distinguishes unsaved geometry from saved identity", async () => {
  const app = setup(),
    p = await app.plan();
  assert.equal((await app.call(p)).audited, true);
  const unsaved = await app.call({ op: "verifyIdentity" });
  assert.equal(unsaved.serverIdentityVerified, true);
  assert.equal(unsaved.serverContentMatchesSession, false);
  app.syncServer();
  const saved = await app.call({ op: "verifyIdentity" });
  assert.equal(saved.serverContentMatchesSession, true);
  assert.equal(app.saves, 0);
  assert.equal(app.commits, 0);
});
test("80-object native Apply plus Save/reload preserves every client/server ID and object order", async () => {
  const app = setup({ count: 4 });
  const template = clone(app.data.tracks[0]);
  app.data.tracks.splice(
    0,
    app.data.tracks.length,
    ...Array.from({ length: 80 }, (_, i) => ({
      ...clone(template),
      clientID: i + 1,
      id: 1001 + i,
      shapes: template.shapes.map((s) => ({
        ...clone(s),
        id: 10000 + i * 10 + s.frame,
      })),
    })),
  );
  const snapshot = await app.call({ op: "snapshot" }),
    baseline = clone(snapshot.annotations.tracks[22]),
    target = clone(baseline);
  target.shapes.forEach((s) => {
    s.points[6] += 0.1;
  });
  const before = clone(app.data),
    pre = await app.call({
      op: "preflight",
      baseline,
      context: snapshot.context,
    });
  const reply = await app.call({
    op: "apply",
    baseline,
    track: target,
    range: [0, 3],
    backup: pre.before,
    backupStored: true,
    receipt: pre.receipt,
    token: randomUUID(),
  });
  assert.equal(reply.audited, true, reply.warning);
  assert.equal(app.commits, 0);
  const reloaded = app.saveAndReload();
  assert.deepEqual(
    reloaded.tracks.map((t) => [t.clientID, t.id]),
    before.tracks.map((t) => [t.clientID, t.id]),
  );
  assert.deepEqual(
    reloaded.tracks.filter((t) => t.id !== baseline.id),
    before.tracks.filter((t) => t.id !== baseline.id),
  );
  assert.deepEqual(
    reloaded.tracks[22].shapes.map((s) => s.id),
    baseline.shapes.map((s) => s.id),
  );
});

test("missing/stale preflight receipt never reaches a native writer", async () => {
  const app = setup(),
    p = await app.plan();
  delete p.receipt;
  assert.equal((await app.call(p)).ok, false);
  p.receipt = "stale";
  assert.equal((await app.call(p)).ok, false);
  assert.equal(app.writes, 0);
});
test("changed server data between preflight and Apply stops before any write", async () => {
  const app = setup(),
    p = await app.plan();
  app.server.tracks[1].group = 7;
  const r = await app.call(p);
  assert.equal(r.ok, false);
  assert.match(r.error, /server vừa đổi/);
  assert.equal(app.writes, 0);
});
test("gapped client IDs are preview-only rather than silently changing numbering after reload", async () => {
  const app = setup();
  app.data.tracks[1].clientID = 3;
  const snapshot = await app.call({ op: "snapshot" });
  assert.equal(snapshot.ok, true);
  const pre = await app.call({
    op: "preflight",
    baseline: snapshot.annotations.tracks[0],
  });
  assert.equal(pre.ok, false);
  assert.match(pre.error, /thứ tự nạp lại/);
  assert.equal(app.writes, 0);
});
test("read-only post-Save audit catches changed existing key IDs and sends no mutation", async () => {
  const app = setup(),
    p = await app.plan();
  assert.equal((await app.call(p)).audited, true);
  const writes = app.writes;
  app.server.tracks[0].shapes[0].id = 7777;
  const r = await app.call({ op: "verifyIdentity" });
  assert.equal(r.ok, false);
  assert.match(r.error, /keyframe/);
  assert.equal(app.writes, writes);
  assert.equal(app.saves, 0);
});
test("read-only audit also catches unrelated content changed since the audited Apply", async () => {
  const app = setup(),
    p = await app.plan();
  assert.equal((await app.call(p)).audited, true);
  const writes = app.writes;
  app.data.tracks[1].group = 88;
  const r = await app.call({ op: "verifyIdentity" });
  assert.equal(r.ok, false);
  assert.match(r.error, /ngoài track/);
  assert.equal(app.writes, writes);
});

test("native/server keyframe ID mismatch blocks preflight without modifying geometry", async () => {
  const app = setup();
  app.server.tracks[0].shapes[0].id = 8888;
  const snap = await app.call({ op: "snapshot" });
  const pre = await app.call({
    op: "preflight",
    baseline: snap.annotations.tracks[0],
  });
  assert.equal(pre.ok, false);
  assert.match(pre.error, /keyframe/);
  assert.equal(app.writes, 0);
});

test("reopening the panel can recover only the still-audited explicit Undo record", async () => {
  const app = setup(),
    p = await app.plan();
  assert.equal((await app.call(p)).audited, true);
  const opened = await app.call({ op: "snapshot" });
  assert.equal(opened.canUndo, true);
  assert.equal(opened.lastToken, p.token);
  app.data.tracks[1].group = 99;
  assert.equal((await app.call({ op: "snapshot" })).canUndo, false);
  assert.equal(app.saves, 0);
});
