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

## Algorithm implemented in 0.2

1. Uniformly sample visible frames within the interval, preserving first/last visible samples. This is a finite budget, not exhaustive trajectory observation.
2. Expand each search region by configurable metres. Exclude known other cuboids, estimate horizontal ground near the original floor, voxelize and region-grow a component supported by the initial box. Flag crop-edge contact and competing components. These checks remain heuristic.
3. **Before estimating yaw or size**, transform observations to their pre-label object coordinates. `evidence.js` counts distinct-frame support within 0.22 m, requiring three frames including the queried frame. Density within one frame cannot supply multiple votes. Unsafe crops cannot vote. This assumes pre-label alignment is already approximately correct; it is not a global registration solution.
4. Retain supported components seeded in the main body of the initial box. Low exterior points cannot join body components; retain them only if supported body cells exist above them. This prevents a low road/wheel-height bridge from attaching a detached exterior cluster in the regression fixture, while allowing repeated real surfaces outside an undersized box. Persistent touching clutter remains ambiguous.
5. Search a local yaw range using trimmed footprint area with a penalty for deviation. No 90°/180° semantic reorientation. Estimate dimensions using equal-weight per-frame endpoint medians and endpoint median absolute deviation, requiring repeated broad spans. XY uses a middle-height body belt; uncertain ground prevents height shrinkage. Near-baseline size changes below max(4 cm, 1.5%) retain the baseline size. These are engineering thresholds, not probabilities.
6. Register each frame against a template made without that frame. Bounded coordinate descent uses truncated nearest-neighbor loss plus a prior on deviation from pre-label. Reject low support or corrections outside limits. Repeat two rounds, then recompute dimensions from the final accepted set and recenter using each broad observation's midpoint (otherwise the common midpoint). If final recentering violates limits, return no applicable proposal.
7. Preview only accepted point sets by default. Optional gray layers expose discarded crop points and rejected frames. Keep the actual reference frame's original/proposed box offsets in fused mode; single-frame mode always uses that frame's original axes. No synthetic common-center comparison hides a proposed displacement.
8. Generate dense visible-frame keys and pin interval neighbors. Preserve original keys, visibility, attributes and non-target metadata. Accepted samples interpolate pose corrections only across adjacent accepted samples; rejected samples break that interpolation. No general key reduction is implemented.

`rawXYZ` means the bounded crop entering temporal filtering, not the full downloaded cloud. `rejectedXYZ` contains only points discarded at this stage; ground/neighbor/crop exclusions are not retained for display. `sizeEvidence` records contributing frame IDs and endpoint disagreement for each dimension. Point counts and support scores describe evidence, not semantic correctness.

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
