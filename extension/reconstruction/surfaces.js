import { localPoint, worldPoint } from "../core/geometry.js";
import { dot, key, eigenSymmetric, spatialIndex } from "./math.js";

/** Normals use local covariance, never the enclosing cuboid or point extrema.
 * A weak/edge neighborhood remains a point with unknown normal, not deleted. */
export function prepareObservation(frame, config) {
  const records = [];
  for (let i = 0; i < frame.xyz.length; i += 3)
    records.push({
      q: localPoint(
        frame.xyz[i],
        frame.xyz[i + 1],
        frame.xyz[i + 2],
        frame.points,
      ),
      source: i / 3,
      frame: frame.frame,
      mask: frame.masks?.[i / 3] || 0,
    });
  const neighbors = spatialIndex(records, config.normalRadius);
  for (const r of records) {
    const near = neighbors(r.q)
      .map((p) => ({ p, d: p.q.reduce((s, v, j) => s + (v - r.q[j]) ** 2, 0) }))
      .filter((p) => p.d <= config.normalRadius ** 2)
      .sort((a, b) => a.d - b.d)
      .slice(0, 28)
      .map((p) => p.p.q);
    r.normal = null;
    r.planarity = 0;
    if (near.length < 7) continue;
    const center = [0, 1, 2].map(
        (j) => near.reduce((s, p) => s + p[j], 0) / near.length,
      ),
      cov = Array.from({ length: 3 }, () => Array(3).fill(0));
    for (const p of near)
      for (let x = 0; x < 3; x++)
        for (let y = 0; y < 3; y++)
          cov[x][y] += ((p[x] - center[x]) * (p[y] - center[y])) / near.length;
    const e = eigenSymmetric(cov),
      sum = e.values.reduce((a, b) => a + b, 0);
    r.planarity = (e.values[1] - e.values[0]) / Math.max(e.values[2], 1e-9);
    if (r.planarity >= 0.3 && e.values[0] / Math.max(sum, 1e-9) < 0.05)
      r.normal = e.vectors.map((row) => row[0]);
  }
  return { ...frame, original: [...frame.points], records };
}
export function transformedRecords(
  observation,
  pose,
  limit = Infinity,
  partition = "all",
) {
  const filtered = observation.records.filter(
    (r) =>
      partition === "all" || (r.source % 5 === 0) === (partition === "holdout"),
  );
  const stride = Math.max(1, Math.ceil(filtered.length / limit)),
    out = [];
  for (let i = 0; i < filtered.length; i += stride) {
    const r = filtered[i],
      world = worldPoint(...r.q, observation.original),
      q = localPoint(...world, pose);
    let normal = null;
    if (r.normal) {
      const tip = worldPoint(
        ...r.normal.map((v, j) => v + r.q[j]),
        observation.original,
      );
      normal = localPoint(...tip, pose).map((v, j) => v - q[j]);
    }
    out.push({ ...r, q, normal });
  }
  return out;
}

/** One vote/centroid per frame and voxel, with provenance and spread retained.
 * Single-frame regions survive; no missing surfaces or body labels are made up.
 * Voxel cell IDs allow deterministic manual exclusion in a saved reconstruction. */
export function fuseSurfaces(observations, poses, config) {
  const cells = new Map(),
    byFrame = new Map(poses.map((p) => [p.frame, p]));
  for (const f of observations) {
    const pose = byFrame.get(f.frame);
    if (!pose?.trusted) continue;
    for (const r of transformedRecords(f, pose.pose)) {
      const k = key(r.q, config.surfaceVoxel);
      if (!cells.has(k)) cells.set(k, new Map());
      const frames = cells.get(k);
      if (!frames.has(f.frame))
        frames.set(f.frame, { points: [], normal: r.normal, mask: r.mask });
      frames.get(f.frame).points.push(r.q);
    }
  }
  const surfaces = [];
  for (const [id, frames] of cells) {
    const members = [...frames].map(([frame, r]) => ({
      frame,
      q: [0, 1, 2].map(
        (j) => r.points.reduce((s, p) => s + p[j], 0) / r.points.length,
      ),
      normal: r.normal,
      mask: r.mask,
    }));
    const q = [0, 1, 2].map(
        (j) => members.reduce((s, r) => s + r.q[j], 0) / members.length,
      ),
      spread = Math.sqrt(
        members.reduce(
          (s, r) => s + r.q.reduce((v, p, j) => v + (p - q[j]) ** 2, 0),
          0,
        ) / members.length,
      );
    const normals = members.filter((r) => r.normal).map((r) => r.normal);
    let normal = null;
    if (normals.length) {
      const sum = normals.reduce(
          (a, n) =>
            a.map((v, j) => v + n[j] * (dot(n, normals[0]) < 0 ? -1 : 1)),
          [0, 0, 0],
        ),
        length = Math.hypot(...sum);
      if (length > 0) normal = sum.map((v) => v / length);
    }
    surfaces.push({
      id,
      position: q,
      normal,
      frames: members.map((r) => r.frame),
      spread,
      observed: true,
      role: members.every((r) => r.mask) ? "context" : "unknown",
      support: members.length === 1 ? "single-frame" : "repeated",
    });
  }
  // Surface samples are bounded without hiding how many cells were omitted.
  const stride = Math.max(1, Math.ceil(surfaces.length / config.maxSurfels));
  return {
    surfaces: surfaces.filter((_, i) => i % stride === 0),
    totalCells: surfaces.length,
    sampled: stride > 1,
  };
}
