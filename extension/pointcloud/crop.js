import { localPoint, voxelSample, bounds } from "../core/geometry.js";

/** Expand the SEARCH region, not the annotation. Remove points inside other
 * known tracks. This is a conservative hint, not semantic segmentation. */
export function cropObject(xyz, points, others, config) {
  const candidates = [],
    halo = [];
  // Bounded deterministic reservoir sampling prevents a dense search region
  // from allocating a Map entry for every raw point on low-memory machines.
  const capacity = config.maxPoints * 20;
  let totalCandidates = 0,
    seed = 137;
  const half = points.slice(6, 9).map((v) => v / 2 + config.cropMargin);
  for (let i = 0; i < xyz.length; i += 3) {
    const q = localPoint(xyz[i], xyz[i + 1], xyz[i + 2], points);
    if (q.some((v, j) => Math.abs(v) > half[j])) continue;
    if (
      others.some((p) => {
        const t = localPoint(xyz[i], xyz[i + 1], xyz[i + 2], p);
        return t.every((v, j) => Math.abs(v) < p[6 + j] / 2);
      })
    )
      continue;
    totalCandidates++;
    if (totalCandidates <= capacity)
      candidates.push(xyz[i], xyz[i + 1], xyz[i + 2]);
    else {
      seed = (1664525 * seed + 1013904223) >>> 0;
      const index = Math.floor((seed / 4294967296) * totalCandidates);
      if (index < capacity) {
        candidates[index * 3] = xyz[i];
        candidates[index * 3 + 1] = xyz[i + 1];
        candidates[index * 3 + 2] = xyz[i + 2];
      }
    }
  }
  for (let i = 0; i < candidates.length; i += 3) {
    const q = localPoint(
      candidates[i],
      candidates[i + 1],
      candidates[i + 2],
      points,
    );
    if (Math.abs(q[0]) > points[6] / 2 || Math.abs(q[1]) > points[7] / 2)
      halo.push(q[2]);
  }
  // Estimate a locally horizontal ground mode ONLY near the expected floor and
  // outside the original footprint. Never assume world z=0 or a sensor origin.
  const bins = new Map(),
    floor = -points[8] / 2;
  for (const z of halo)
    if (Math.abs(z - floor) < 0.7) {
      const bin = Math.round(z / 0.07);
      bins.set(bin, (bins.get(bin) || 0) + 1);
    }
  const mode = [...bins].sort((a, b) => b[1] - a[1])[0];
  const ground =
    mode && mode[1] >= Math.max(15, halo.length * 0.12) ? mode[0] * 0.07 : null;
  const above = [];
  for (let i = 0; i < candidates.length; i += 3) {
    const q = localPoint(
      candidates[i],
      candidates[i + 1],
      candidates[i + 2],
      points,
    );
    if (ground !== null && q[2] < ground + 0.13) continue;
    above.push(candidates[i], candidates[i + 1], candidates[i + 2]);
  }
  const sampled = voxelSample(above, config.voxel, config.maxPoints * 3);
  // Region growing keeps the component best supported by the initial box.
  // It can recover points beyond that box; it cannot separate touching cars.
  const cellSize = Math.max(0.32, config.voxel * 3),
    cells = new Map();
  for (let i = 0; i < sampled.length; i += 3) {
    const q = localPoint(sampled[i], sampled[i + 1], sampled[i + 2], points);
    const k = q.map((v) => Math.floor(v / cellSize)),
      key = k.join(",");
    if (!cells.has(key)) cells.set(key, { k, indices: [], seed: 0 });
    const cell = cells.get(key);
    cell.indices.push(i);
    if (q.every((v, j) => Math.abs(v) < points[6 + j] / 2 + 0.08)) cell.seed++;
  }
  const components = [],
    visited = new Set();
  for (const [key, first] of cells) {
    if (visited.has(key)) continue;
    const stack = [first],
      component = { indices: [], seed: 0 };
    visited.add(key);
    while (stack.length) {
      const cell = stack.pop();
      component.indices.push(...cell.indices);
      component.seed += cell.seed;
      for (let x = -1; x <= 1; x++)
        for (let y = -1; y <= 1; y++)
          for (let z = -1; z <= 1; z++) {
            const next = [cell.k[0] + x, cell.k[1] + y, cell.k[2] + z].join(
              ",",
            );
            if (!visited.has(next) && cells.has(next)) {
              visited.add(next);
              stack.push(cells.get(next));
            }
          }
    }
    components.push(component);
  }
  components.sort(
    (a, b) =>
      b.seed + b.indices.length * 0.05 - (a.seed + a.indices.length * 0.05),
  );
  const selected = components[0],
    out = [];
  if (selected)
    for (const i of selected.indices)
      out.push(sampled[i], sampled[i + 1], sampled[i + 2]);
  const result = voxelSample(out, config.voxel, config.maxPoints);
  const local = [];
  for (let i = 0; i < result.length; i += 3)
    local.push(...localPoint(result[i], result[i + 1], result[i + 2], points));
  const box = local.length ? bounds(local) : null;
  return {
    xyz: result,
    stats: {
      raw: xyz.length / 3,
      crop: totalCandidates,
      candidatesSampled: candidates.length / 3,
      kept: result.length / 3,
      groundRemoved: ground !== null,
      competing:
        components.filter(
          (c) => c.seed > Math.max(5, (selected?.seed || 0) * 0.35),
        ).length > 1,
      touchesBoundary: box
        ? box.low.some((v, j) => v < -half[j] + 0.12) ||
          box.high.some((v, j) => v > half[j] - 0.12)
        : false,
    },
  };
}
