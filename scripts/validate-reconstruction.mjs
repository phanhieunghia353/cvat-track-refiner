// Controlled benchmark only. stdout can be saved without retaining real data.
import { makeReconstructionDemo } from "../extension/demo/reconstruction.js";
import { reconstruct } from "../extension/reconstruction/core.js";
import { wrap } from "../extension/core/geometry.js";
const data = makeReconstructionDemo(8),
  core = await reconstruct(data.frames, { referenceFrame: 0 }),
  poses = core.poses.filter((p) => p.trusted && !p.pinned),
  mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(a.length, 1);
const center = (key) =>
  mean(
    poses.map((p) =>
      Math.hypot(
        ...p[key].slice(0, 3).map((v, j) => v - data.truth[p.frame][j]),
      ),
    ),
  );
const yaw = (key) =>
  mean(
    poses.map(
      (p) =>
        (Math.abs(wrap(p[key][5] - data.truth[p.frame][5])) * 180) / Math.PI,
    ),
  );
console.log(
  JSON.stringify(
    {
      version: "0.3.0",
      fixture:
        "Deterministic curved body with overlapping surfaces, fixed known reference and per-frame pose jitter",
      frames: data.frames.length,
      trusted: core.diagnostics.trusted,
      reference: 0,
      meanCenterErrorBeforeMetres: center("original"),
      meanCenterErrorAfterMetres: center("pose"),
      meanYawErrorBeforeDegrees: yaw("original"),
      meanYawErrorAfterDegrees: yaw("pose"),
      surfaceCells: core.surfaces.length,
      singleFrameCells: core.diagnostics.singleFrameCells,
      limitations:
        "Synthetic favorable overlap, not measured real-cloud accuracy; observed points only, no semantic body/mirror classification.",
    },
    null,
    2,
  ),
);
