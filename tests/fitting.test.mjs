import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDemo } from "../extension/demo/generate.js";
import { refineTrack } from "../extension/fitting/refine.js";
import { settings } from "../extension/core/config.js";
import { cropObject } from "../extension/pointcloud/crop.js";
import { worldPoint } from "../extension/core/geometry.js";
test("dense crop candidates are bounded before voxel/component allocation", () => {
  const c = settings(),
    p = [0, 0, 0, 0, 0, 0, 4, 2, 2, 0, 0, 0, 0, 0, 0, 0],
    xyz = new Float32Array(100000 * 3);
  for (let i = 0; i < xyz.length; i += 3) {
    xyz[i] = (i % 101) / 100;
    xyz[i + 1] = 0.2;
    xyz[i + 2] = 0.3;
  }
  const r = cropObject(xyz, p, [], c);
  assert.equal(r.stats.crop, 100000);
  assert.ok(r.stats.candidatesSampled <= c.maxPoints * 20);
  assert.ok(r.stats.kept <= c.maxPoints);
});

test("multi-frame fitting recovers an undersized rigid box and improves center/yaw on synthetic evidence", async () => {
  const { frames, truth } = makeDemo();
  const snapshot = frames.map((f) => [...f.points]);
  const result = await refineTrack(frames);
  assert.equal(result.applicable, true);
  assert.ok(result.frames.filter((f) => f.accepted).length >= 9);
  result.size.forEach((v, j) =>
    assert.ok(Math.abs(v - truth[0][6 + j]) < 0.15, `${j}: ${v}`),
  );
  const oldYaw = 0.085,
    newYaw =
      result.frames
        .filter((f) => f.accepted)
        .reduce((s, f) => s + Math.abs(f.pose[5] - truth[f.frame][5]), 0) /
      result.frames.filter((f) => f.accepted).length;
  assert.ok(newYaw < oldYaw / 2);
  assert.deepEqual(
    frames.map((f) => [...f.points]),
    snapshot,
  );
  const accepted = result.frames.filter((f) => f.accepted),
    meanCenter = (key) =>
      accepted.reduce(
        (sum, f) =>
          sum +
          Math.hypot(
            ...f[key].slice(0, 3).map((v, j) => v - truth[f.frame][j]),
          ),
        0,
      ) / accepted.length;
  assert.ok(meanCenter("pose") < meanCenter("original") / 2);
  for (const f of result.frames) {
    assert.ok((f.shift || 0) <= settings().maxShift);
    assert.ok(Math.abs(f.yaw || 0) <= settings().maxYaw + 1e-8);
  }
});
test("empty or ambiguous frames never manufacture geometry", async () => {
  const { frames } = makeDemo(4);
  for (const f of frames) f.xyz = new Float32Array();
  const r = await refineTrack(frames);
  assert.equal(r.applicable, false);
  assert.equal(r.size, null);
  assert.ok(r.frames.every((f) => !f.accepted));
  const full = makeDemo(4).frames;
  full.forEach((f) => (f.stats = { competing: true }));
  assert.equal((await refineTrack(full)).applicable, false);
});
test("a single visible side is not interpreted as zero width", async () => {
  const frames = makeDemo(6).frames;
  for (const f of frames) {
    const xyz = [];
    for (let x = -2; x <= 2; x += 0.1)
      for (let z = -0.7; z <= 0.7; z += 0.1)
        xyz.push(...worldPoint(x, 0.8, z, f.points));
    f.xyz = Float32Array.from(xyz);
  }
  const r = await refineTrack(frames);
  if (r.applicable) {
    assert.equal(r.measuredAxes[1], false);
    assert.ok(r.size[1] > 1.4);
  } else assert.equal(r.size, null);
});
test("crop can recover points beyond initial box without swallowing known neighbor", () => {
  const { frames } = makeDemo(3),
    f = frames[0],
    neighbor = [...f.points];
  neighbor[1] += 3.4;
  const original = new Float32Array([
    ...f.xyz,
    ...Array.from({ length: 400 }, (_, i) =>
      worldPoint(((i % 20) - 10) * 0.1, Math.floor(i / 20) * 0.05, 0, neighbor),
    ).flat(),
  ]);
  const r = cropObject(original, f.points, [neighbor], settings());
  assert.ok(r.xyz.length > 100);
  assert.ok(r.stats.kept <= settings().maxPoints);
  assert.equal(r.stats.touchesBoundary, false);
  assert.ok([...r.xyz].every(Number.isFinite));
});
test("crop reports truncated search boundaries and worker-size configuration is bounded", () => {
  const { frames } = makeDemo(3),
    f = frames[0];
  f.points[6] = 1;
  const r = cropObject(f.xyz, f.points, [], settings({ cropMargin: 0.3 }));
  assert.ok(r.stats.touchesBoundary || r.xyz.length < 100);
  assert.throws(() => settings({ maxFrames: 10000 }), /maxFrames/);
  assert.throws(() => settings({ maxShift: Infinity }), /maxShift/);
});
