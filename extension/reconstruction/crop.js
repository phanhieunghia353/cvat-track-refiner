import { localPoint, voxelSample } from "../core/geometry.js";

/** Core crop retains bounded context instead of hard-deleting rare surfaces.
 * Bit 1 marks a known other cuboid; bit 2 a possible horizontal ground band.
 * These hints exclude alignment votes but remain available to inspect/export. */
export function cropObservation(xyz, p, others, c) {
  const half = p.slice(6, 9).map((v) => v / 2 + c.cropMargin),
    capacity = c.maxPoints * 12,
    reservoir = [];
  let total = 0,
    seed = 191;
  for (let i = 0; i < xyz.length; i += 3) {
    const q = localPoint(xyz[i], xyz[i + 1], xyz[i + 2], p);
    if (q.some((v, j) => Math.abs(v) > half[j])) continue;
    total++;
    if (total <= capacity) reservoir.push(xyz[i], xyz[i + 1], xyz[i + 2]);
    else {
      seed = (1664525 * seed + 1013904223) >>> 0;
      const n = Math.floor((seed / 4294967296) * total);
      if (n < capacity)
        reservoir.splice(n * 3, 3, xyz[i], xyz[i + 1], xyz[i + 2]);
    }
  }
  const sampled = voxelSample(reservoir, c.voxel, c.maxPoints).slice(
      0,
      c.maxPoints * 3,
    ),
    masks = new Uint8Array(sampled.length / 3),
    local = [];
  const bins = new Map(),
    floor = -p[8] / 2;
  for (let i = 0; i < sampled.length; i += 3) {
    const q = localPoint(sampled[i], sampled[i + 1], sampled[i + 2], p);
    local.push(q);
    if (
      (Math.abs(q[0]) > p[6] / 2 || Math.abs(q[1]) > p[7] / 2) &&
      Math.abs(q[2] - floor) < 0.5
    ) {
      const k = Math.round(q[2] / 0.07);
      bins.set(k, (bins.get(k) || 0) + 1);
    }
  }
  const mode = [...bins].sort((a, b) => b[1] - a[1])[0],
    ground = mode && mode[1] >= 12 ? mode[0] * 0.07 : null;
  for (let i = 0; i < local.length; i++) {
    if (ground !== null && local[i][2] < ground + 0.12) masks[i] |= 2;
    if (
      others.some((other) =>
        localPoint(
          sampled[i * 3],
          sampled[i * 3 + 1],
          sampled[i * 3 + 2],
          other,
        ).every((v, j) => Math.abs(v) < other[6 + j] / 2),
      )
    )
      masks[i] |= 1;
  }
  return {
    xyz: sampled,
    masks,
    stats: {
      raw: xyz.length / 3,
      crop: total,
      kept: sampled.length / 3,
      groundHint: ground,
      contextPoints: masks.filter((v) => v > 0).length,
      cropBoundaryPoints: local.filter((q) =>
        q.some((v, j) => Math.abs(v) > half[j] - 0.1),
      ).length,
      coreCrop: true,
    },
  };
}
