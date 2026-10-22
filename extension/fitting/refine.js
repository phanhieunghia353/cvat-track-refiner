import {
  bounds,
  clamp,
  localPoint,
  worldPoint,
  quantile,
  wrap,
  voxelSample,
} from "../core/geometry.js";
import { settings } from "../core/config.js";

function localCloud(xyz, p, limit = 400) {
  const out = [],
    stride = Math.max(1, Math.floor(xyz.length / 3 / limit));
  for (let i = 0; i < xyz.length; i += 3 * stride)
    out.push(...localPoint(xyz[i], xyz[i + 1], xyz[i + 2], p));
  return out;
}
/** Coarse yaw uses a trimmed footprint rectangle. The search is restricted to
 * the initial heading: a side plane cannot identify semantic front/back. */
function yawFromFootprint(frame, c) {
  const cloud = localCloud(frame.xyz, frame.original),
    initial = bounds(cloud);
  const cost = (angle) => {
    const cs = Math.cos(angle),
      sn = Math.sin(angle),
      rotated = [];
    for (let i = 0; i < cloud.length; i += 3)
      rotated.push(
        cs * cloud[i] + sn * cloud[i + 1],
        -sn * cloud[i] + cs * cloud[i + 1],
        cloud[i + 2],
      );
    const b = bounds(rotated),
      area = Math.max(0.02, b.size[0]) * Math.max(0.02, b.size[1]);
    return (
      area + 0.015 * initial.size[0] * initial.size[1] * (angle / c.maxYaw) ** 2
    );
  };
  const original = cost(0);
  let best = { angle: 0, cost: original };
  for (let a = -c.maxYaw; a <= c.maxYaw + 1e-6; a += Math.PI / 360) {
    const value = cost(a);
    if (value < best.cost) best = { angle: a, cost: value };
  }
  return original > 0 && (original - best.cost) / original > 0.025
    ? best.angle
    : 0;
}
function makeGrid(points, radius) {
  const cells = new Map();
  for (let i = 0; i < points.length; i += 3) {
    const key = [points[i], points[i + 1], points[i + 2]]
      .map((v) => Math.floor(v / radius))
      .join(",");
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(i);
  }
  return (q) => {
    const k = q.map((v) => Math.floor(v / radius));
    let best = radius * radius;
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++)
          for (const i of cells.get([k[0] + x, k[1] + y, k[2] + z].join(",")) ||
            []) {
            const d =
              (q[0] - points[i]) ** 2 +
              (q[1] - points[i + 1]) ** 2 +
              (q[2] - points[i + 2]) ** 2;
            if (d < best) best = d;
          }
    return best;
  };
}
function poseCost(frame, p, nearest, c) {
  let loss = 0,
    matched = 0,
    count = 0;
  const stride = Math.max(1, Math.floor(frame.xyz.length / 3 / 150));
  for (let i = 0; i < frame.xyz.length; i += 3 * stride) {
    const d = nearest(
      localPoint(frame.xyz[i], frame.xyz[i + 1], frame.xyz[i + 2], p),
    );
    loss += Math.min(d, 0.2 ** 2);
    if (d < (c.matchRadius * 0.8) ** 2) matched++;
    count++;
  }
  const shift = Math.hypot(
      ...p.slice(0, 3).map((v, j) => v - frame.original[j]),
    ),
    angle = Math.abs(wrap(p[5] - frame.original[5]));
  return {
    loss:
      loss / Math.max(count, 1) +
      0.001 * (shift / c.maxShift) ** 2 +
      0.0003 * (angle / c.maxYaw) ** 2,
    ratio: matched / Math.max(count, 1),
  };
}
function withinLimits(p, original, c) {
  return (
    Math.hypot(...p.slice(0, 3).map((v, j) => v - original[j])) <= c.maxShift &&
    Math.abs(wrap(p[5] - original[5])) <= c.maxYaw + 1e-8
  );
}
function refinePose(frame, template, c) {
  const nearest = makeGrid(template, c.matchRadius);
  let p = [...frame.pose],
    best = poseCost(frame, p, nearest, c);
  // Derivative-free robust registration is intentionally small and bounded.
  // It uses a template built WITHOUT this frame, avoiding self-match validation.
  for (const [distance, angle] of [
    [0.12, Math.PI / 90],
    [0.05, Math.PI / 240],
  ])
    for (let pass = 0; pass < 2; pass++) {
      for (const axis of [0, 1, 2, 5])
        for (const sign of [-1, 1]) {
          const q = [...p];
          q[axis] += sign * (axis === 5 ? angle : distance);
          if (!withinLimits(q, frame.original, c)) continue;
          const value = poseCost(frame, q, nearest, c);
          if (value.loss < best.loss) {
            p = q;
            best = value;
          }
        }
    }
  return { pose: p, ...best };
}

/** Pure multi-frame heuristic. It never mutates caller input or annotations.
 * A shared size is estimated from balanced object-coordinate observations;
 * poses are then registered to leave-one-frame-out templates. Diagnostics are
 * evidence scores, not calibrated probabilities or claims of semantic shape. */
export async function refineTrack(input, options = {}, progress = () => {}) {
  const c = settings(options),
    frames = input.map((f) => ({
      ...f,
      original: [...f.points],
      pose: [...f.points],
    }));
  const usable = frames.filter(
    (f) =>
      f.xyz.length / 3 >= c.minPoints &&
      !f.stats?.competing &&
      !f.stats?.touchesBoundary,
  );
  if (usable.length < 3)
    return {
      applicable: false,
      reason:
        "Cần ít nhất 3 frame có đủ điểm, không chạm biên vùng tìm và không có cụm cạnh tranh.",
      frames: frames.map((f) => ({
        ...f,
        pose: f.original,
        accepted: false,
        reason: "Thiếu bằng chứng",
      })),
      size: null,
      template: new Float32Array(),
      warnings: [],
    };
  const baseline = [6, 7, 8].map((j) =>
    quantile(
      frames.map((f) => f.original[j]),
      0.5,
    ),
  );
  for (const f of usable)
    f.pose[5] = wrap(f.original[5] + yawFromFootprint(f, c));
  let size = [...baseline],
    axes = [false, false, false];
  const warnings = [];
  for (let round = 0; round < c.rounds; round++) {
    progress({ stage: "fit", round: round + 1, total: c.rounds });
    const active = usable.filter((f) => !f.rejected);
    if (active.length < 3) break;
    const locals = active.map((f) => localCloud(f.xyz, f.pose)),
      fused = locals.flat(),
      b = bounds(fused);
    const spans = locals.map((p) => bounds(p).size);
    // A tiny visible sliver is not a measured full dimension. Shrinking requires
    // repeated broad coverage; expansion must also have more than one witness.
    axes = b.size.map((v, j) => {
      const witnesses = spans.filter((s) => s[j] > baseline[j] * 0.65).length;
      return (
        Number.isFinite(v) &&
        v / baseline[j] >= c.minScale &&
        v / baseline[j] <= c.maxScale &&
        witnesses >= 2
      );
    });
    size = b.size.map((v, j) => (axes[j] ? v : size[j]));
    const offset = b.center.map((v, j) => (axes[j] ? v : 0));
    for (const f of active) {
      const proposed = [...f.pose],
        center = worldPoint(...offset, f.pose);
      proposed.splice(0, 3, ...center);
      if (withinLimits(proposed, f.original, c)) f.pose = proposed;
      else {
        f.rejected = true;
        f.reason = "Dịch chuyển vượt giới hạn; giữ pre-label.";
      }
    }
    for (let i = 0; i < usable.length; i++) {
      const f = usable[i];
      if (f.rejected) continue;
      const otherPoints = usable
        .filter((other) => other !== f && !other.rejected)
        .flatMap((other) => localCloud(other.xyz, other.pose, 250));
      if (otherPoints.length < 90) continue;
      const template = voxelSample(otherPoints, c.voxel, 10000),
        fit = refinePose(f, template, c);
      const old = poseCost(f, f.original, makeGrid(template, c.matchRadius), c);
      if (fit.ratio >= 0.55 && fit.loss <= old.loss + 0.0002) {
        f.pose = fit.pose;
        f.support = fit.ratio;
      } else {
        f.pose = [...f.original];
        f.rejected = true;
        f.reason = "Không khớp mẫu từ các frame khác; giữ pre-label.";
      }
      if (i % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  const accepted = usable.filter(
    (f) => !f.rejected && (f.support || 0) >= 0.55,
  );
  if (accepted.length < 3 || !axes.some(Boolean))
    return {
      applicable: false,
      reason:
        "Các frame chưa đồng thuận đủ để đề xuất sửa. Tăng vùng tìm hoặc chọn khoảng rõ hơn.",
      frames: frames.map((f) => ({
        ...f,
        pose: f.original,
        accepted: false,
        reason: f.reason || "Chưa đồng thuận",
      })),
      size: null,
      template: new Float32Array(),
      warnings,
    };
  if (axes.some((v) => !v))
    warnings.push(
      "Một số chiều chưa đủ góc nhìn; giữ kích thước pre-label cho các chiều đó.",
    );
  const yawSpread =
    quantile(
      accepted.map((f) => wrap(f.pose[5] - f.original[5])),
      0.9,
    ) -
    quantile(
      accepted.map((f) => wrap(f.pose[5] - f.original[5])),
      0.1,
    );
  if (yawSpread > Math.PI / 18)
    warnings.push(
      "Hiệu chỉnh góc khác nhau nhiều giữa các frame; cần xem kỹ trước Apply.",
    );
  const template = voxelSample(
    accepted.flatMap((f) => localCloud(f.xyz, f.pose, 900)),
    c.voxel,
    14000,
  );
  return {
    applicable: true,
    size,
    measuredAxes: axes,
    warnings,
    template,
    frames: frames.map((f) => ({
      ...f,
      accepted: accepted.includes(f),
      reason: accepted.includes(f)
        ? "Có hỗ trợ từ frame khác"
        : f.reason || "Ít điểm / vùng tìm chưa đủ / có vật cạnh tranh",
      pose: accepted.includes(f) ? f.pose : f.original,
      shift: accepted.includes(f)
        ? Math.hypot(...f.pose.slice(0, 3).map((v, j) => v - f.original[j]))
        : 0,
      yaw: accepted.includes(f) ? wrap(f.pose[5] - f.original[5]) : 0,
    })),
  };
}
