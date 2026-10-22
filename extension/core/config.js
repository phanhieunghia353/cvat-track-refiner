/** Every threshold is explicit and measured in metres/radians unless noted.
 * These are conservative engineering defaults, NOT learned probabilities. */
export const DEFAULTS = Object.freeze({
  maxFrames: 24,
  maxPoints: 1800,
  cropMargin: 1.2,
  voxel: 0.1,
  maxShift: 0.7,
  maxYaw: (12 * Math.PI) / 180,
  rounds: 2,
  minPoints: 35,
  maxScale: 1.65,
  minScale: 0.65,
  matchRadius: 0.35,
  consensusRadius: 0.22,
  consensusFrames: 3,
  endpointTolerance: 0.16,
  boxMargin: 0.08,
  maxCoverageLoss: 0.04,
  maxFrameBytes: 32 * 1024 * 1024,
  maxRange: 1200,
});
export function settings(input = {}) {
  const c = { ...DEFAULTS, ...input };
  const rules = {
    maxFrames: [3, 48, true],
    maxPoints: [300, 4000, true],
    cropMargin: [0.3, 3],
    voxel: [0.04, 0.3],
    maxShift: [0.05, 1.5],
    maxYaw: [0.01, Math.PI / 6],
    rounds: [1, 3, true],
    consensusRadius: [0.1, 0.4],
    consensusFrames: [3, 8, true],
    endpointTolerance: [0.05, 0.25],
    boxMargin: [0.02, 0.15],
    maxCoverageLoss: [0.01, 0.08],
  };
  for (const [key, [lo, hi, integer]] of Object.entries(rules))
    if (
      !Number.isFinite(c[key]) ||
      c[key] < lo ||
      c[key] > hi ||
      (integer && !Number.isInteger(c[key]))
    )
      throw Error(`Cấu hình ${key} ngoài giới hạn ${lo}–${hi}.`);
  return c;
}
