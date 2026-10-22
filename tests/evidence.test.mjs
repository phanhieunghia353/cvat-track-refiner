import { test } from "node:test";
import assert from "node:assert/strict";
import { makeClutteredTrack } from "./fixtures/clutter.mjs";
import { makeDemo } from "../extension/demo/generate.js";
import { refineTrack } from "../extension/fitting/refine.js";
import { temporalGrid, filterEvidence } from "../extension/fitting/evidence.js";
import { settings } from "../extension/core/config.js";
import { localPoint } from "../extension/core/geometry.js";

test("dense returns from a single frame contribute only one temporal vote", () => {
  const support = temporalGrid([Array(900).fill(0), [], []], 0.22);
  assert.equal(support([0, 0, 0]), 1);
  assert.equal(support([0, 0, 0], 0), 0);
});
test("transient exterior cluster cannot inflate a near-correct label or pull its yaw", async () => {
  const { frames, truth } = makeClutteredTrack();
  const r = await refineTrack(frames);
  assert.equal(r.applicable, true);
  r.size.forEach((v, j) => assert.ok(Math.abs(v - truth[0][6 + j]) < 0.06));
  const f = r.frames[8];
  assert.ok(f.rejectedXYZ.length / 3 > 400);
  assert.ok(f.xyz.length / 3 >= 800);
  assert.ok(Math.abs(f.yaw) < Math.PI / 180);
  assert.ok(f.shift < 0.05);
});
test("persistent detached clutter cannot attach through a low ground-height bridge", async () => {
  const { frames, truth } = makeClutteredTrack({ persistent: true });
  const r = await refineTrack(frames);
  assert.equal(r.applicable, true);
  assert.ok(r.size[0] < truth[0][6] + 0.06);
  assert.ok(r.size[1] < truth[0][7] + 0.06);
  for (const f of r.frames) {
    assert.ok(f.rejectedXYZ.length / 3 > 400);
    assert.ok(Math.abs(f.yaw) < Math.PI / 180);
  }
});
test("true repeated vehicle surfaces outside an undersized box are retained", async () => {
  const { frames } = makeDemo(),
    r = await refineTrack(frames);
  assert.equal(r.applicable, true);
  assert.ok(r.size[0] > 4.5);
  assert.ok(r.size[1] > 1.85);
  assert.ok(
    r.frames.some((f) => {
      for (let i = 0; i < f.xyz.length; i += 3) {
        const q = localPoint(f.xyz[i], f.xyz[i + 1], f.xyz[i + 2], f.original);
        if (Math.abs(q[0]) > f.original[6] / 2 + 0.15) return true;
      }
      return false;
    }),
  );
});
test("unsafe crops cannot supply temporal votes for other frames", () => {
  const { frames } = makeDemo(4);
  for (const f of frames) {
    f.original = f.points;
    f.xyz = new Float32Array(Array(150).fill(0));
  }
  for (const f of frames.slice(1)) f.stats = { competing: true };
  assert.ok(
    filterEvidence(frames, settings()).every((f) => f.xyz.length === 0),
  );
});
test("non-overlapping isolated returns produce no proposal instead of completing a shape", async () => {
  const { frames } = makeDemo(4);
  frames.forEach((f, i) => {
    f.xyz = new Float32Array(
      Array.from({ length: 120 }, (_, j) => (j % 3 === 0 ? i * 10 : 0)),
    );
  });
  const r = await refineTrack(frames);
  assert.equal(r.applicable, false);
  assert.equal(r.size, null);
  assert.ok(r.frames.every((f) => !f.accepted));
});
