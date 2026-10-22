/** Local-only exports. Ordinary reports omit point coordinates; the explicit
 * diagnostic export contains bounded crops, never full PCDs or auth/context. */
export function analysisReport(result, version = "0.3.2") {
  if (result.kind === "reconstruction")
    return {
      version,
      kind: result.kind,
      reference: result.reference,
      range: result.range,
      config: result.config,
      diagnostics: result.diagnostics,
      warnings: result.warnings,
      poses: result.poses,
    };
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
export function diagnosticBundle(result, version = "0.3.2") {
  if (result.kind === "reconstruction")
    return {
      format: "cvat-reconstruction-diagnostic/v1",
      version,
      report: analysisReport(result, version),
      observations: result.observations.map((f) => ({
        frame: f.frame,
        points: [...f.points],
        xyz: Array.from(f.xyz),
        masks: f.masks ? Array.from(f.masks) : undefined,
        stats: { ...f.stats },
      })),
    };
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

/** Snapshot preserves observed geometry, poses, masks and review choices only.
 * It contains no session/credential metadata and is never sent by this module. */
export function reconstructionSnapshot(core, viewer = {}) {
  return {
    ...diagnosticBundle(core),
    format: "cvat-reconstruction-snapshot/v1",
    surfaces: core.surfaces,
    poses: core.poses,
    viewer,
  };
}
