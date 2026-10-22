# Changelog

## 0.3.0 · 22 October 2026

- Introduce `cvat-reconstruction/v1`: observed surface samples, per-frame poses, gauge, provenance and internal validation, independent of the box fitter.
- Retain bounded crop context with masks. Estimate covariance normals; bootstrap a connected graph from fixed/pre-label anchors, then use bounded robust point-to-plane alignment. Recheck final information rank, held-out support and graph reachability after removing failed frames.
- Keep single-frame regions, per-frame surface votes and spread; report weak/disconnected observations. No semantic body/mirror classification, hidden-surface completion or automatic box size in core mode.
- Add CPU Canvas 3D orbit/picking, orthographic views, frame visibility/exclusion and reference/pin controls.
- Add optional numeric common-box editing with explicit proposal creation. Project by rigid per-frame transforms through the existing backup/native Commit/Undo/audit boundary. Unknown samples stop propagation; unsampled intervals remain interpolation.
- Add versioned local snapshots/diagnostics and CLI replay. Keep the legacy fitter as a separate comparison mode. No runtime dependencies, GPU requirement, host-specific paths or broader extension permissions.
- 66 tests passed, including full core-to-native-Commit mocks. Browser verified with synthetic data; favorable synthetic alignment is not a real-cloud accuracy guarantee. This is the first reconstruction workbench, not a complete amodal vehicle model.

## 0.2.1 · 22 October 2026

- Revalidate actual per-frame boxes after final recentering, checking newly excluded original-covered trusted points and leave-one-out registration loss/support.
- Fall back to the registered pose if it passes; otherwise preserve full pre-label geometry, including size. Recompute dimensions after removing failed observations.
- Pin held sparse frames and block both size/pose interpolation through them. Use common geometry resolution for preview and draft, including size-only/pose-only refusals.
- Export detailed final audits in ordinary reports; add an explicit local crop diagnostic and replay script. No automatic point-cloud upload.
- 53 automated tests passed. The privately supplied summary report was read locally; its raw cloud was unavailable, so the exact reported frame remains unverified.

## 0.2.0 · 22 October 2026

- Filter temporal evidence before yaw/size fitting. Distinct frames, rather than point density, supply votes; unsafe crops cannot vote.
- Require body-connected evidence and prevent low exterior returns from bridging to a detached cluster. This is a conservative heuristic, not semantic segmentation or complete ghost removal.
- Estimate dimensions from per-frame endpoint medians and disagreement, using a body-height belt for length/width. Recompute dimensions on the final accepted poses and recenter consistently.
- Show discarded crop points in optional gray layers; exclude rejected frames from default fusion. Preserve real original/proposed offsets in the preview.
- Add a near-correct vehicle demo with exterior clutter, regression tests and detailed evidence in analysis reports.
- Keep the existing CVAT adapter/transaction behavior: analysis is read-only, explicit native Apply, no page reload, no direct annotation REST writes, Auto save permitted, local backup and native Undo.
- 47 automated tests passed; synthetic browser worker verified. No actual data from the reported frame was analyzed and no live CVAT annotation was changed during development.

## 0.1.0

Initial experimental geometric refiner, local proposal preview, PCD worker, native CVAT Commit/Undo adapter and bounded processing. Earlier release artifacts are preserved separately.
