import {
  clone,
  stateAt,
  localPoint,
  worldPoint,
  wrap,
  validateTrack,
} from "./geometry.js";

import { finalBox, holdsGeometry } from "../fitting/validation.js";

/** Build an isolated proposal, never mutate baseline. Dense keys deliberately
 * preserve each frame's proposed pose/visibility/attributes. Boundary keys pin
 * interpolation outside the selected interval. Key reduction is not in v0.1. */
export function buildDraft(
  baseline,
  result,
  range,
  options = { size: true, pose: true },
) {
  validateTrack(baseline);
  if (!result.applicable || !result.size)
    throw Error("Chưa có đề xuất đủ bằng chứng.");
  const [start, end] = range;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    end < start ||
    end - start > 1199
  )
    throw Error("Khoảng frame không hợp lệ hoặc quá 1200 frame.");
  const draft = clone(baseline),
    byFrame = new Map(draft.shapes.map((s) => [s.frame, s]));
  const observations = [...result.frames].sort((a, b) => a.frame - b.frame);
  let changed = 0,
    inferred = 0;
  for (let f = start; f <= end; f++) {
    const original = stateAt(baseline, f);
    if (!original || original.outside) continue;
    const left = [...observations].reverse().find((x) => x.frame <= f),
      right = observations.find((x) => x.frame >= f);
    // No correction of any kind crosses a sample explicitly held by the audit.
    if (holdsGeometry(left, options) || holdsGeometry(right, options)) {
      byFrame.set(f, clone(original));
      continue;
    }
    const shape = clone(original),
      p = shape.points;
    if (options.size)
      for (let j = 0; j < 3; j++)
        if (result.measuredAxes[j]) p[6 + j] = result.size[j];
    if (options.pose) {
      if (left?.accepted && right?.accepted) {
        const t =
          left.frame === right.frame
            ? 0
            : (f - left.frame) / (right.frame - left.frame);
        const a = localPoint(...left.pose.slice(0, 3), left.original),
          b = localPoint(...right.pose.slice(0, 3), right.original);
        const offset = a.map((v, j) => v + (b[j] - v) * t);
        p.splice(0, 3, ...worldPoint(...offset, original.points));
        p[5] = wrap(original.points[5] + left.yaw + t * (right.yaw - left.yaw));
        if (left.frame !== right.frame) inferred++;
      }
    }
    if (left?.frame === f)
      p.splice(
        0,
        p.length,
        ...finalBox(left, result.size, result.measuredAxes, options),
      );
    if (p.some((v, j) => Math.abs(v - original.points[j]) > 1e-10)) changed++;
    byFrame.set(f, shape);
  }
  // Inserting at start-1/end+1 prevents endpoint geometry pulling on frames
  // outside the range. Preserve existing keys byte-for-byte where present.
  const jobStart = options.jobStart ?? 0,
    jobEnd =
      options.jobEnd ?? Math.max(end, ...baseline.shapes.map((s) => s.frame));
  for (const f of [start - 1, end + 1])
    if (f >= jobStart && f <= jobEnd && !byFrame.has(f)) {
      const s = stateAt(baseline, f);
      if (s) byFrame.set(f, s);
    }
  draft.shapes = [...byFrame.values()].sort((a, b) => a.frame - b.frame);
  return {
    track: draft,
    changed,
    inferred,
    newKeys: draft.shapes.length - baseline.shapes.length,
    range,
  };
}
