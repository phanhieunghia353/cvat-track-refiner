import { test } from "node:test";
import assert from "node:assert/strict";
import { makeReconstructionDemo } from "../extension/demo/reconstruction.js";
import { reconstruct } from "../extension/reconstruction/core.js";
import { localPoint, worldPoint, wrap } from "../extension/core/geometry.js";
import { manualBoxProposal } from "../extension/reconstruction/box.js";
import { buildDraft } from "../extension/core/draft.js";
import { eigenSymmetric } from "../extension/reconstruction/math.js";
import {
  reconstructionSnapshot,
  diagnosticBundle,
} from "../extension/core/diagnostics.js";
import { cropObservation } from "../extension/reconstruction/crop.js";
import { settings } from "../extension/core/config.js";
import { reconstructionScene } from "../extension/ui/reconstruction-view.js";

const mean = (a) => a.reduce((a, b) => a + b, 0) / a.length;
test("surface alignment fixes jitter while preserving a fixed gauge and observed-only provenance", async () => {
  const d = makeReconstructionDemo(8),
    before = d.frames.map((f) => ({ points: [...f.points], xyz: [...f.xyz] }));
  const r = await reconstruct(d.frames, { referenceFrame: 0 });
  assert.equal(r.format, "cvat-reconstruction/v1");
  assert.equal(r.kind, "reconstruction");
  assert.ok(!("size" in r));
  assert.ok(!("applicable" in r));
  assert.deepEqual(r.poses[0].pose, d.frames[0].points);
  assert.equal(r.diagnostics.trusted, 8);
  const old = mean(
      r.poses
        .slice(1)
        .map((p) =>
          Math.hypot(
            ...p.original.slice(0, 3).map((v, j) => v - d.truth[p.frame][j]),
          ),
        ),
    ),
    now = mean(
      r.poses
        .slice(1)
        .map((p) =>
          Math.hypot(
            ...p.pose.slice(0, 3).map((v, j) => v - d.truth[p.frame][j]),
          ),
        ),
    );
  assert.ok(now < old / 3);
  assert.ok(now < 0.025);
  for (const p of r.poses.slice(1)) {
    assert.equal(p.rank, 4);
    assert.equal(p.finalAudit, true);
    assert.ok(p.holdout.matches >= 12);
    assert.ok(Math.abs(wrap(p.pose[5] - d.truth[p.frame][5])) < 0.015);
  }
  for (const s of r.surfaces) {
    assert.equal(s.observed, true);
    assert.equal(s.role, "unknown");
    assert.ok(s.frames.length);
    assert.equal(new Set(s.frames).size, s.frames.length);
  }
  assert.ok(r.surfaces.some((s) => s.frames.length === 1));
  assert.equal(r.diagnostics.semanticBodyClassification, false);
  assert.deepEqual(
    d.frames.map((f) => ({ points: [...f.points], xyz: [...f.xyz] })),
    before,
  );
});
test("the reconstruction is invariant to label dimensions when the same observations are supplied", async () => {
  const d = makeReconstructionDemo(4),
    a = await reconstruct(d.frames, { referenceFrame: 0 });
  const changed = d.frames.map((f) => ({
      ...f,
      points: f.points.map((v, j) => (j >= 6 && j <= 8 ? v * 1.2 : v)),
    })),
    b = await reconstruct(changed, { referenceFrame: 0 });
  for (let i = 0; i < a.poses.length; i++)
    assert.deepEqual(a.poses[i].pose.slice(0, 6), b.poses[i].pose.slice(0, 6));
  assert.deepEqual(a.surfaces, b.surfaces);
});
test("one plane reports missing constraints instead of inventing a complete rigid pose", async () => {
  const d = makeReconstructionDemo(4);
  for (const f of d.frames) {
    const xyz = [];
    for (let x = -1.5; x <= 1.5; x += 0.08)
      for (let z = -0.5; z <= 0.5; z += 0.08)
        xyz.push(...worldPoint(x, 0.8, z, f.points));
    f.xyz = Float32Array.from(xyz);
  }
  const r = await reconstruct(d.frames, { referenceFrame: 0 });
  assert.equal(r.poses[0].status, "anchor");
  for (const p of r.poses.slice(1)) {
    assert.equal(p.trusted, false);
    assert.ok(p.rank < 4);
    assert.deepEqual(p.pose, p.original);
  }
});
test("a disconnected island stays untrusted even if internally consistent", async () => {
  const d = makeReconstructionDemo(4);
  for (const f of d.frames.slice(2))
    for (let i = 0; i < f.xyz.length; i += 3) f.xyz[i] += 15;
  const r = await reconstruct(d.frames, { referenceFrame: 0 });
  assert.equal(r.poses[2].trusted, false);
  assert.equal(r.poses[3].trusted, false);
  assert.ok(r.surfaces.every((s) => s.frames.every((f) => f < 2)));
});
test("excluding a frame removes its votes and surfaces without deleting its observation", async () => {
  const d = makeReconstructionDemo(4),
    r = await reconstruct(d.frames, { referenceFrame: 0, excludedFrames: [3] });
  assert.equal(r.poses[3].trusted, false);
  assert.equal(r.observations.length, 4);
  assert.ok(r.surfaces.every((s) => !s.frames.includes(3)));
  const scene = reconstructionScene(r, "3", { context: true });
  assert.equal(scene.points.length, d.frames[3].xyz.length / 3);
});
test("a user common box is rigidly projected; unknown frames and unrelated labels are not changed", async () => {
  const d = makeReconstructionDemo(4),
    r = await reconstruct(d.frames, { referenceFrame: 0, excludedFrames: [3] });
  r.range = [0, 3];
  const box = [
    0.05, -0.03, 0.02, 0, 0, 0.02, 4.7, 1.9, 1.65, 0, 0, 0, 0, 0, 0, 0,
  ];
  const proposal = manualBoxProposal(r, box),
    draft = buildDraft(d.track, proposal, [0, 3], { size: true, pose: true });
  for (const p of r.poses.filter((p) => p.trusted)) {
    const shape = draft.track.shapes.find((s) => s.frame === p.frame);
    assert.deepEqual(shape.points.slice(6, 9), box.slice(6, 9));
    const local = localPoint(...shape.points.slice(0, 3), p.pose);
    local.forEach((v, j) => assert.ok(Math.abs(v - box[j]) < 1e-8));
    assert.ok(Math.abs(wrap(shape.points[5] - p.pose[5] - box[5])) < 1e-8);
  }
  assert.deepEqual(draft.track.shapes[3], d.track.shapes[3]);
  assert.deepEqual(d.track.shapes[0].points, d.frames[0].points);
  assert.throws(
    () =>
      manualBoxProposal(
        r,
        box.map((v, j) => (j === 0 ? 99 : v)),
      ),
    /vượt giới hạn/,
  );
});
test("snapshot/diagnostic replay preserves poses and source masks without session credentials", async () => {
  const d = makeReconstructionDemo(4),
    r = await reconstruct(d.frames, { referenceFrame: 0 });
  const bundle = diagnosticBundle({
      ...r,
      context: { token: "private-secret" },
    }),
    snapshot = reconstructionSnapshot(r, { commonBox: null });
  assert.ok(!JSON.stringify(bundle).includes("private-secret"));
  assert.equal(snapshot.format, "cvat-reconstruction-snapshot/v1");
  assert.equal(snapshot.surfaces.length, r.surfaces.length);
  const replay = await reconstruct(
    bundle.observations.map((f) => ({ ...f, xyz: Float32Array.from(f.xyz) })),
    bundle.report.config,
  );
  assert.deepEqual(replay.poses, r.poses);
  assert.deepEqual(replay.surfaces, r.surfaces);
});
test("core crop retains known-neighbor context with masks and a strict bounded budget", () => {
  const d = makeReconstructionDemo(3),
    f = d.frames[0],
    neighbor = [...f.points];
  neighbor[1] += 1.2;
  const crop = cropObservation(
    f.xyz,
    f.points,
    [neighbor],
    settings({ maxPoints: 300 }),
  );
  assert.ok(crop.xyz.length / 3 <= 300);
  assert.equal(crop.masks.length, crop.xyz.length / 3);
  assert.ok(crop.masks.some((m) => m & 1));
  assert.equal(crop.stats.coreCrop, true);
});
test("invalid input and resource options fail before unbounded reconstruction work", async () => {
  const d = makeReconstructionDemo(3);
  await assert.rejects(reconstruct(d.frames, { iterations: 100000 }), /config/);
  await assert.rejects(reconstruct([d.frames[0], d.frames[0]]), /Quan sát/);
  await assert.rejects(
    reconstruct(d.frames, { referenceFrame: 100 }),
    /tham chiếu/,
  );
});
test("symmetric eigen decomposition reconstructs covariance rather than silently changing gauge", () => {
  const a = [
      [4, 1, 0],
      [1, 2, 0],
      [0, 0, 0.5],
    ],
    e = eigenSymmetric(a);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let value = 0;
      for (let k = 0; k < 3; k++)
        value += e.vectors[i][k] * e.values[k] * e.vectors[j][k];
      assert.ok(Math.abs(value - a[i][j]) < 1e-8);
    }
});
test("hiding a contributing frame removes it from fused display provenance without changing reconstruction", async () => {
  const d = makeReconstructionDemo(4),
    r = await reconstruct(d.frames, { referenceFrame: 0 });
  const before = JSON.stringify(r.poses),
    scene = reconstructionScene(r, "fused", { hiddenFrames: [0] });
  assert.ok(scene.points.length);
  assert.ok(scene.points.every((p) => !p.frames.includes(0)));
  assert.equal(JSON.stringify(r.poses), before);
});
