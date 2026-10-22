import { localPoint, worldPoint } from "../core/geometry.js";

const EDGES = [
  [0, 1],
  [0, 2],
  [0, 4],
  [1, 3],
  [1, 5],
  [2, 3],
  [2, 6],
  [3, 7],
  [4, 5],
  [4, 6],
  [5, 7],
  [6, 7],
];
function corners(p, reference) {
  const out = [];
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      for (const z of [-1, 1]) {
        const world = worldPoint(
          (x * p[6]) / 2,
          (y * p[7]) / 2,
          (z * p[8]) / 2,
          p,
        );
        out.push(reference ? localPoint(...world, reference) : world);
      }
  return out;
}
/** Pure Canvas2D renderer. Fused colors are frame IDs, not occupancy confidence.
 * Individual-frame mode uses the original box axes for an honest pose overlay. */
export function previewScene(
  result,
  view = "fused",
  options = { size: true, pose: true, showRejected: false },
) {
  if (!result) return;
  const selected = result.frames.find((f) => String(f.frame) === String(view));
  const anchor =
    selected ||
    result.frames.find((f) => f.frame === result.referenceFrame) ||
    result.frames.find((f) => f.accepted) ||
    result.frames[0];
  if (!anchor) return null;
  const layers = [];
  for (let i = 0; i < result.frames.length; i++) {
    const f = result.frames[i];
    if (selected && f !== selected) continue;
    const reference = selected
      ? selected.original
      : options.pose
        ? f.pose
        : f.original;
    function layer(points, color, rejected = false) {
      if (!points?.length) return;
      const xyz = [],
        stride = Math.max(
          1,
          Math.ceil(points.length / 3 / (selected ? 4000 : 700)),
        );
      for (let k = 0; k < points.length; k += 3 * stride)
        xyz.push(
          localPoint(points[k], points[k + 1], points[k + 2], reference),
        );
      layers.push({ xyz, color, rejected, frame: f.frame });
    }
    if (selected || f.accepted)
      layer(f.xyz, `hsl(${(i * 137.5) % 360} 78% 67%)`);
    if (options.showRejected)
      layer(
        !selected && !f.accepted ? f.rawXYZ : f.rejectedXYZ,
        "#8995a7",
        true,
      );
  }
  const reference = selected
    ? anchor.original
    : options.pose
      ? anchor.pose
      : anchor.original;
  const old = corners(anchor.original, reference);
  const next = [...(options.pose ? anchor.pose : anchor.original)];
  if (options.size && result.size) next.splice(6, 3, ...result.size);
  if (result.measuredAxes)
    for (let j = 0; j < 3; j++)
      if (!result.measuredAxes[j]) next[6 + j] = anchor.original[6 + j];
  return {
    layers,
    old,
    proposed: corners(next, reference),
    referenceFrame: anchor.frame,
  };
}
export function drawPreview(
  canvases,
  result,
  view = "fused",
  options = { size: true, pose: true, showRejected: false },
) {
  const scene = previewScene(result, view, options);
  if (!scene) return;
  const { layers, old, proposed } = scene;
  const all = [...layers.flatMap((l) => l.xyz), ...old, ...proposed];
  for (let index = 0; index < canvases.length; index++) {
    const canvas = canvases[index],
      axes = [
        [0, 1],
        [0, 2],
        [1, 2],
      ][index],
      ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(canvas.clientWidth, 240),
      height = Math.max(canvas.clientHeight, 180);
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.fillStyle = "#0b1421";
    ctx.fillRect(0, 0, width, height);
    const lo = axes.map((a) => Math.min(...all.map((q) => q[a]))),
      hi = axes.map((a) => Math.max(...all.map((q) => q[a])));
    const scale = Math.min(
      (width - 35) / Math.max(hi[0] - lo[0], 0.3),
      (height - 35) / Math.max(hi[1] - lo[1], 0.3),
    );
    const center = lo.map((v, j) => (v + hi[j]) / 2),
      project = (q) => [
        width / 2 + (q[axes[0]] - center[0]) * scale,
        height / 2 - (q[axes[1]] - center[1]) * scale,
      ];
    for (const layer of layers) {
      ctx.fillStyle = layer.color;
      ctx.globalAlpha = layer.rejected ? 0.3 : 0.65;
      for (const q of layer.xyz) {
        const [x, y] = project(q);
        ctx.fillRect(x, y, 1.8, 1.8);
      }
    }
    ctx.globalAlpha = 1;
    for (const [vertices, color, dash] of [
      [old, "#f8aa4b", [5, 4]],
      [proposed, "#45e5bd", []],
    ]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.setLineDash(dash);
      ctx.beginPath();
      for (const [a, b] of EDGES) {
        ctx.moveTo(...project(vertices[a]));
        ctx.lineTo(...project(vertices[b]));
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = "#a2b3c9";
    ctx.font = "12px system-ui";
    ctx.fillText(["Top · X/Y", "Side · X/Z", "Front · Y/Z"][index], 10, 18);
  }
}
