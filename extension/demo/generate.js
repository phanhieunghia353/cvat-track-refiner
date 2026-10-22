import { worldPoint } from "../core/geometry.js";

/** Deterministic synthetic rigid vehicle. Different frames see different faces;
 * baseline is undersized, shifted, and yaw-biased. No real job data is bundled. */
export function makeDemo(count = 12) {
  let seed = 72;
  const noise = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return (seed / 4294967296 - 0.5) * 0.025;
  };
  const shapes = [],
    frames = [],
    truth = [];
  for (let frame = 0; frame < count; frame++) {
    const yaw = frame * 0.025,
      truePoints = [
        frame * 0.35,
        Math.sin(frame * 0.2) * 0.4,
        1.0,
        0,
        0,
        yaw,
        4.6,
        1.9,
        1.6,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
      ];
    const p = [...truePoints];
    p[0] += 0.16;
    p[1] -= 0.1;
    p[2] += 0.04;
    p[5] += 0.085;
    p.splice(6, 3, 3.9, 1.65, 1.45);
    shapes.push({
      frame,
      type: "cuboid",
      points: p,
      outside: false,
      occluded: false,
      rotation: 0,
      z_order: 0,
      attributes: [],
    });
    const xyz = [];
    // Two or three complementary faces provide real geometric evidence. This
    // is a controlled test, not a claim of performance on arbitrary vehicles.
    for (let face = 0; face < 6; face++) {
      if (face < 2 && face !== frame % 2) continue;
      if (face >= 2 && face < 4 && face !== 2 + (Math.floor(frame / 3) % 2))
        continue;
      if (face === 5) continue;
      const axis = Math.floor(face / 2),
        sign = face % 2 ? -1 : 1,
        other = [0, 1, 2].filter((j) => j !== axis);
      for (let a = 0; a <= 24; a++)
        for (let b = 0; b <= 10; b++) {
          const q = [0, 0, 0];
          q[axis] = (truePoints[6 + axis] / 2) * sign;
          q[other[0]] = (a / 24 - 0.5) * truePoints[6 + other[0]];
          q[other[1]] = (b / 10 - 0.5) * truePoints[6 + other[1]];
          xyz.push(...worldPoint(...q.map((v) => v + noise()), truePoints));
        }
    }
    frames.push({
      frame,
      points: p,
      xyz: Float32Array.from(xyz),
      stats: { kept: xyz.length / 3 },
    });
    truth.push(truePoints);
  }
  return {
    track: {
      clientID: 1,
      id: 101,
      frame: 0,
      label_id: 1,
      source: "auto",
      group: 0,
      attributes: [],
      elements: [],
      shapes,
    },
    frames,
    truth,
  };
}
