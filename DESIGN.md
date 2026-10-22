# Architecture and extension points

## Coordinate and data contracts

All lengths are metres and all angles radians. CVAT points have 16 values: center xyz, XYZ Euler roll/pitch/yaw, L/W/H, then unchanged padding. `geometry.js` applies the full XYZ matrix for transforms; the optimizer only adjusts yaw. Never derive heading from which end faces the sensor, or use sensor-relative displacement as world velocity without ego-motion compensation.

`stateAt(track, frame)` copies an exact key unchanged and interpolates centers/dimensions and shortest-turn angles between keys. Visibility and flags come from the left key. Newly generated keys use empty mutable attributes to inherit prior state without replaying an old attribute change.

An input observation is `{frame, points, xyz: Float32Array, stats}`. `refineTrack()` returns an isolated result with per-frame `original`, `pose`, `accepted`, diagnostics, shared `size`, `measuredAxes` and a bounded template. It never calls CVAT or mutates its input. A future learned refiner should implement this result contract, not be embedded in the UI/bridge.

## Data flow

```text
Toolbar click → extension panel → MAIN-world adapter → live annotation snapshot
                               ↓
Same-origin GET PCD → ArrayBuffer transfer → worker parse → bounded object crop
                                                           ↓
                     proposal ← multi-frame refinement ← sampled observations
                        ↓
                  Canvas preview + diagnostics
                        ↓ explicit Apply only
              fresh preflight → local backup → single native Commit → audit/refresh
```

`cvatBridge` is serialized into the page, so it must be self-contained. Do not close over module imports in that function. Store discovery is isolated from fitting; modify this adapter when CVAT internals change. Extension errors must not silently fall back to REST mutations.

## Algorithm implemented in 0.1

1. Uniformly sample visible frames within the interval, preserving first/last visible samples. This is a finite budget, not exhaustive trajectory observation.
2. Expand each search region by configurable metres. Exclude points inside known other cuboids, estimate a horizontal ground mode in the halo near the original floor, voxelize, and region-grow the component supported by the initial box. Flag crop-edge contact and competing components. This is a heuristic and may fail on touching objects.
3. Search a local yaw range using trimmed footprint area, with a penalty for deviation. No 90°/180° semantic reorientation.
4. Balance per-frame samples in object coordinates, estimate trimmed extents, and require repeated broad spans before measuring a dimension. Bounds on scale and pose prevent uncontrolled growth. Observability thresholds are tunable engineering assumptions.
5. Adjust the common origin, then register each frame against a template made without that frame. A bounded coordinate-descent search uses truncated nearest-neighbor loss plus a prior on deviation from pre-label. Reject low support or corrections outside limits.
6. Repeat for two rounds by default. Rejected observations do not enter subsequent shape estimates. Accepted samples provide interpolation of local pose corrections only across adjacent accepted samples; rejected samples break that interpolation.
7. Generate a draft with dense visible-frame keys and pin interval neighbors. Keep every original key, visibility, attributes and non-target metadata. No general key reduction is implemented.

Current geometry scoring is not an amodal learned shape model, visibility ray tracer, articulated tracker, global pose-graph optimizer or calibrated uncertainty estimator. Partial planar observations remain ambiguous. Tests need actual diverse clouds before changing thresholds or increasing acceptance.

## Mutations, IDs and ambiguity

The native Commit removes/replaces only the selected client object and provides one CVAT history action. Client IDs can change. Server IDs assigned while preview is open are adopted; baseline fingerprints ignore serialization IDs but compare content. Preflight captures the latest full export for backup, and an exact second comparison rejects edits between backup and Commit.

The adapter validates draft metadata, keyframes, point types, geometry limits, visibility and interval before writing. It compares unrelated tracks/shapes/tags exactly after the operation. Target content is compared without IDs. Audit is detection after local mutation, not a guarantee against every host side effect. Auto save can persist after Apply; the extension does not pause it or promise server isolation after Apply.

Panel consumes each proposal before sending it. The bridge also consumes a unique token before Commit. An ambiguous error must lead to re-read/inspection, not automatic retries. No whole-job rollback is attempted. Post-commit refresh failures are distinct from pre-commit validation failures.

Dedicated Undo requires matching history and unchanged exported content since this tool's last Apply, then executes one native history action and audits the result. Use native CVAT Undo/Redo if further edits have occurred. Do not implement Undo by importing a whole snapshot over unrelated work.

## Resource limits and cancellation

Only one raw download at a time, streamed with a 32 MB hard cap and a 45-second timeout. PCD parsing/allocation are bounded; compressed output is capped at 128 MB. Raw buffers are transferred to the worker. Full clouds are released after cropping. Frame count, crop count and template size are capped. Stop terminates the worker and aborts the in-flight page fetch; no analysis has access to write operations.

No absolute paths, hardcoded account IDs, job IDs, required GPU or external service. API base accepts only same-origin paths. Developer scripts use standard commands and repository-relative paths.

## Useful next iterations

- Evaluate held-out real-cloud tracks with reference labels, occlusion, neighboring vehicles, missing sides and frame-rate/coordinate variations.
- Add visibility-aware face evidence, more reliable ground estimation and multi-hypothesis association before relaxing acceptance.
- Robust global optimization with temporal motion constraints; preserve reliable manual anchors.
- Reduce dense keys while bounding interpolation error and retaining attribute/visibility keys.
- Add isolated adapters for filtered frames, more CVAT versions and alternative point-cloud responses.
- Any learned module should be optional and preserve offline operation and reviewable proposals.
