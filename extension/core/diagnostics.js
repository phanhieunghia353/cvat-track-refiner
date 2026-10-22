/** Local-only exports. Ordinary reports omit point coordinates; the explicit
 * diagnostic export contains bounded crops, never full PCDs or auth/context. */
export function analysisReport(result, version = "0.2.1") {
  return {
    version,
    applicable: result.applicable,
    reason: result.reason,
    referenceFrame: result.referenceFrame,
    range: result.range,
    config: result.config,
    size: result.size,
    measuredAxes: result.measuredAxes,
    sizeEvidence: result.sizeEvidence,
    warnings: result.warnings,
    frames: result.frames.map(
      ({
        frame,
        original,
        pose,
        accepted,
        preserveGeometry,
        reason,
        shift,
        yaw,
        stats,
        validation,
        geometryChecks,
      }) => ({
        frame,
        original,
        pose,
        accepted,
        preserveGeometry,
        reason,
        shift,
        yaw,
        stats,
        validation,
        geometryChecks,
      }),
    ),
  };
}
export function diagnosticBundle(result, version = "0.2.1") {
  return {
    format: "cvat-track-refiner-crop-diagnostic",
    version,
    report: analysisReport(result, version),
    observations: result.frames.map((f) => ({
      frame: f.frame,
      points: [...f.original],
      xyz: Array.from(f.rawXYZ || f.xyz),
      stats: { ...f.stats },
    })),
  };
}
