import { test } from "node:test";
import assert from "node:assert/strict";
import { boxCoverage, finalBox } from "../extension/fitting/validation.js";
import { refineTrack } from "../extension/fitting/refine.js";
import { makeDemo } from "../extension/demo/generate.js";
import { makeClutteredTrack } from "../extension/demo/clutter.js";
import { buildDraft } from "../extension/core/draft.js";
import { stateAt } from "../extension/core/geometry.js";
import { previewScene } from "../extension/ui/preview.js";
import { diagnosticBundle } from "../extension/core/diagnostics.js";
const original = [0, 0, 0, 0, 0, 0, 5, 2.1, 1.85, 0, 0, 0, 0, 0, 0, 0];
function points() {
  const out = [];
  for (let x = -2.4; x < 2.5; x += 0.1)
    for (let z = -0.8; z < 0.9; z += 0.1) out.push(x, -1, z, x, 1, z);
  return Float32Array.from(out);
}
test("a 32 cm lateral shift plus width shrink cannot pass final coverage", () => {
  const p = [...original];
  p[1] = 0.32;
  p[7] = 1.9;
  const audit = boxCoverage(points(), original, p);
  assert.equal(audit.safe, false);
  assert.ok(audit.lostFraction > 0.4);
  assert.ok(audit.lostByAxis[1] > 100);
  assert.equal(boxCoverage(points(), original, original).safe, true);
});
test("every accepted result passes an audit of the exact final box", async () => {
  for (const demo of [makeDemo(), makeClutteredTrack()]) {
    const r = await refineTrack(demo.frames);
    assert.equal(r.applicable, true);
    for (const f of r.frames.filter((f) => f.accepted)) {
      assert.equal(f.validation.final.safe, true);
      assert.equal(
        boxCoverage(
          f.xyz,
          f.original,
          finalBox(f, r.size, r.measuredAxes),
          r.config,
        ).safe,
        true,
      );
      assert.ok(
        f.validation.final.lossAfter <= f.validation.final.lossBefore + 0.0002,
      );
    }
  }
});
test("a held sparse sample pins full geometry and blocks both size and pose interpolation", () => {
  const d = makeDemo(8),
    baseline = d.track;
  baseline.shapes = [baseline.shapes[0], baseline.shapes[7]];
  const frames = [0, 3, 7].map((frame) => {
    const p = stateAt(baseline, frame).points;
    const pose = [...p];
    pose[1] += 0.2;
    return {
      frame,
      original: p,
      pose,
      yaw: 0,
      accepted: frame !== 3,
      preserveGeometry: frame === 3,
    };
  });
  const r = {
    applicable: true,
    size: [4.6, 1.9, 1.6],
    measuredAxes: [true, true, true],
    frames,
  };
  const draft = buildDraft(baseline, r, [0, 7], { size: true, pose: true });
  for (let frame = 1; frame < 7; frame++)
    assert.deepEqual(
      stateAt(draft.track, frame).points,
      stateAt(baseline, frame).points,
    );
  const scene = previewScene(r, "3");
  assert.deepEqual(scene.old, scene.proposed);
});
test("size-only option cannot expose an unaudited geometry when combined fit passed", () => {
  const f = {
    original,
    pose: [...original],
    accepted: true,
    geometryChecks: { combined: { safe: true }, size: { safe: false } },
  };
  const r = {
    applicable: true,
    size: [5, 1, 1.8],
    measuredAxes: [true, true, true],
    frames: [{ ...f, frame: 0, xyz: new Float32Array() }],
  };
  assert.deepEqual(
    finalBox(f, r.size, r.measuredAxes, { size: true, pose: false }),
    original,
  );
  const baseline = {
    clientID: 1,
    shapes: [
      {
        frame: 0,
        type: "cuboid",
        outside: false,
        points: original,
        attributes: [],
      },
    ],
    elements: [],
  };
  assert.deepEqual(
    buildDraft(baseline, r, [0, 0], { size: true, pose: false }).track.shapes[0]
      .points,
    original,
  );
});
test("explicit diagnostic carries replayable crops without session or credential metadata", async () => {
  const d = makeClutteredTrack(),
    r = await refineTrack(d.frames);
  r.range = [0, 11];
  const bundle = diagnosticBundle({
    ...r,
    context: { origin: "private-server", token: "do-not-export" },
  });
  const serialized = JSON.stringify(bundle);
  assert.ok(!serialized.includes("private-server"));
  assert.ok(!serialized.includes("do-not-export"));
  const replay = await refineTrack(
    bundle.observations.map((f) => ({ ...f, xyz: Float32Array.from(f.xyz) })),
  );
  assert.deepEqual(replay.size, r.size);
  assert.deepEqual(
    replay.frames.map((f) => f.pose),
    r.frames.map((f) => f.pose),
  );
});
test("an unsafe size-only sample also blocks correction of unsampled neighbors", () => {
  const d = makeDemo(8);
  const frames = [0, 3, 7].map((frame) => ({
    frame,
    original: d.frames[frame].points,
    pose: d.frames[frame].points,
    accepted: true,
    yaw: 0,
    geometryChecks: { size: { safe: frame !== 3 } },
  }));
  const r = {
    applicable: true,
    size: [4.6, 1.9, 1.6],
    measuredAxes: [true, true, true],
    frames,
  };
  const draft = buildDraft(d.track, r, [0, 7], { size: true, pose: false });
  for (let frame = 1; frame < 7; frame++)
    assert.deepEqual(
      stateAt(draft.track, frame).points,
      stateAt(d.track, frame).points,
    );
});
