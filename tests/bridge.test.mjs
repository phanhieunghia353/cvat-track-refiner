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
} = {}) {
  const track = makeDemo(4).track;
  let data = {
    tracks: [track, { ...clone(track), clientID: 2, id: 102 }],
    shapes: [],
    tags: [],
  };
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
    history = { undo: [], redo: [] },
    undoData = null;
  const urls = [];
  const job = {
    id: 7,
    taskId: 3,
    dimension: "3d",
    startFrame: 0,
    stopFrame: 3,
    labels: [{ id: 1, name: "car" }],
    annotations: {
      export: async () => clone(data),
      get: async () => {
        if (refreshFailure && commits) throw Error("refresh failed");
        return data.tracks.map((t) => ({ clientID: t.clientID, lock: locked }));
      },
      commit: async (added, removed) => {
        commits++;
        undoData = clone(data);
        data.tracks = data.tracks.filter(
          (t) => !removed.tracks.some((r) => r.clientID === t.clientID),
        );
        data.tracks.push({ ...clone(added.tracks[0]), clientID: 3 });
        history.undo.push(["Commit annotations", 0]);
        if (corrupt) data.tracks.find((t) => t.clientID === 2).group = 99;
        if (switchJobAfterCommit) state.annotation.job.instance = { id: 99 };
        if (commitFailure) throw Error("ambiguous native failure");
      },
      save: () => {
        saves++;
        throw Error("Server Save forbidden");
      },
    },
    actions: {
      get: async () => clone(history),
      undo: async () => {
        data = undoData;
        history = { undo: [], redo: [["Commit annotations", 0]] };
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
    setTimeout,
    clearTimeout,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    fetch: async (url) => {
      urls.push(url);
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
  const context = vm.createContext(sandbox);
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
    get data() {
      return data;
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
        backup: pre.before,
        backupStored: true,
        token: randomUUID(),
      };
    },
  };
}
test("snapshot/preflight are read-only; single Apply allows auto-save setting without calling server Save", async () => {
  const app = setup(),
    p = await app.plan();
  assert.equal(app.commits, 0);
  app.data.tracks[1].group = 5;
  p.backup = (
    await app.call({
      op: "preflight",
      context: p.context,
      baseline: p.baseline,
    })
  ).before;
  const other = clone(app.data.tracks[1]),
    r = await app.call(p);
  assert.equal(r.ok, true);
  assert.equal(r.applied, true);
  assert.equal(r.warning, "");
  assert.equal(r.clientID, 3);
  assert.equal(app.commits, 1);
  assert.equal(app.saves, 0);
  assert.equal(app.urls.length, 0);
  assert.deepEqual(
    app.data.tracks.find((t) => t.clientID === 2),
    other,
  );
  assert.equal((await app.call(p)).ok, false);
  assert.equal(app.commits, 1);
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
  ]) {
    const app = setup(),
      p = await app.plan();
    if (mode === "label") p.track.label_id = 2;
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
  }
});
test("post-commit audit and render failures are reported as APPLIED, never an automatic second commit", async () => {
  for (const options of [{ corrupt: true }, { refreshFailure: true }]) {
    const app = setup(options),
      p = await app.plan(),
      r = await app.call(p);
    assert.equal(r.ok, true);
    assert.equal(r.applied, true);
    assert.ok(r.warning);
    assert.equal(app.commits, 1);
    assert.equal(r.canUndo, false);
  }
});
test("dedicated Undo uses one native action and refuses newer unrelated edits", async () => {
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
test("unknown native commit outcome is not misreported as successful or safe to retry", async () => {
  const app = setup({ commitFailure: true }),
    p = await app.plan(),
    r = await app.call(p);
  assert.equal(r.ok, true);
  assert.equal(r.applied, null);
  assert.equal(r.audited, false);
  assert.match(r.warning, /chưa xác định/);
  assert.equal(app.commits, 1);
  assert.equal((await app.call(p)).ok, false);
  assert.equal(app.commits, 1);
});
test("navigation after a successful commit remains an applied outcome with a warning", async () => {
  const app = setup({ switchJobAfterCommit: true }),
    p = await app.plan(),
    r = await app.call(p);
  assert.equal(r.ok, true);
  assert.equal(r.applied, true);
  assert.equal(r.audited, false);
  assert.ok(r.warning);
  assert.equal(app.commits, 1);
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
  assert.equal(app.commits, 1);
  const after = app.data.tracks.find((t) => t.clientID === 3);
  assert.equal(after.shapes.length, 4);
  assert.deepEqual(after.shapes[0], p.baseline.shapes[0]);
  assert.deepEqual(after.shapes[1].attributes, []);
});
