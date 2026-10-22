# Changelog

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
