import { localPoint, worldPoint } from "../core/geometry.js";
const edges = [
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
export function boxCorners(p) {
  const out = [];
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      for (const z of [-1, 1])
        out.push(worldPoint((x * p[6]) / 2, (y * p[7]) / 2, (z * p[8]) / 2, p));
  return out;
}
// Recompute display centroids when a frame is hidden: a fused cell must not
// keep an invisible frame's contribution or provenance. Alignment is unchanged.
function visibleSurfaces(core, hidden) {
  if (!hidden.size) return core.surfaces;
  const cells = new Map(),
    size = core.config.surfaceVoxel;
  for (const f of core.observations) {
    if (hidden.has(f.frame)) continue;
    const pose = core.poses.find((p) => p.frame === f.frame);
    if (!pose?.trusted) continue;
    for (let i = 0; i < f.xyz.length; i += 3) {
      const q = localPoint(f.xyz[i], f.xyz[i + 1], f.xyz[i + 2], pose.pose),
        id = q.map((v) => Math.floor(v / size)).join(",");
      if (!cells.has(id)) cells.set(id, new Map());
      const sources = cells.get(id);
      if (!sources.has(f.frame))
        sources.set(f.frame, { sum: [0, 0, 0], count: 0, context: 0 });
      const r = sources.get(f.frame);
      q.forEach((v, j) => (r.sum[j] += v));
      r.count++;
      r.context += Number(!!f.masks?.[i / 3]);
    }
  }
  const surfaces = [];
  for (const [id, sources] of cells) {
    const members = [...sources].map(([frame, r]) => ({
        frame,
        q: r.sum.map((v) => v / r.count),
        context: r.context === r.count,
      })),
      position = [0, 1, 2].map(
        (j) => members.reduce((s, r) => s + r.q[j], 0) / members.length,
      );
    surfaces.push({
      id,
      position,
      frames: members.map((r) => r.frame),
      spread: Math.sqrt(
        members.reduce(
          (s, r) => s + r.q.reduce((v, x, j) => v + (x - position[j]) ** 2, 0),
          0,
        ) / members.length,
      ),
      role: members.every((r) => r.context) ? "context" : "unknown",
    });
  }
  const stride = Math.max(
    1,
    Math.ceil(surfaces.length / core.config.maxSurfels),
  );
  return surfaces.filter((_, i) => i % stride === 0);
}
export function reconstructionScene(core, view = "fused", options = {}) {
  let points = [];
  const hidden = new Set(options.hiddenFrames || []);
  if (view === "fused")
    points = visibleSurfaces(core, hidden)
      .filter((s) => options.context || s.role !== "context")
      .map((s) => ({ ...s, q: s.position }));
  else {
    const f = core.observations.find((f) => String(f.frame) === String(view)),
      p = core.poses.find((f) => String(f.frame) === String(view));
    if (f && p)
      for (let i = 0; i < f.xyz.length; i += 3) {
        if (!options.context && f.masks?.[i / 3]) continue;
        points.push({
          q: localPoint(f.xyz[i], f.xyz[i + 1], f.xyz[i + 2], p.pose),
          frames: [f.frame],
          spread: 0,
          role: f.masks?.[i / 3] ? "context" : "unknown",
          id: `${f.frame}:${i / 3}`,
          support: "single-frame",
        });
      }
  }
  points = points.filter((p) => !p.frames.every((id) => hidden.has(id)));
  return { points, box: options.box ? boxCorners(options.box) : [] };
}
function color(p, mode) {
  if (p.role === "context") return "#788495";
  if (mode === "spread")
    return p.spread > 0.06
      ? "#f8a45b"
      : p.spread > 0.025
        ? "#e8cc69"
        : "#4bdac7";
  if (mode === "support")
    return p.frames.length === 1
      ? "#f4b968"
      : p.frames.length < 4
        ? "#7ac1f4"
        : "#45d6b2";
  return `hsl(${(p.frames[0] * 137.5) % 360} 70% 68%)`;
}
function camera(canvas, vertices, project, zoom = 1) {
  const width = Math.max(canvas.clientWidth, 240),
    height = Math.max(canvas.clientHeight, 180),
    ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.fillStyle = "#0b1421";
  ctx.fillRect(0, 0, width, height);
  const p = vertices.map(project),
    low = [0, 1].map((j) => Math.min(...p.map((v) => v[j]))),
    high = [0, 1].map((j) => Math.max(...p.map((v) => v[j]))),
    center = low.map((v, j) => (v + high[j]) / 2),
    scale =
      Math.min(
        (width - 35) / Math.max(high[0] - low[0], 1),
        (height - 35) / Math.max(high[1] - low[1], 1),
      ) * zoom;
  return {
    ctx,
    width,
    height,
    project: (q) => {
      const v = project(q);
      return [
        width / 2 + (v[0] - center[0]) * scale,
        height / 2 - (v[1] - center[1]) * scale,
        v[2] || 0,
      ];
    },
  };
}
function draw(canvas, scene, project, options) {
  const vertices = [...scene.points.map((p) => p.q), ...scene.box];
  if (!vertices.length) vertices.push([-1, -1, -1], [1, 1, 1]);
  const cam = camera(canvas, vertices, project, options.viewZoom || 1),
    points = scene.points
      .map((p) => ({ ...p, screen: cam.project(p.q) }))
      .sort((a, b) => a.screen[2] - b.screen[2]);
  for (const p of points) {
    cam.ctx.fillStyle = color(p, options.colorBy);
    cam.ctx.globalAlpha = p.role === "context" ? 0.25 : 0.8;
    cam.ctx.fillRect(p.screen[0] - 0.9, p.screen[1] - 0.9, 1.8, 1.8);
  }
  cam.ctx.globalAlpha = 1;
  if (scene.box.length) {
    cam.ctx.strokeStyle = "#4ce3ba";
    cam.ctx.lineWidth = 1.4;
    cam.ctx.beginPath();
    for (const [a, b] of edges) {
      const x = cam.project(scene.box[a]),
        y = cam.project(scene.box[b]);
      cam.ctx.moveTo(x[0], x[1]);
      cam.ctx.lineTo(y[0], y[1]);
    }
    cam.ctx.stroke();
  }
  if (options.label) {
    cam.ctx.fillStyle = "#a2b3c9";
    cam.ctx.font = "12px system-ui";
    cam.ctx.fillText(options.label, 10, 18);
  }
  return points;
}
/** CPU Canvas projection works without WebGL/GPU libraries. Drag orbit, scroll
 * zoom, keyboard-friendly angle sliders and click-to-inspect provenance. */
export class ReconstructionViewer {
  constructor(canvas, orthos, onPick = () => {}) {
    this.canvas = canvas;
    this.orthos = orthos;
    this.onPick = onPick;
    this.yaw = -0.65;
    this.pitch = 0.5;
    this.zoom = 1;
    this.scene = { points: [], box: [] };
    this.options = {};
    canvas.onpointerdown = (e) => {
      this.drag = { x: e.clientX, y: e.clientY, moved: 0 };
      canvas.setPointerCapture(e.pointerId);
    };
    canvas.onpointermove = (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x,
        dy = e.clientY - this.drag.y;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      this.yaw += dx * 0.008;
      this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + dy * 0.008));
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.render();
    };
    canvas.onpointerup = (e) => {
      if (this.drag?.moved < 4) {
        const rect = canvas.getBoundingClientRect(),
          x = e.clientX - rect.left,
          y = e.clientY - rect.top,
          p = this.screen
            ?.map((p) => ({
              p,
              d: Math.hypot(p.screen[0] - x, p.screen[1] - y),
            }))
            .sort((a, b) => a.d - b.d)[0];
        if (p?.d < 12) this.onPick(p.p);
      }
      this.drag = null;
    };
    canvas.onwheel = (e) => {
      e.preventDefault();
      this.zoom = Math.min(
        3,
        Math.max(0.5, this.zoom * Math.exp(-e.deltaY * 0.001)),
      );
      this.render();
    };
  }
  set(core, view, options) {
    this.scene = reconstructionScene(core, view, options);
    this.options = options;
    this.render();
  }
  render() {
    const c = Math.cos(this.yaw),
      s = Math.sin(this.yaw),
      cp = Math.cos(this.pitch),
      sp = Math.sin(this.pitch),
      project = (q) => {
        const x = c * q[0] - s * q[1],
          y = s * q[0] + c * q[1];
        return [x, cp * q[2] - sp * y, cp * y + sp * q[2]];
      };
    this.screen = draw(this.canvas, this.scene, project, {
      ...this.options,
      viewZoom: this.zoom,
    });
    for (let i = 0; i < this.orthos.length; i++) {
      const [a, b] = [
        [0, 1],
        [0, 2],
        [1, 2],
      ][i];
      draw(this.orthos[i], this.scene, (q) => [q[a], q[b], 0], {
        ...this.options,
        label: ["Top · X/Y", "Side · X/Z", "Front · Y/Z"][i],
      });
    }
  }
}
