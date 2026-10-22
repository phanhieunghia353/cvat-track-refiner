import { test } from "node:test";
import assert from "node:assert/strict";
import { previewScene } from "../extension/ui/preview.js";

const original = [0, 0, 0, 0, 0, 0, 4.6, 1.9, 1.6];
function result() {
  return {
    size: [5, 2, 1.8],
    measuredAxes: [true, false, true],
    referenceFrame: 0,
    frames: [
      {
        frame: 0,
        original: [...original],
        pose: [0.2, 0, 0, 0, 0, 0, ...original.slice(6)],
        accepted: true,
        xyz: new Float32Array([0, 0, 0]),
        rawXYZ: new Float32Array([0, 0, 0, 3, 0, 0]),
        rejectedXYZ: new Float32Array([3, 0, 0]),
      },
      {
        frame: 1,
        original: [...original],
        pose: [...original],
        accepted: false,
        xyz: new Float32Array([1, 0, 0]),
        rawXYZ: new Float32Array([1, 0, 0, 2, 0, 0]),
        rejectedXYZ: new Float32Array([2, 0, 0]),
      },
    ],
  };
}
function midpoint(vertices, axis) {
  return vertices.reduce((s, q) => s + q[axis], 0) / vertices.length;
}
test("fused preview excludes rejected frames and rejected points by default", () => {
  const scene = previewScene(result());
  assert.equal(scene.layers.length, 1);
  assert.equal(scene.layers[0].frame, 0);
  assert.equal(scene.layers[0].rejected, false);
});
test("gray overlay exposes discarded points, including entire rejected frames", () => {
  const scene = previewScene(result(), "fused", {
    size: true,
    pose: true,
    showRejected: true,
  });
  assert.equal(scene.layers.filter((l) => l.rejected).length, 2);
  assert.equal(scene.layers.find((l) => l.frame === 1).xyz.length, 2);
});
test("fused boxes preserve the actual anchor offset rather than sharing a fake center", () => {
  const scene = previewScene(result());
  assert.ok(Math.abs(midpoint(scene.old, 0) + 0.2) < 1e-8);
  assert.ok(Math.abs(midpoint(scene.proposed, 0)) < 1e-8);
  const ys = scene.proposed.map((p) => p[1]);
  assert.equal(Math.max(...ys) - Math.min(...ys), 1.9);
});
test("single frame uses original axes and obeys size/pose toggles", () => {
  const scene = previewScene(result(), "0");
  assert.equal(midpoint(scene.old, 0), 0);
  assert.ok(Math.abs(midpoint(scene.proposed, 0) - 0.2) < 1e-8);
  const originalScene = previewScene(result(), "0", {
    size: false,
    pose: false,
  });
  assert.deepEqual(originalScene.proposed, originalScene.old);
});
