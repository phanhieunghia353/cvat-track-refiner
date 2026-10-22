import { localPoint } from "../core/geometry.js";

/** Check actual points against the FINAL proposed cuboid, not just a template.
 * Only trusted crop points already covered by the pre-label can count as lost.
 * A small metric tolerance avoids interpreting edge noise as missing geometry.
 * This is a regression guard, not proof of semantic foreground membership. */
export function boxCoverage(xyz, original, proposed, config = {}) {
  const margin = config.boxMargin ?? 0.08,
    maxLoss = config.maxCoverageLoss ?? 0.04;
  let count = 0,
    coveredBefore = 0,
    outsideBefore = 0,
    outsideAfter = 0,
    lost = 0;
  const lostByAxis = [0, 0, 0];
  for (let i = 0; i < xyz.length; i += 3) {
    const before = localPoint(xyz[i], xyz[i + 1], xyz[i + 2], original),
      after = localPoint(xyz[i], xyz[i + 1], xyz[i + 2], proposed);
    const beforeOutside = before.some(
      (v, j) => Math.abs(v) > original[6 + j] / 2 + margin,
    );
    const afterAxes = after.map(
        (v, j) => Math.abs(v) > proposed[6 + j] / 2 + margin,
      ),
      afterOutside = afterAxes.some(Boolean);
    count++;
    outsideBefore += Number(beforeOutside);
    outsideAfter += Number(afterOutside);
    if (!beforeOutside) {
      coveredBefore++;
      if (afterOutside) {
        lost++;
        afterAxes.forEach((v, j) => (lostByAxis[j] += Number(v)));
      }
    }
  }
  const lostFraction = lost / Math.max(coveredBefore, 1),
    beforeFraction = outsideBefore / Math.max(count, 1),
    afterFraction = outsideAfter / Math.max(count, 1);
  return {
    safe:
      count >= 35 &&
      lost <= Math.max(3, coveredBefore * maxLoss) &&
      afterFraction <= Math.max(beforeFraction, 0.1) + 0.02,
    count,
    coveredBefore,
    lost,
    lostFraction,
    lostByAxis,
    outsideBefore: beforeFraction,
    outsideAfter: afterFraction,
    margin,
  };
}

/** Resolve the exact geometry shown by preview and emitted by the draft.
 * Rejected/unsafe observations retain all original geometry, including size. */
export function finalBox(
  frame,
  size,
  axes,
  options = { size: true, pose: true },
) {
  const p = [...frame.original];
  if (!options.size && !options.pose) return p;
  if (holdsGeometry(frame, options)) return p;
  if (options.pose && frame.accepted) {
    p.splice(0, 3, ...frame.pose.slice(0, 3));
    p[5] = frame.pose[5];
  }
  if (options.size && size)
    for (let j = 0; j < 3; j++) if (axes?.[j]) p[6 + j] = size[j];
  return p;
}

/** Option-specific refusals also apply between samples, not just at a key. */
export function holdsGeometry(frame, options = { size: true, pose: true }) {
  const mode =
    options.size && options.pose ? "combined" : options.size ? "size" : "pose";
  return (
    !!frame &&
    (frame.preserveGeometry === true ||
      frame.geometryChecks?.[mode]?.safe === false)
  );
}
