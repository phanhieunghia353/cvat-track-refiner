import { worldPoint, wrap } from "../core/geometry.js";

/** Optional consumer of the reconstruction contract, not part of alignment.
 * The user supplies a common box. No endpoint/extents estimator is consulted.
 * Canonical local yaw composes on the right of CVAT's XYZ rotation matrix. */
export function manualBoxProposal(core, box) {
  if (
    core.format !== "cvat-reconstruction/v1" ||
    !Array.isArray(box) ||
    box.length !== 16 ||
    !box.every(Number.isFinite) ||
    !box.slice(6, 9).every((v) => v > 0) ||
    box[3] !== 0 ||
    box[4] !== 0
  )
    throw Error("Box chung không hợp lệ; bản này hỗ trợ xoay yaw.");
  const frames = core.poses.map((f) => {
    const pose = [...f.pose];
    pose.splice(0, 3, ...worldPoint(...box.slice(0, 3), f.pose));
    pose[5] = wrap(f.pose[5] + box[5]);
    if (f.trusted) {
      if (
        Math.hypot(...pose.slice(0, 3).map((v, j) => v - f.original[j])) >
          core.config.maxShift ||
        Math.abs(wrap(pose[5] - f.original[5])) > core.config.maxYaw
      )
        throw Error(`Box chung vượt giới hạn dịch/xoay ở frame ${f.frame}.`);
      if (
        box
          .slice(6, 9)
          .some(
            (v, j) =>
              v / f.original[6 + j] < core.config.minScale ||
              v / f.original[6 + j] > core.config.maxScale,
          )
      )
        throw Error(`Kích thước vượt giới hạn tại frame ${f.frame}.`);
    }
    return {
      ...f,
      pose: f.trusted ? pose : f.original,
      accepted: f.trusted,
      preserveGeometry: !f.trusted,
      yaw: f.trusted ? wrap(pose[5] - f.original[5]) : 0,
    };
  });
  return {
    kind: "manual-common-box",
    applicable: frames.some((f) => f.accepted),
    size: box.slice(6, 9),
    measuredAxes: [true, true, true],
    frames,
    commonBox: [...box],
    range: core.range,
    warnings: [
      "Box do người dùng chỉnh; không phải dự đoán tự động.",
      "Chỉ truyền qua mẫu đã căn; frame ở giữa là nội suy, chưa kiểm chứng bằng point cloud riêng.",
    ],
  };
}
