/** Geometry contract: metres, radians, right-handed coordinates. Cuboids are
 * CVAT points [x,y,z,rx,ry,rz,L,W,H,...padding]. Version 0.1 fits upright rigid
 * objects only; it never treats camera-facing direction as vehicle heading. */
export const clone = (value) => JSON.parse(JSON.stringify(value));
export const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export function quantile(values, q) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b),
    i = (sorted.length - 1) * q;
  return sorted[Math.floor(i)] * (1 - (i % 1)) + sorted[Math.ceil(i)] * (i % 1);
}
export function validateTrack(track) {
  if (
    !Number.isInteger(track?.clientID) ||
    !track.shapes?.length ||
    track.elements?.length
  )
    throw Error("Chỉ hỗ trợ cuboid track thông thường.");
  const frames = new Set();
  for (const s of track.shapes) {
    if (
      s.type !== "cuboid" ||
      s.points?.length !== 16 ||
      !s.points.every(Number.isFinite) ||
      !s.points.slice(6, 9).every((n) => n > 0) ||
      !Number.isInteger(s.frame) ||
      frames.has(s.frame)
    )
      throw Error(
        "Track có keyframe/points không hợp lệ (cần cuboid 16 giá trị).",
      );
    if (
      Math.abs(wrap(s.points[3])) > 0.12 ||
      Math.abs(wrap(s.points[4])) > 0.12
    )
      throw Error(
        "Bản đầu chỉ hỗ trợ vật gần thẳng đứng (rx/ry trong ±0,12 rad).",
      );
    frames.add(s.frame);
  }
}
/** Interpolate pose exactly at a key, shortest-turn Euler angles between keys.
 * Attributes/visibility are inherited from the left key, NOT from the first. */
export function stateAt(track, frame) {
  const keys = [...track.shapes].sort((a, b) => a.frame - b.frame);
  let i = -1;
  while (i + 1 < keys.length && keys[i + 1].frame <= frame) i++;
  if (i < 0) return null;
  const left = keys[i],
    right = keys[i + 1];
  const result = clone(left);
  result.frame = frame;
  if (left.frame !== frame) {
    delete result.id;
    result.attributes = [];
    if (right) {
      const t = (frame - left.frame) / (right.frame - left.frame);
      result.points = left.points.map((v, j) =>
        j >= 3 && j <= 5
          ? wrap(v + t * wrap(right.points[j] - v))
          : v + t * (right.points[j] - v),
      );
    }
  }
  return result;
}
// Full XYZ rotation is used for coordinate conversion even though the optimizer
// changes only yaw. This preserves the original small roll/pitch values.
function rotation(p) {
  const a = Math.cos(p[3]),
    b = Math.sin(p[3]),
    c = Math.cos(p[4]),
    d = Math.sin(p[4]),
    e = Math.cos(p[5]),
    f = Math.sin(p[5]);
  return [
    c * e,
    -c * f,
    d,
    a * f + b * e * d,
    a * e - b * f * d,
    -b * c,
    b * f - a * e * d,
    b * e + a * f * d,
    a * c,
  ];
}
export function localPoint(x, y, z, p) {
  const r = rotation(p),
    dx = x - p[0],
    dy = y - p[1],
    dz = z - p[2];
  return [
    r[0] * dx + r[3] * dy + r[6] * dz,
    r[1] * dx + r[4] * dy + r[7] * dz,
    r[2] * dx + r[5] * dy + r[8] * dz,
  ];
}
export function worldPoint(x, y, z, p) {
  const r = rotation(p);
  return [
    p[0] + r[0] * x + r[1] * y + r[2] * z,
    p[1] + r[3] * x + r[4] * y + r[5] * z,
    p[2] + r[6] * x + r[7] * y + r[8] * z,
  ];
}
export function bounds(points, trim = 0.015) {
  const axes = [[], [], []];
  for (let i = 0; i < points.length; i += 3)
    for (let j = 0; j < 3; j++) axes[j].push(points[i + j]);
  const low = axes.map((a) => quantile(a, trim)),
    high = axes.map((a) => quantile(a, 1 - trim));
  return {
    low,
    high,
    size: low.map((v, j) => high[j] - v),
    center: low.map((v, j) => (high[j] + v) / 2),
  };
}
/** Deterministic voxel sampling, then evenly spaced reduction. Bounding memory
 * is part of correctness: long jobs must not retain every raw PCD frame. */
export function voxelSample(points, voxel = 0.1, limit = 1800) {
  const cells = new Map();
  for (let i = 0; i < points.length; i += 3) {
    const key = `${Math.floor(points[i] / voxel)},${Math.floor(points[i + 1] / voxel)},${Math.floor(points[i + 2] / voxel)}`;
    if (!cells.has(key))
      cells.set(key, [points[i], points[i + 1], points[i + 2]]);
  }
  const values = [...cells.values()],
    stride = Math.max(1, values.length / limit),
    out = [];
  for (let i = 0; i < values.length; i += stride)
    out.push(...values[Math.floor(i)]);
  return Float32Array.from(out);
}
export function sampleFrames(track, start, end, maxFrames) {
  const visible = [];
  for (let f = start; f <= end; f++)
    if (stateAt(track, f) && !stateAt(track, f).outside) visible.push(f);
  if (visible.length <= maxFrames) return visible;
  // Uniform sampling gives sparse and dense keys the same temporal opportunity.
  return [
    ...new Set(
      Array.from(
        { length: maxFrames },
        (_, i) =>
          visible[Math.round((i * (visible.length - 1)) / (maxFrames - 1))],
      ),
    ),
  ];
}
