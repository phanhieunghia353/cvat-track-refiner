import { localPoint, quantile, bounds } from "../core/geometry.js";

/** A point gets at most ONE vote from a frame, regardless of return density.
 * Counts are across observed frames, not a claim that every frame can see a
 * surface. Never treat unseen space as measured free space or complete shape. */
export function temporalGrid(clouds, radius) {
  const cells = new Map(),
    key = (q) => q.map((v) => Math.floor(v / radius)).join(",");
  clouds.forEach((cloud, frame) => {
    for (let i = 0; i < cloud.length; i += 3) {
      const q = [cloud[i], cloud[i + 1], cloud[i + 2]],
        k = key(q);
      if (!cells.has(k)) cells.set(k, new Map());
      const members = cells.get(k);
      if (!members.has(frame)) members.set(frame, []);
      // Four representatives cover a cell without rewarding duplicate returns.
      if (members.get(frame).length < 4) members.get(frame).push(q);
    }
  });
  return (q, exclude = -1) => {
    const k = q.map((v) => Math.floor(v / radius)),
      seen = new Set();
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++) {
          const cell = cells.get([k[0] + x, k[1] + y, k[2] + z].join(","));
          if (!cell) continue;
          for (const [frame, points] of cell)
            if (
              frame !== exclude &&
              !seen.has(frame) &&
              points.some(
                (p) =>
                  p.reduce((s, v, j) => s + (v - q[j]) ** 2, 0) <= radius ** 2,
              )
            )
              seen.add(frame);
        }
    return seen.size;
  };
}

/** Remove transient returns BEFORE yaw/shape estimation. Then keep only the
 * temporally supported component anchored in the body of the initial box.
 * A low road/wheel-height bridge cannot attach an exterior object to the body.
 * Persistent objects that genuinely touch the body can still be ambiguous. */
export function filterEvidence(frames, c) {
  const locals = frames.map((f) => {
    const points = [];
    for (let i = 0; i < f.xyz.length; i += 3)
      points.push(
        ...localPoint(f.xyz[i], f.xyz[i + 1], f.xyz[i + 2], f.original),
      );
    return points;
  });
  const voting = locals.map((points, i) =>
    frames[i].stats?.competing || frames[i].stats?.touchesBoundary
      ? []
      : points,
  );
  const support = temporalGrid(voting, c.consensusRadius),
    required = c.consensusFrames,
    cellSize = Math.max(0.22, c.voxel * 2),
    cells = new Map();
  const eligible = locals.map(() => []);
  function key(q) {
    return q.map((v) => Math.floor(v / cellSize)).join(",");
  }
  locals.forEach((points, frame) => {
    const p = frames[frame].original;
    for (let i = 0; i < points.length; i += 3) {
      const q = points.slice(i, i + 3),
        outsideXY =
          Math.abs(q[0]) > p[6] / 2 + 0.08 || Math.abs(q[1]) > p[7] / 2 + 0.08;
      if (support(q, frame) < required - 1) continue;
      const k = key(q),
        lowExterior = outsideXY && q[2] < -p[8] * 0.35;
      eligible[frame].push({ offset: i, key: k, lowExterior });
      // Low exterior returns are deferred: they may be real wheels/body, but
      // cannot act as a bridge joining a detached cluster to the vehicle.
      if (lowExterior) continue;
      if (!cells.has(k))
        cells.set(k, { k: k.split(",").map(Number), seed: 0, members: [] });
      const cell = cells.get(k);
      cell.members.push([frame, i]);
      // Seeds must be in the main body, not just in a stray cluster near a corner.
      if (
        Math.abs(q[0]) <= p[6] / 2 + 0.08 &&
        Math.abs(q[1]) <= p[7] / 2 + 0.08 &&
        q[2] > -p[8] * 0.35
      )
        cell.seed++;
    }
  });
  const components = [],
    visited = new Set();
  for (const [k, start] of cells) {
    if (visited.has(k)) continue;
    const queue = [start],
      component = { keys: new Set(), seed: 0 };
    visited.add(k);
    while (queue.length) {
      const cell = queue.pop();
      component.keys.add(cell.k.join(","));
      component.seed += cell.seed;
      for (let x = -1; x <= 1; x++)
        for (let y = -1; y <= 1; y++)
          for (let z = -1; z <= 1; z++) {
            const next = [cell.k[0] + x, cell.k[1] + y, cell.k[2] + z].join(
              ",",
            );
            if (!visited.has(next) && cells.has(next)) {
              visited.add(next);
              queue.push(cells.get(next));
            }
          }
    }
    components.push(component);
  }
  const bodyKeys = new Set(
    components
      .filter((component) => component.seed >= required * 2)
      .flatMap((component) => [...component.keys]),
  );
  function hasBodyAbove(q, height) {
    const k = q.map((v) => Math.floor(v / cellSize));
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = 1; z <= Math.ceil(height / cellSize); z++)
          if (bodyKeys.has([k[0] + x, k[1] + y, k[2] + z].join(",")))
            return true;
    return false;
  }
  return frames.map((f, index) => {
    const chosen = new Set();
    for (const entry of eligible[index]) {
      const q = locals[index].slice(entry.offset, entry.offset + 3);
      if (
        entry.lowExterior
          ? hasBodyAbove(q, f.original[8])
          : bodyKeys.has(entry.key)
      )
        chosen.add(entry.offset);
    }
    const kept = [],
      rejected = [];
    for (let i = 0; i < f.xyz.length; i += 3)
      (chosen.has(i) ? kept : rejected).push(
        f.xyz[i],
        f.xyz[i + 1],
        f.xyz[i + 2],
      );
    return {
      ...f,
      rawXYZ: f.xyz,
      xyz: Float32Array.from(kept),
      rejectedXYZ: Float32Array.from(rejected),
      stats: {
        ...f.stats,
        temporalKept: kept.length / 3,
        temporalRejected: rejected.length / 3,
        supportFrames: required,
      },
    };
  });
}

/** Equal-weight frame endpoints, rather than pooled min/max. XY endpoints use
 * a middle-height belt so ground strips and isolated high returns cannot set
 * length/width. Broad spans and repeated endpoint agreement are both required. */
export function estimateDimensions(frames, baseline, c) {
  const records = frames.map((f) => {
    const all = [],
      belt = [];
    for (let i = 0; i < f.xyz.length; i += 3) {
      const q = localPoint(f.xyz[i], f.xyz[i + 1], f.xyz[i + 2], f.pose);
      all.push(...q);
      if (q[2] >= -baseline[2] * 0.35 && q[2] <= baseline[2] * 0.35)
        belt.push(...q);
    }
    return {
      frame: f.frame,
      all: all.length >= 30 ? bounds(all, 0.01) : null,
      belt: belt.length >= 30 ? bounds(belt, 0.005) : null,
      groundRemoved: !!f.stats?.groundRemoved,
    };
  });
  const size = [...baseline],
    center = [0, 0, 0],
    axes = [false, false, false],
    evidence = [];
  for (let j = 0; j < 3; j++) {
    const witnesses = records.filter((r) => {
      const b = j === 2 ? r.all : r.belt;
      return b && b.size[j] > baseline[j] * 0.65;
    });
    const lows = witnesses.map((r) => (j === 2 ? r.all : r.belt).low[j]),
      highs = witnesses.map((r) => (j === 2 ? r.all : r.belt).high[j]);
    const low = quantile(lows, 0.5),
      high = quantile(highs, 0.5),
      span = high - low;
    const madLow = quantile(
        lows.map((v) => Math.abs(v - low)),
        0.5,
      ),
      madHigh = quantile(
        highs.map((v) => Math.abs(v - high)),
        0.5,
      );
    const stable = Math.max(madLow, madHigh) <= c.endpointTolerance;
    const floorUncertain =
      j === 2 &&
      span < baseline[j] - 0.05 &&
      witnesses.some((r) => r.groundRemoved);
    axes[j] =
      witnesses.length >= c.consensusFrames &&
      Number.isFinite(span) &&
      span / baseline[j] >= c.minScale &&
      span / baseline[j] <= c.maxScale &&
      stable &&
      !floorUncertain;
    if (axes[j]) {
      size[j] =
        Math.abs(span - baseline[j]) < Math.max(0.04, baseline[j] * 0.015)
          ? baseline[j]
          : span;
      center[j] = (high + low) / 2;
    }
    evidence.push({
      axis: ["L", "W", "H"][j],
      frames: witnesses.map((r) => r.frame),
      low,
      high,
      madLow,
      madHigh,
      accepted: axes[j],
      floorUncertain,
    });
  }
  const frameCenters = new Map(
    records.map((r) => [
      r.frame,
      center.map((value, j) => {
        const b = j === 2 ? r.all : r.belt;
        return axes[j] && b && b.size[j] >= size[j] * 0.85
          ? b.center[j]
          : value;
      }),
    ]),
  );
  return { size, center, axes, evidence, frameCenters };
}
