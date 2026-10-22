// Run the exact post-crop pipeline locally: node scripts/replay.mjs FILE.json
// Do not commit private diagnostics to this repository or attach them publicly.
import { readFileSync, statSync } from "node:fs";
import { reconstruct } from "../extension/reconstruction/core.js";
import { refineTrack } from "../extension/fitting/refine.js";
import { settings } from "../extension/core/config.js";
import { analysisReport } from "../extension/core/diagnostics.js";
const path = process.argv[2];
if (!path) throw Error("Usage: node scripts/replay.mjs DIAGNOSTIC.json");
if (statSync(path).size > 64 * 1024 * 1024)
  throw Error("Diagnostic exceeds 64 MB.");
const data = JSON.parse(readFileSync(path, "utf8"));
if (
  ![
    "cvat-track-refiner-crop-diagnostic",
    "cvat-reconstruction-diagnostic/v1",
    "cvat-reconstruction-snapshot/v1",
  ].includes(data.format) ||
  !Array.isArray(data.observations) ||
  data.observations.length > 48
)
  throw Error("Unsupported diagnostic format.");
const config = settings(data.report?.config);
const frames = data.observations.map((f) => {
  if (
    !Number.isInteger(f.frame) ||
    f.points?.length !== 16 ||
    !f.points.every(Number.isFinite) ||
    !Array.isArray(f.xyz) ||
    f.xyz.length % 3 ||
    f.xyz.length > 4001 * 3 ||
    !f.xyz.every(Number.isFinite)
  )
    throw Error("Invalid bounded observation.");
  if (
    f.masks &&
    (!Array.isArray(f.masks) ||
      f.masks.length !== f.xyz.length / 3 ||
      !f.masks.every((v) => Number.isInteger(v) && v >= 0 && v <= 3))
  )
    throw Error("Invalid masks.");
  return {
    ...f,
    xyz: Float32Array.from(f.xyz),
    masks: f.masks ? Uint8Array.from(f.masks) : undefined,
  };
});
const result = await (
  data.format.startsWith("cvat-reconstruction-") ? reconstruct : refineTrack
)(frames, config);
result.range = data.report.range;
result.config = config;
console.log(JSON.stringify(analysisReport(result), null, 2));
