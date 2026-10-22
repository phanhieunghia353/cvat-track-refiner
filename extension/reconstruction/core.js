import { settings } from "../core/config.js";
import { wrap } from "../core/geometry.js";
import {
  prepareObservation,
  transformedRecords,
  fuseSurfaces,
} from "./surfaces.js";
import {
  registerObservation,
  matcher,
  alignmentScore,
  alignmentConstraints,
} from "./registration.js";

/** Versioned, box-independent reconstruction contract. Prelabels initialize
 * coordinate transforms and crop hints only; no size/box estimator is called. */
export async function reconstruct(input, options = {}, progress = () => {}) {
  const base = settings(options);
  const c = {
    ...base,
    normalRadius: Math.max(0.3, base.voxel * 3),
    surfaceVoxel: base.voxel,
    maxSurfels: 18000,
    alignPoints: 450,
    targetPoints: 300,
    iterations: 7,
    rounds: 3,
    matchRadius: 0.4,
    huber: 0.035,
    angularScale: 2,
    ...options,
  };
  const limits = {
    normalRadius: [0.15, 0.9],
    surfaceVoxel: [0.04, 0.3],
    maxSurfels: [100, 30000],
    alignPoints: [100, 800],
    targetPoints: [100, 600],
    iterations: [1, 12],
    rounds: [1, 3],
    matchRadius: [0.15, 0.6],
    huber: [0.01, 0.1],
    angularScale: [0.5, 4],
  };
  for (const [name, [lo, hi]] of Object.entries(limits))
    if (!Number.isFinite(c[name]) || c[name] < lo || c[name] > hi)
      throw Error(`Core config ${name} ngoài giới hạn.`);
  if (
    !Array.isArray(input) ||
    input.length < 2 ||
    input.length > base.maxFrames
  )
    throw Error("Core cần 2–48 quan sát trong giới hạn cấu hình.");
  const ids = new Set();
  for (const f of input) {
    if (
      !Number.isInteger(f.frame) ||
      f.frame < 0 ||
      ids.has(f.frame) ||
      f.points?.length !== 16 ||
      !f.points.every(Number.isFinite) ||
      !f.points.slice(6, 9).every((v) => v > 0) ||
      !f.xyz ||
      f.xyz.length % 3 ||
      f.xyz.length > 4001 * 3 ||
      !Array.from(f.xyz).every(Number.isFinite) ||
      (f.masks &&
        (f.masks.length !== f.xyz.length / 3 ||
          !Array.from(f.masks).every(
            (v) => Number.isInteger(v) && v >= 0 && v <= 3,
          )))
    )
      throw Error("Quan sát dựng hình không hợp lệ hoặc vượt giới hạn.");
    ids.add(f.frame);
  }
  for (const name of [
    "maxSurfels",
    "alignPoints",
    "targetPoints",
    "iterations",
    "rounds",
  ])
    if (!Number.isInteger(c[name]))
      throw Error(`Core config ${name} phải nguyên.`);
  for (const name of ["excludedFrames", "pinnedFrames"])
    if (
      options[name] &&
      (!Array.isArray(options[name]) ||
        !options[name].every((id) => Number.isInteger(id) && ids.has(id)))
    )
      throw Error("Danh sách frame loại/ghim không hợp lệ.");
  const excluded = new Set(options.excludedFrames || []),
    pinned = new Set(options.pinnedFrames || []),
    observations = [];
  for (const [i, f] of input.entries()) {
    progress({ stage: "normals", current: i + 1, total: input.length });
    observations.push(prepareObservation(f, c));
    await new Promise((r) => setTimeout(r, 0));
  }
  const usable = observations.filter(
    (f) =>
      !excluded.has(f.frame) &&
      !f.stats?.competing &&
      f.records.filter((r) => r.normal && !r.mask).length >= 35,
  );
  const reference =
    options.referenceFrame ?? usable[Math.floor(usable.length / 2)]?.frame;
  if (!usable.some((f) => f.frame === reference))
    throw Error(
      "Frame tham chiếu thiếu bề mặt hoặc đang bị loại. Chọn frame khác.",
    );
  pinned.add(reference);
  const poses = new Map(observations.map((f) => [f.frame, [...f.original]])),
    solutions = new Map();
  // Grow a connected registration graph out of explicit coordinate anchors.
  // Unknown islands must not vote one another into a sharp but drifting model.
  const connectedSeed = new Set(
    [...pinned].filter((id) => usable.some((f) => f.frame === id)),
  );
  for (let pass = 0; pass < 3; pass++) {
    let added = 0;
    for (const f of usable) {
      if (connectedSeed.has(f.frame)) continue;
      progress({ stage: "bootstrap", current: f.frame, total: usable.length });
      const target = usable
        .filter((other) => connectedSeed.has(other.frame))
        .flatMap((other) =>
          transformedRecords(
            other,
            poses.get(other.frame),
            c.targetPoints,
            "fit",
          ),
        );
      const fit = registerObservation(f, poses.get(f.frame), target, c),
        score = alignmentScore(
          transformedRecords(f, fit.pose, Infinity, "holdout"),
          matcher(target, c.matchRadius),
        );
      solutions.set(f.frame, fit);
      if (
        fit.rank === 4 &&
        score.matches >= 12 &&
        score.support >= 0.35 &&
        score.rmse !== null &&
        score.rmse <= 0.08
      ) {
        poses.set(f.frame, fit.pose);
        connectedSeed.add(f.frame);
        added++;
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    if (!added) break;
  }
  for (let round = 0; round < c.rounds; round++) {
    const snapshot = new Map([...poses].map(([frame, p]) => [frame, [...p]]));
    for (let i = 0; i < usable.length; i++) {
      const f = usable[i];
      progress({
        stage: "registration",
        round: round + 1,
        current: i + 1,
        total: usable.length,
      });
      if (pinned.has(f.frame) || !connectedSeed.has(f.frame)) continue;
      const target = usable
        .filter((other) => other !== f && connectedSeed.has(other.frame))
        .flatMap((other) =>
          transformedRecords(
            other,
            snapshot.get(other.frame),
            c.targetPoints,
            "fit",
          ),
        );
      const fit = registerObservation(f, snapshot.get(f.frame), target, c);
      solutions.set(f.frame, fit);
      poses.set(f.frame, fit.pose);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  const candidates = observations.map((f) => {
    const pose = poses.get(f.frame),
      fit = solutions.get(f.frame),
      target = usable
        .filter((other) => other !== f && connectedSeed.has(other.frame))
        .flatMap((other) =>
          transformedRecords(
            other,
            poses.get(other.frame),
            c.targetPoints,
            "fit",
          ),
        );
    const find = matcher(target, c.matchRadius),
      held = alignmentScore(
        transformedRecords(f, pose, Infinity, "holdout"),
        find,
      ),
      initial = alignmentScore(
        transformedRecords(f, f.original, Infinity, "holdout"),
        find,
      );
    const weak =
        !pinned.has(f.frame) &&
        ((fit?.rank ?? 0) < 4 || !connectedSeed.has(f.frame)),
      valid =
        !excluded.has(f.frame) &&
        usable.includes(f) &&
        (pinned.has(f.frame) ||
          (!weak &&
            held.matches >= 12 &&
            held.support >= 0.35 &&
            held.rmse !== null &&
            held.rmse <= 0.08 &&
            (initial.rmse === null || held.rmse <= initial.rmse + 0.006)));
    return {
      frame: f.frame,
      pose,
      original: f.original,
      rank: fit?.rank ?? null,
      eigenvalues: fit?.eigenvalues || [],
      pinned: pinned.has(f.frame),
      valid,
      trusted: false,
      weak,
      holdout: held,
      initial,
      shift: Math.hypot(...pose.slice(0, 3).map((v, j) => v - f.original[j])),
      yaw: wrap(pose[5] - f.original[5]),
      reason: excluded.has(f.frame)
        ? "Người dùng loại frame"
        : weak
          ? "Thiếu ràng buộc hình học cho tư thế đầy đủ"
          : !valid
            ? "Chưa khớp đủ điểm kiểm tra"
            : "Chờ kiểm tra nối về tham chiếu",
    };
  });
  // A locally self-consistent island must not silently attach to the anchor.
  const connected = new Set(
    [...pinned].filter((id) => usable.some((f) => f.frame === id)),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of candidates)
      if (
        p.valid &&
        !connected.has(p.frame) &&
        Object.entries(p.holdout.neighbors).some(
          ([id, count]) => connected.has(Number(id)) && count >= 8,
        )
      ) {
        connected.add(p.frame);
        changed = true;
      }
  }
  for (const p of candidates) {
    p.trusted = p.valid && connected.has(p.frame);
    p.status = p.trusted ? (p.pinned ? "anchor" : "aligned") : "uncertain";
    if (p.trusted)
      p.reason = p.pinned
        ? "Giữ cố định theo pre-label; đây là mốc hệ tọa độ"
        : "Khớp bề mặt, qua điểm kiểm tra và nối được về mốc";
    else if (p.valid) p.reason = "Nhóm quan sát chưa nối được về mốc";
  }
  // Validate again using only frames that actually survived the first audit.
  // Removing one weak bridge may reveal a weak/disconnected dependent group.
  for (let pass = 0; pass < candidates.length; pass++) {
    const active = candidates.filter((p) => p.trusted),
      failed = [];
    for (const p of active) {
      if (p.pinned) continue;
      const f = observations.find((f) => f.frame === p.frame),
        target = active
          .filter((other) => other !== p)
          .flatMap((other) =>
            transformedRecords(
              observations.find((f) => f.frame === other.frame),
              other.pose,
              c.targetPoints,
              "fit",
            ),
          ),
        find = matcher(target, c.matchRadius);
      p.holdout = alignmentScore(
        transformedRecords(f, p.pose, Infinity, "holdout"),
        find,
      );
      p.initial = alignmentScore(
        transformedRecords(f, p.original, Infinity, "holdout"),
        find,
      );
      const info = alignmentConstraints(
        transformedRecords(f, p.pose, c.alignPoints, "fit"),
        find,
        c,
      );
      p.rank = info.rank;
      p.eigenvalues = info.eigenvalues;
      p.finalAudit = true;
      if (
        info.rank < 4 ||
        p.holdout.matches < 12 ||
        p.holdout.support < 0.35 ||
        p.holdout.rmse === null ||
        p.holdout.rmse > 0.08 ||
        (p.initial.rmse !== null && p.holdout.rmse > p.initial.rmse + 0.006)
      )
        failed.push(p);
    }
    for (const p of failed) {
      p.trusted = false;
      p.valid = false;
      p.status = "uncertain";
      p.reason = "Mẫu cuối thiếu ràng buộc hoặc không qua điểm kiểm tra";
    }
    const reached = new Set(
      active.filter((p) => p.pinned && p.trusted).map((p) => p.frame),
    );
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of active)
        if (
          p.trusted &&
          !reached.has(p.frame) &&
          Object.entries(p.holdout.neighbors).some(
            ([id, count]) => reached.has(Number(id)) && count >= 8,
          )
        ) {
          reached.add(p.frame);
          grew = true;
        }
    }
    for (const p of active)
      if (p.trusted && !reached.has(p.frame)) {
        p.trusted = false;
        p.valid = false;
        p.status = "uncertain";
        p.reason = "Mất đường nối về mốc sau kiểm tra cuối";
        failed.push(p);
      }
    if (!failed.length) break;
  }
  const fused = fuseSurfaces(observations, candidates, c);
  return {
    format: "cvat-reconstruction/v1",
    kind: "reconstruction",
    reference: {
      frame: reference,
      units: "metres",
      convention: "canonical-object-to-native-frame",
      gauge: "fixed-prelabel",
    },
    poses: candidates,
    surfaces: fused.surfaces,
    diagnostics: {
      totalCells: fused.totalCells,
      sampled: fused.sampled,
      trusted: candidates.filter((p) => p.trusted).length,
      total: candidates.length,
      singleFrameCells: fused.surfaces.filter((s) => s.frames.length === 1)
        .length,
      observedOnly: true,
      semanticBodyClassification: false,
      heldout:
        "source index mod 5 = 0; disjoint points, not an independent real-data benchmark",
    },
    config: c,
    observations: input.map((f) => ({ ...f, points: [...f.points] })),
    warnings: [
      "Mốc giữ theo pre-label; chưa chứng minh vị trí tuyệt đối đúng.",
      "Bề mặt chỉ quan sát được; vùng khuất chưa được hoàn thiện. Gương/phụ kiện chưa được tự phân loại.",
    ],
  };
}
