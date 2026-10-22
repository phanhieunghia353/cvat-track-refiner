import {
  bounds,
  localPoint,
  worldPoint,
  quantile,
  wrap,
  voxelSample,
} from "../core/geometry.js";
import { settings } from "../core/config.js";
import { filterEvidence, estimateDimensions } from "./evidence.js";
import { boxCoverage } from "./validation.js";

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
      area + 0.12 * initial.size[0] * initial.size[1] * (angle / c.maxYaw) ** 2
    );
  };
  const original = cost(0);
  let best = { angle: 0, cost: original };
  for (let a = -c.maxYaw; a <= c.maxYaw + 1e-6; a += Math.PI / 360) {
    const value = cost(a);
    if (value < best.cost) best = { angle: a, cost: value };
  }
  return original > 0 && (original - best.cost) / original > 0.06
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
  const originalCost = poseCost(frame, frame.original, nearest, c);
  if (originalCost.loss <= best.loss) {
    p = [...frame.original];
    best = originalCost;
  }
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
  const c = settings(options);
  progress({ stage: "consensus" });
  const frames = filterEvidence(
    input.map((f) => ({
      ...f,
      original: [...f.points],
      pose: [...f.points],
    })),
    c,
  );
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
        preserveGeometry: true,
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
    const estimate = estimateDimensions(active, baseline, c);
    axes = estimate.axes;
    size = estimate.size;
    const offset = estimate.center;
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
  let accepted = usable.filter((f) => !f.rejected && (f.support || 0) >= 0.55);
  // Registration support is provisional. Recentring changes actual geometry,
  // so audit that final box against this frame and a frozen leave-one-out set.
  let finalEstimate = estimateDimensions(accepted, baseline, c);
  axes = finalEstimate.axes;
  size = finalEstimate.size;
  const registered = new Map(accepted.map((f) => [f, [...f.pose]]));
  for (const f of accepted) {
    const proposed = [...f.pose];
    const offset =
      finalEstimate.frameCenters.get(f.frame) || finalEstimate.center;
    proposed.splice(0, 3, ...worldPoint(...offset, f.pose));
    if (withinLimits(proposed, f.original, c)) f.pose = proposed;
  }
  const frozen = accepted.map((f) => ({ frame: f, pose: [...f.pose] }));
  function evaluate(f, pose, nearest) {
    const box = [...pose];
    for (let j = 0; j < 3; j++)
      box[6 + j] = axes[j] ? size[j] : f.original[6 + j];
    const coverage = boxCoverage(f.xyz, f.original, box, c);
    const before = poseCost(f, f.original, nearest, c),
      after = poseCost(f, pose, nearest, c);
    return {
      safe:
        coverage.safe &&
        after.ratio >= 0.55 &&
        after.loss <= before.loss + 0.0002,
      coverage,
      lossBefore: before.loss,
      lossAfter: after.loss,
      support: after.ratio,
    };
  }
  for (const f of accepted) {
    const template = voxelSample(
      frozen
        .filter((o) => o.frame !== f)
        .flatMap((o) => localCloud(o.frame.xyz, o.pose, 250)),
      c.voxel,
      10000,
    );
    const nearest = makeGrid(template, c.matchRadius);
    const centered = evaluate(f, f.pose, nearest);
    let selected = centered;
    f.validation = { stage: "final-box", centered };
    if (!centered.safe) {
      const fallback = evaluate(f, registered.get(f), nearest);
      f.validation.registered = fallback;
      if (fallback.safe) {
        f.pose = registered.get(f);
        selected = fallback;
        f.validation.decision = "keep-registration";
      } else {
        f.rejected = true;
        f.reason =
          "Box cuối làm mất điểm hoặc không khớp mẫu; giữ nguyên pre-label.";
        f.validation.decision = "preserve";
      }
    } else f.validation.decision = "recentered";
    f.support = selected.support;
  }
  accepted = accepted.filter((f) => !f.rejected);
  // Removing a failed pose changes the dimensional witnesses. Recompute size
  // without reapplying an unchecked centre offset. Every pass removes frames
  // or terminates; at most one pass per input frame is possible.
  for (let pass = 0; pass <= frames.length; pass++) {
    finalEstimate = estimateDimensions(accepted, baseline, c);
    axes = finalEstimate.axes;
    size = finalEstimate.size;
    const snapshot = accepted.map((f) => ({ frame: f, pose: [...f.pose] }));
    const failed = [];
    for (const f of accepted) {
      const template = voxelSample(
        snapshot
          .filter((o) => o.frame !== f)
          .flatMap((o) => localCloud(o.frame.xyz, o.pose, 250)),
        c.voxel,
        10000,
      );
      const audit = evaluate(f, f.pose, makeGrid(template, c.matchRadius));
      f.validation.final = audit;
      if (!audit.safe) {
        failed.push(f);
        f.reason =
          "Box cuối chưa qua kiểm tra từng frame; giữ nguyên pre-label.";
        f.validation.decision = "preserve";
        continue;
      }
      f.support = audit.support;
      const box = [...f.pose],
        sizeOnly = [...f.original];
      for (let j = 0; j < 3; j++)
        if (axes[j]) box[6 + j] = sizeOnly[6 + j] = size[j];
      f.geometryChecks = {
        combined: audit.coverage,
        size: boxCoverage(f.xyz, f.original, sizeOnly, c),
        pose: boxCoverage(f.xyz, f.original, f.pose, c),
      };
    }
    if (!failed.length) break;
    const bad = new Set(failed);
    accepted = accepted.filter((f) => !bad.has(f));
    if (accepted.length < c.consensusFrames) break;
  }
  if (accepted.length < c.consensusFrames || !axes.some(Boolean))
    return {
      applicable: false,
      reason: "Box cuối chưa qua kiểm tra đủ frame; giữ nguyên pre-label.",
      frames: frames.map((f) => ({
        ...f,
        pose: f.original,
        accepted: false,
        preserveGeometry: true,
        reason: f.reason || "Chưa đủ bằng chứng",
      })),
      size: null,
      template: new Float32Array(),
      warnings,
    };
  const preserved = frames.length - accepted.length;
  if (preserved)
    warnings.push(
      `${preserved} frame mẫu giữ toàn bộ box pre-label; không truyền kích thước/tư thế qua các mẫu này.`,
    );
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
    sizeEvidence: finalEstimate.evidence,
    referenceFrame: accepted[Math.floor(accepted.length / 2)].frame,
    warnings,
    template,
    frames: frames.map((f) => ({
      ...f,
      accepted: accepted.includes(f),
      preserveGeometry: !accepted.includes(f),
      reason: accepted.includes(f)
        ? "Khớp mẫu và qua kiểm tra box cuối"
        : f.reason || "Ít điểm / vùng tìm chưa đủ / có vật cạnh tranh",
      pose: accepted.includes(f) ? f.pose : f.original,
      shift: accepted.includes(f)
        ? Math.hypot(...f.pose.slice(0, 3).map((v, j) => v - f.original[j]))
        : 0,
      yaw: accepted.includes(f) ? wrap(f.pose[5] - f.original[5]) : 0,
    })),
  };
}
