# Architecture and extension points

v0.3.0 implements the first box-independent reconstruction core. See [RECONSTRUCTION-CORE.md](RECONSTRUCTION-CORE.md) for the broader target and [CORE-USER-GUIDE.md](CORE-USER-GUIDE.md) for actual behavior. The prior v0.2.1 fitter remains a separate comparison mode.

## Reconstruction core implemented in v0.3.0

`reconstruction/core.js` returns `cvat-reconstruction/v1` with reference/gauge, per-frame poses, observed surface samples, diagnostics, tunable config and bounded observations. It does not return `size` or call the old fitter. `box.js` is an optional manual consumer which composes a user-supplied box through trusted poses and reuses the existing draft/native-state boundary.

- Core cropping uses a bounded reservoir and voxel budget. Neighbor/ground hints are masks, not hard point deletion; raw PCDs are still released. Source point indices refer to the saved crop, not original PCD offsets.
- Covariance normals use a local radius with bounded neighbors. Weak/non-planar neighborhoods retain their points but do not vote for alignment.
- A fixed pre-label reference defines the canonical gauge. Bootstrap registration grows from that reference/user-pinned anchors; unknown islands cannot mutually justify joining the model. Outer rounds use frozen poses and leave-one-frame-out targets from the connected set.
- The optimizer uses point-to-plane residuals, Huber weights, trimming, bounded Gauss-Newton updates and rank of the scaled 4-DOF normal matrix. Damping does not turn missing constraints into evidence. It optimizes local xyz/yaw only, not full SE(3), and remains sensitive to initialization/outliers.
- Source indices divisible by five are held out of point fitting. Final support/residual are tested on these disjoint source points. Normals come from the same scan, so this is internal validation, not an independent accuracy benchmark.
- Fusion stores equal-per-frame voxel centroids, averaged normals where available, frame IDs, spread and observed-only roles. A one-frame region survives. Roles remain `unknown` or masked `context`; there is no semantic vehicle/body/mirror classifier or inferred mesh.
- Viewer uses CPU Canvas projection, source inspection, orthographic views and optional context. Hidden frames recompute display centroids without changing registration. Excluding/repinning/changing the reference rebuilds from retained crops and invalidates any manual-box draft.
- The common-box editor begins from reference pre-label dimensions, never point extents. Numeric xyz/yaw/LWH edits are local; a separate button creates a proposal. Unknown samples retain full original geometry and block propagation; intervening unsampled frames are marked as interpolated. Full pose/scale limits are validated before drafting.
- Snapshot/diagnostic exports carry bounded geometry and review state, with no credentials/job URL. CLI replay supports both the new formats and legacy crop diagnostics. UI import and 3D drag handles are not implemented.

This is an observed-surface workbench and baseline local registration core, not a complete amodal vehicle reconstruction system. Numerical held-out residual and rank are not semantic correctness or calibrated uncertainty.

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
              server/native identity preflight → write-once backup + journal/read-back → native edits + per-frame audit → server identity check/refresh
```

`cvatBridge` is serialized into the page, so it must be self-contained. Do not close over module imports in that function. Store discovery is isolated from fitting; modify this adapter when CVAT internals change. Extension errors must not silently fall back to REST mutations.

## Algorithm implemented in 0.2.1

1. Uniformly sample visible frames within the interval, preserving first/last visible samples. This is a finite budget, not exhaustive trajectory observation.
2. Expand each search region by configurable metres. Exclude known other cuboids, estimate horizontal ground near the original floor, voxelize and region-grow a component supported by the initial box. Flag crop-edge contact and competing components. These checks remain heuristic.
3. **Before estimating yaw or size**, transform observations to their pre-label object coordinates. `evidence.js` counts distinct-frame support within 0.22 m, requiring three frames including the queried frame. Density within one frame cannot supply multiple votes. Unsafe crops cannot vote. This assumes pre-label alignment is already approximately correct; it is not a global registration solution.
4. Retain supported components seeded in the main body of the initial box. Low exterior points cannot join body components; retain them only if supported body cells exist above them. This prevents a low road/wheel-height bridge from attaching a detached exterior cluster in the regression fixture, while allowing repeated real surfaces outside an undersized box. Persistent touching clutter remains ambiguous.
5. Search a local yaw range using trimmed footprint area with a penalty for deviation. No 90°/180° semantic reorientation. Estimate dimensions using equal-weight per-frame endpoint medians and endpoint median absolute deviation, requiring repeated broad spans. XY uses a middle-height body belt; uncertain ground prevents height shrinkage. Near-baseline size changes below max(4 cm, 1.5%) retain the baseline size. These are engineering thresholds, not probabilities.
6. Register each frame against a template made without that frame. Bounded coordinate descent uses truncated nearest-neighbor loss plus a prior on deviation from pre-label. Reject low support or corrections outside limits. Repeat two rounds, then recompute dimensions from the final accepted set and recenter using each broad observation's midpoint (otherwise the common midpoint). Check the final box against original-covered trusted points and a frozen leave-one-out template after recentering. If the centered pose fails, try the registered pose; otherwise preserve the complete pre-label. Re-estimate dimensions after removals without another unchecked recenter. Each audit pass removes observations or terminates.
7. Coverage allows 8 cm edge tolerance, at most max(3 points, 4% of previously covered points) newly excluded, and no large increase in total outside fraction. Final registration support must remain at least 0.55 and penalized loss at most original + 0.0002. Audit combined, size-only and pose-only boxes; the same `finalBox` helper resolves preview and draft geometry. These checks operate on trusted points, not semantic ground truth.
8. Preview only accepted point sets by default. Optional gray layers expose discarded crop points and rejected frames. Keep the actual reference frame's original/proposed box offsets in fused mode; single-frame mode always uses that frame's original axes. No synthetic common-center comparison hides a proposed displacement.
9. Generate dense visible-frame keys and pin interval neighbors. Preserve original keys, visibility, attributes and non-target metadata. Accepted samples interpolate pose corrections only across adjacent accepted samples; rejected samples retain full geometry and break interpolation of both size and pose. Held sparse samples are explicitly pinned, so edited neighboring keys cannot pull their interpolation. No general key reduction is implemented.

`rawXYZ` means the bounded crop entering temporal filtering, not the full downloaded cloud. `rejectedXYZ` contains only points discarded at this stage; ground/neighbor/crop exclusions are not retained for display. `sizeEvidence` records contributing frame IDs and endpoint disagreement for each dimension. Point counts and support scores describe evidence, not semantic correctness.

Current geometry scoring is not an amodal learned shape model, visibility ray tracer, articulated tracker, global pose-graph optimizer or calibrated uncertainty estimator. Partial planar observations remain ambiguous. Tests need actual diverse clouds before changing thresholds or increasing acceptance.

## Mutations, IDs and ambiguity

Since v0.3.1, Apply never calls `annotations.commit`, `put`, `import`, or `clear`. It prepares native cuboid ObjectStates for every affected frame, validates frame/geometry/lock/server identity against the exact baseline, rechecks the full snapshot, then sets only `points` and calls each local `ObjectState.save()`. Saving points creates a key when needed. Existing clientID, track server ID and original keyframe IDs are part of both validation and audit; none are stripped. Old versions replaced the object and changed clientID; that path has been removed.

Draft metadata, keyframes, geometry limits, visibility and interval are validated before the first edit. After each edited frame, unrelated tracks/shapes/tags/intervals and the selected track's IDs/metadata are compared exactly, with only equivalent angles/read noise and CVAT's known native edited-source transition allowed. Audit detects host side effects after mutation; it is not a guarantee that every customized host behaves correctly. Auto save is not disabled and may persist edits; an active Save interrupts further writes. An overlay blocks ordinary user edits during the batch and is always removed.

Each token is consumed before editing. A failing save may already have changed that frame: the adapter checks both confirmed and attempted prefixes to identify a recoverable partial batch. It never retries the Apply or performs an automatic rollback. A verified partial batch can be restored by the user. Audit failures block dedicated restore; a render-only failure retains an audited restore record.

Dedicated restore requires the exact post-Apply snapshot and history. If all native actions remain in the bounded history, it undoes the audited action count and checks the entire original export. Otherwise it restores original keyframe points and removes only newly inserted keys through native states, retaining the track identity. This fallback preserves geometry/key structure but CVAT's edited-source mark can remain; the UI says so. Ctrl+Z is per native action and is not promised to undo a whole long batch. No history freezing/clearing, private-model patching or whole-collection import is used.

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

## v0.3.2 identity boundary

The adapter refuses unsaved top-level objects and noncontiguous or out-of-import-order client IDs. Before a mutation it requires a bounded, same-origin annotations GET and identical ordered server IDs for every collection. Each prepared baseline has a receipt bound to the exact full native snapshot and target. The writer repeats the GET and refuses changed server data before the first native save. Existing persisted key IDs are never replaced. Each native save is followed by an exact off-target comparison, ordered client/server identity check and selected-prefix audit. A mismatch quarantines the session; no speculative rollback or replacement fallback runs. Native edited-source changes remain explicitly allowed.

A write-once snapshot and PREPARED journal must be read back from local storage before Apply. An ambiguous call stays PREPARED and blocks retry even after panel closure. Partial/quarantined attempts remain blocked; only an audited explicit restore resolves a partial record. Legacy recovery snapshots are never overwritten. Completed identity records also survive reload; subsequent preflight and the read-only audit control compare them before accepting a new baseline. Storage quota failure aborts before mutation. Journals are not silently rotated.

The read-only verify operation checks native/server identity and, when the live guard exists, off-target content. It distinguishes identity agreement from full session/server content agreement. Missing live guards after reload are supplemented by the persisted last-complete identity journal. It cannot certify arbitrary later external edits, host code or a future Save. User Save/Auto save is never invoked, suppressed or undone by the extension. The overlay blocks ordinary input, not all possible third-party automation. Full-host integration remains unverified.
