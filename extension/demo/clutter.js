import { makeDemo } from "./generate.js";
import { localPoint, worldPoint } from "../core/geometry.js";

/** Near-correct prelabels with a vehicle-shaped body, clutter at the rear,
 * and a low bridge that defeats a simple per-frame connected-component crop.
 * This is a counterexample, not a reconstruction of the user's private scan. */
export function makeClutteredTrack({ persistent = false } = {}) {
  const data = makeDemo(12);
  for (const f of data.frames) {
    f.points = [...data.truth[f.frame]];
    data.track.shapes[f.frame].points = [...f.points];
    const points = [];
    for (let i = 0; i < f.xyz.length; i += 3) {
      const q = localPoint(f.xyz[i], f.xyz[i + 1], f.xyz[i + 2], f.points);
      // Lower bonnet and narrower roof; the evidence is no longer a perfect box.
      if (q[0] > 1.1) q[2] = Math.min(q[2], 0.8 - (q[0] - 1.1) * 0.55);
      if (q[2] > 0.3) q[1] *= 1 - (q[2] - 0.3) * 0.3;
      points.push(...worldPoint(...q, f.points));
    }
    if (persistent || f.frame === 8) {
      for (let i = 0; i < 450; i++) {
        const q = [
          -3.1 + (i % 15) * 0.025,
          0.85 + (Math.floor(i / 15) % 6) * 0.075,
          -0.72 + Math.floor(i / 90) * 0.26,
        ];
        points.push(...worldPoint(...q, f.points));
      }
      for (let x = -3.1; x <= -2.2; x += 0.08)
        points.push(...worldPoint(x, 0.95, -0.72, f.points));
    }
    f.xyz = Float32Array.from(points);
    f.stats = { kept: f.xyz.length / 3 };
  }
  return data;
}
