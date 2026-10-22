import { worldPoint } from "../core/geometry.js";

/** An observed curved body, roof, ends and a one-frame protrusion. This tests
 * registration with overlapping surfaces, not semantic car recognition. */
export function makeReconstructionDemo(count = 10) {
  const shapes = [],
    frames = [],
    truth = [];
  let seed = 83;
  const noise = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return (seed / 4294967296 - 0.5) * 0.012;
  };
  for (let frame = 0; frame < count; frame++) {
    const actual = [
      frame * 0.3,
      Math.sin(frame * 0.25),
      1.1,
      0,
      0,
      frame * 0.03,
      4.7,
      1.9,
      1.65,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ];
    truth.push(actual);
    const p = [...actual];
    if (frame !== 0) {
      p.splice(
        0,
        3,
        ...worldPoint(
          0.1 * Math.sin(frame * 1.3),
          0.12 * Math.cos(frame * 0.8),
          0.04 * Math.sin(frame),
          p,
        ),
      );
      p[5] += 0.035 * Math.sin(frame * 0.9);
    }
    // Keep an intentionally generous box: core reconstruction must not resize it.
    p.splice(6, 3, 5.2, 2.25, 1.9);
    const xyz = [];
    for (let x = -2.3; x <= 2.31; x += 0.13)
      for (let z = -0.72; z <= 0.82; z += 0.11)
        for (const sign of [-1, 1]) {
          const y =
            sign * (0.95 - 0.16 * Math.max(0, z + 0.05) - 0.025 * x * x);
          xyz.push(
            ...worldPoint(x + noise(), y + noise(), z + noise(), actual),
          );
        }
    for (let x = -2.3; x <= 2.31; x += 0.13)
      for (let y = -0.7; y <= 0.71; y += 0.12)
        xyz.push(
          ...worldPoint(
            x + noise(),
            y + noise(),
            0.82 - 0.025 * x * x - 0.1 * y * y + noise(),
            actual,
          ),
        );
    for (const x of [-2.3, 2.3])
      for (let y = -0.78; y <= 0.79; y += 0.12)
        for (let z = -0.72; z <= 0.62; z += 0.12)
          xyz.push(
            ...worldPoint(x + noise(), y + noise(), z + noise(), actual),
          );
    if (frame === 3)
      for (let k = 0; k < 20; k++)
        xyz.push(
          ...worldPoint(
            0.5 + (k % 5) * 0.025,
            1.18,
            0.25 + Math.floor(k / 5) * 0.025,
            actual,
          ),
        );
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
    frames.push({
      frame,
      points: p,
      xyz: Float32Array.from(xyz),
      stats: { kept: xyz.length / 3, coreCrop: true },
    });
  }
  return {
    frames,
    truth,
    referenceFrame: 0,
    track: {
      clientID: 1,
      id: 101,
      label_id: 1,
      frame: 0,
      source: "auto",
      group: 0,
      attributes: [],
      elements: [],
      shapes,
    },
  };
}
