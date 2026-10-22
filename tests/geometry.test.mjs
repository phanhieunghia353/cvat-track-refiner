import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clone,
  localPoint,
  worldPoint,
  stateAt,
  wrap,
  sampleFrames,
  validateTrack,
} from "../extension/core/geometry.js";
import { buildDraft } from "../extension/core/draft.js";
import { makeDemo } from "../extension/demo/generate.js";
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("XYZ world/object conversion round trips roll, pitch and yaw", () => {
  for (let i = 0; i < 50; i++) {
    const p = [
      5,
      -9,
      2,
      0.1 * Math.sin(i),
      0.1 * Math.cos(i),
      i * 0.3,
      4,
      2,
      1.5,
    ];
    const q = [Math.sin(i), Math.cos(i), i / 10],
      world = worldPoint(...q, p),
      back = localPoint(...world, p);
    back.forEach((v, j) => near(v, q[j]));
  }
});
test("interpolation follows shortest angle and does not replay mutable attributes", () => {
  const { track } = makeDemo(4);
  track.shapes = [track.shapes[0], track.shapes[3]];
  track.shapes[0].points[5] = Math.PI - 0.1;
  track.shapes[1].points[5] = -Math.PI + 0.1;
  track.shapes[0].attributes = [{ spec_id: 2, value: "old" }];
  track.shapes[1].attributes = [{ spec_id: 2, value: "new" }];
  const s = stateAt(track, 1);
  assert.ok(Math.abs(s.points[5]) > 3);
  assert.deepEqual(s.attributes, []);
  assert.equal(s.id, undefined);
  assert.deepEqual(stateAt(track, 3).attributes, track.shapes[1].attributes);
});
test("uniform frame budget respects visibility and nonzero job intervals", () => {
  const { track } = makeDemo(20);
  track.shapes[10].outside = true;
  const list = sampleFrames(track, 3, 18, 6);
  assert.equal(list.length, 6);
  assert.equal(list[0], 3);
  assert.equal(list.at(-1), 18);
  assert.ok(!list.includes(10));
});
test("unsupported cuboid data fails explicitly", () => {
  const { track } = makeDemo(3);
  track.shapes[1].points[3] = 0.5;
  assert.throws(() => validateTrack(track), /thẳng đứng/);
  track.shapes[1].points[3] = 0;
  track.shapes[1].points.pop();
  assert.throws(() => validateTrack(track), /16/);
});
test("draft pins outside-range interpolation and preserves flags/attributes/padding", () => {
  const { track } = makeDemo(10);
  track.shapes = [track.shapes[0], track.shapes[9]];
  const original = clone(track);
  const frames = [2, 5].map((frame) => {
    const s = stateAt(track, frame),
      p = [...s.points];
    p[0] += 0.1;
    p[5] += 0.03;
    return { frame, original: s.points, pose: p, accepted: true, yaw: 0.03 };
  });
  const r = {
    applicable: true,
    size: [4.5, 1.9, 1.6],
    measuredAxes: [true, true, true],
    frames,
  };
  const d = buildDraft(track, r, [2, 5], {
    size: true,
    pose: true,
    jobStart: 0,
    jobEnd: 9,
  });
  assert.deepEqual(track, original);
  assert.ok(d.track.shapes.some((s) => s.frame === 1));
  assert.ok(d.track.shapes.some((s) => s.frame === 6));
  for (const f of [0, 1, 6, 7, 8, 9])
    stateAt(track, f).points.forEach((v, j) =>
      near(v, stateAt(d.track, f).points[j]),
    );
  for (const f of [2, 3, 4, 5]) {
    const s = stateAt(d.track, f);
    assert.deepEqual(s.points.slice(6, 9), r.size);
    assert.deepEqual(s.points.slice(9), stateAt(track, f).points.slice(9));
  }
});
test("draft never synthesizes keys beyond job end, changes outside geometry or shrinks unmeasured dimensions", () => {
  const { track } = makeDemo(5);
  track.shapes[2].outside = true;
  const frames = track.shapes.map((s) => ({
    frame: s.frame,
    original: s.points,
    pose: s.points,
    accepted: false,
    yaw: 0,
  }));
  const d = buildDraft(
    track,
    {
      applicable: true,
      size: [4.5, 0.2, 1.6],
      measuredAxes: [true, false, true],
      frames,
    },
    [0, 4],
    { size: true, pose: true, jobStart: 0, jobEnd: 4 },
  );
  assert.equal(d.track.shapes.at(-1).frame, 4);
  assert.deepEqual(d.track.shapes[2], track.shapes[2]);
  assert.equal(d.track.shapes[1].points[7], track.shapes[1].points[7]);
});
test("no pose proposal is propagated through a rejected sample", () => {
  const { track } = makeDemo(8);
  const frames = [0, 3, 7].map((frame) => ({
    frame,
    original: track.shapes[frame].points,
    pose: track.shapes[frame].points.map((v, i) => (i === 0 ? v + 0.2 : v)),
    yaw: 0,
    accepted: frame !== 3,
  }));
  const d = buildDraft(
    track,
    {
      applicable: true,
      size: [4, 2, 1.5],
      measuredAxes: [true, true, true],
      frames,
    },
    [0, 7],
    { size: false, pose: true },
  );
  for (const f of [1, 2, 3, 4, 5, 6])
    assert.equal(stateAt(d.track, f).points[0], stateAt(track, f).points[0]);
});
