import { localPoint, worldPoint, wrap } from "../core/geometry.js";
import { dot, spatialIndex, solveNormal } from "./math.js";
import { transformedRecords } from "./surfaces.js";

export function matcher(target, radius) {
  const near = spatialIndex(
    target.filter((p) => p.normal && !p.mask),
    radius,
  );
  return (r) => {
    if (!r.normal || r.mask) return null;
    let best = null,
      distance = radius * radius;
    for (const p of near(r.q)) {
      if (p.frame === r.frame || Math.abs(dot(r.normal, p.normal)) < 0.7)
        continue;
      const d = p.q.reduce((s, v, j) => s + (v - r.q[j]) ** 2, 0);
      if (d < distance) {
        distance = d;
        best = p;
      }
    }
    return best
      ? {
          target: best,
          residual: dot(
            r.q.map((v, j) => v - best.q[j]),
            best.normal,
          ),
          distance: Math.sqrt(distance),
        }
      : null;
  };
}
function pairs(source, find) {
  return source
    .map((r) => ({ source: r, match: find(r) }))
    .filter((p) => p.match)
    .sort((a, b) => Math.abs(a.match.residual) - Math.abs(b.match.residual));
}
export function alignmentScore(source, find) {
  const eligible = source.filter((r) => r.normal && !r.mask),
    matched = pairs(eligible, find),
    kept = matched.slice(0, Math.max(1, Math.ceil(matched.length * 0.85)));
  const neighbors = {};
  for (const p of matched)
    neighbors[p.match.target.frame] =
      (neighbors[p.match.target.frame] || 0) + 1;
  return {
    count: eligible.length,
    matches: matched.length,
    support: matched.length / Math.max(eligible.length, 1),
    rmse: kept.length
      ? Math.sqrt(
          kept.reduce((s, p) => s + p.match.residual ** 2, 0) / kept.length,
        )
      : null,
    neighbors,
  };
}
/** Reassess information rank on the final accepted target set. Removed frames
 * must not continue supplying constraints to a remaining frame's confidence. */
export function alignmentConstraints(source, find, c) {
  const matched = pairs(source, find),
    used = matched.slice(0, Math.ceil(matched.length * 0.85)),
    h = Array.from({ length: 4 }, () => Array(4).fill(0));
  for (const { source: r, match: m } of used) {
    const n = m.target.normal,
      j = [...n, (-r.q[1] * n[0] + r.q[0] * n[1]) / c.angularScale],
      weight = Math.min(1, c.huber / Math.max(Math.abs(m.residual), 1e-9));
    for (let x = 0; x < 4; x++)
      for (let y = 0; y < 4; y++) h[x][y] += weight * j[x] * j[y];
  }
  return { ...solveNormal(h, [0, 0, 0, 0]), matches: used.length };
}
function incrementalPose(p, step) {
  const [x, y, z, a] = step,
    c = Math.cos(a),
    s = Math.sin(a),
    next = [...p];
  next.splice(0, 3, ...worldPoint(-c * x - s * y, s * x - c * y, -z, p));
  next[5] = wrap(p[5] - a);
  return next;
}
function allowed(p, original, c) {
  return (
    Math.hypot(...p.slice(0, 3).map((v, j) => v - original[j])) <= c.maxShift &&
    Math.abs(wrap(p[5] - original[5])) <= c.maxYaw
  );
}

/** Bounded point-to-plane Gauss-Newton. Unknown directions are explicitly
 * reported; a single plane cannot become a trusted full rigid pose via damping. */
export function registerObservation(f, initial, target, c) {
  const find = matcher(target, c.matchRadius);
  let pose = [...initial],
    rank = 0,
    eigenvalues = [],
    iterations = 0;
  for (let i = 0; i < c.iterations; i++) {
    const source = transformedRecords(f, pose, c.alignPoints, "fit"),
      matched = pairs(source, find),
      used = matched.slice(0, Math.ceil(matched.length * 0.85));
    if (used.length < 24) break;
    const h = Array.from({ length: 4 }, () => Array(4).fill(0)),
      g = Array(4).fill(0);
    for (const { source: r, match: m } of used) {
      const n = m.target.normal,
        j = [...n, (-r.q[1] * n[0] + r.q[0] * n[1]) / c.angularScale],
        weight = Math.min(1, c.huber / Math.max(Math.abs(m.residual), 1e-9));
      for (let x = 0; x < 4; x++) {
        g[x] += weight * j[x] * m.residual;
        for (let y = 0; y < 4; y++) h[x][y] += weight * j[x] * j[y];
      }
    }
    const solution = solveNormal(h, g);
    rank = solution.rank;
    eigenvalues = solution.eigenvalues;
    if (rank < 4) break;
    const step = solution.step;
    step[3] /= c.angularScale;
    const scale = Math.min(
      1,
      0.08 / Math.max(Math.hypot(...step.slice(0, 3)), 1e-9),
      Math.PI / 180 / Math.max(Math.abs(step[3]), 1e-9),
    );
    const delta = step.map((v) => v * scale),
      next = incrementalPose(pose, delta);
    if (!allowed(next, f.original, c)) break;
    const before = alignmentScore(source, find),
      after = alignmentScore(
        transformedRecords(f, next, c.alignPoints, "fit"),
        find,
      );
    if (
      after.rmse === null ||
      after.support < before.support - 0.03 ||
      after.rmse > (before.rmse ?? Infinity) + 0.0005
    )
      break;
    pose = next;
    iterations++;
    if (
      Math.hypot(...delta.slice(0, 3)) < 0.0005 &&
      Math.abs(delta[3]) < 0.0002
    )
      break;
  }
  return { pose, rank, eigenvalues, iterations };
}
