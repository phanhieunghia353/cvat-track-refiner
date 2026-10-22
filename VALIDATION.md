# Validation record · 22 October 2026

## Automated checks

66 tests passed with Node.js using `node scripts/test.mjs`:

- 14 adapter tests: read-only snapshot/preflight, unsaved unrelated edits, Auto save allowed, exact off-target audit, baseline and context conflicts, locked/saving/drawing/review states, metadata/geometry validation, native Undo, post-commit refresh failure, ambiguous Commit error, navigation after Commit, API prefix/trailing-slash discovery without following redirects, filtered-frame rejection and adding keys from a sparse-track draft; core → user common box → native Commit with unrelated-track preservation and no server Save.
- 7 geometry/draft tests: XYZ transforms, angular wrap, mutable-attribute inheritance, frame sampling, unsupported cuboids, range boundaries and outside frames, unmeasured dimensions and rejected-sample interpolation.
- 6 fitting/crop tests: undersized synthetic cuboid, center/yaw refinement, empty/ambiguous inputs, partial-side observability, search expansion, known neighbors, crop boundaries, bounded reservoir sampling and configuration limits.
- 5 PCD tests: ASCII, binary AoS, binary_compressed SoA, LZF overlap, invalid references, truncation, HTML responses, nonfinite returns and allocation limits.
- 3 transaction tests: backup quota abort, backup-before-Apply order and no automatic retry after transport failure.
- 6 temporal-evidence tests: distinct-frame votes, transient exterior clutter, persistent clutter attached through a low bridge, real surfaces outside an undersized box, unsafe voting crops and insufficient overlapping evidence.
- 6 final-box/diagnostic tests: lateral-shift plus shrink regression; exact final geometry for every accepted fixture sample; sparse held-frame pinning and size/pose interpolation boundaries; option-specific refusals; crop export/replay with no session credentials.
- 4 preview tests: accepted-only fusion, optional gray rejected layers, real anchor offsets and independent size/pose toggles.
- 4 worker tests: actual worker-thread PCD → crop → fit pipeline, transferable buffers, parse failure and termination during analysis; clutter fixture through the complete PCD/crop/fit pipeline; new core PCD/crop/surface branch without a box estimator.

- 11 reconstruction tests: fixed-gauge jitter recovery, size invariance, one-plane degeneracy, disconnected islands, exclusion without data loss, rigid common-box projection, replay/privacy, bounded contextual crop, invalid resource settings, eigensolver reconstruction and hidden-frame provenance.

The mocked adapter forbids server Save and unexpected network access. Its commits are in-memory mocks; these tests do not certify native CVAT history internals on a hosted instance.

All extension JavaScript modules passed syntax checks. Source is formatted with Prettier 3.6.2; formatting is a developer tool, not an extension runtime dependency.

## Reconstruction-core controlled case (v0.3.0)

`node scripts/validate-reconstruction.mjs` reproduces `reconstruction-validation.json`. Eight synthetic scans share overlapping curved body/roof/end surfaces, with a fixed known frame 0 and jittered pre-label poses. They are favorable observations, not scans of a real car. The remaining seven frame poses have mean center error **0.1074 → 0.00988 m**, mean absolute yaw error **1.2588 → 0.0321°**. All eight remain connected, with 2852 surface cells, including 278 cells observed in one frame only. Changing the label dimensions on these same observations does not alter the reconstructed poses/surfaces.

The core never calls `estimateDimensions` and returns no automatic box size. A single plane and disconnected observations remain uncertain. Masks are contextual hints and one-frame surface observations survive. This establishes the tested cases only; it does not measure real-host accuracy, semantic body/mirror separation, physical surface error or global registration robustness.

The in-app browser ran the actual worker and CPU Canvas viewer: provenance picking, frame exclusion/reinclusion, reference change, local numeric common-box editing, manual proposal creation, and legacy mode. Apply stays disabled in demo. The mock adapter also ran the real core/manual-box draft through its audited native Commit path. Live hosted CVAT/Brave behavior has not been certified.

## Controlled synthetic case (legacy fitter)

`extension/demo/generate.js` uses deterministic seed 72 and complementary surfaces across 12 frames. Full report is in `demo-validation.json` in the source package.

| Measure                          | Pre-label             | Proposed              |
| -------------------------------- | --------------------- | --------------------- |
| L / W / H, metres                | 3.900 / 1.650 / 1.450 | 4.624 / 1.915 / 1.620 |
| True dimensions, metres          | 4.600 / 1.900 / 1.600 | same reference        |
| Mean center error, metres        | 0.193                 | 0.024                 |
| Mean absolute yaw error, degrees | 4.870                 | 0.650                 |

All 12 samples accepted in this fixture. These results are **not an accuracy estimate for real cars, real occlusion, or the user's dataset**. The synthetic object is cuboidal and the scenario is intentionally controlled. Test thresholds must not be relaxed just to produce a proposal on harder inputs.

## Exterior-clutter regression

`extension/demo/clutter.js` adds a vehicle-shaped body and a detached rear cluster joined by low returns. On the earlier 0.1 algorithm, adding this cluster to frame 8 increased a true 4.6 m length to approximately 5.33 m; making the cluster persistent produced approximately 5.50 m. This confirmed the fitting problem independently of preview rendering.

In 0.2, both fixtures retain L/W/H = 4.600 / 1.900 / 1.600 m and zero yaw correction. Frame 8 discards 458/1287 points in the transient case and 456/1287 in the persistent case. Small center corrections remain (mean approximately 0.005 m); this is not a zero-change guarantee. The original undersized fixture still expands to recover observed body surfaces, so passing is not achieved by clipping everything outside the pre-label.

These are controlled counterexamples, not reconstructions of the screenshot or proof that all real ghosting has been solved. Repeated clutter touching the main body can still pass the filter, and genuine one-off observations can be discarded. Actual data from the reported frame has not been run.

## Per-frame regression in 0.2.1

A locally supplied 0.2.0 summary report confirmed a roughly 0.319 m correction in the reported problematic sample. Inspection found final recentering was not followed by a new coverage/registration audit. The ordinary report has no point coordinates, so the actual reported sample could not be reproduced. It is not included in this public repository.

A synthetic regression with a 0.32 m lateral shift plus width shrink is refused by the new coverage check. Tests also require every accepted clean/clutter fixture sample to pass an audit of the exact returned box and final leave-one-out loss. Held sparse frames remain pinned in the draft and preview; size-only refusals block interpolation around unsafe samples. Diagnostic export is replayable locally. This does not establish that the private reported sample is now correct; a crop diagnostic is needed to verify it.

## Browser verification

Verified the actual panel and ES-module Web Worker in the in-app Chromium browser, served locally on loopback, with synthetic data only:

- Load demo, analyze 12 frames, render proposed dimensions and accepted/rejected rows.
- Fused and individual-frame Top/Side/Front views, original/proposed box overlays.
- New exterior-clutter demo: frame 8, gray discarded-point overlay and retained dimensions; Apply remains disabled.
- Size/pose option switching and refusal when fewer than three visible frames are selected.
- Apply remains disabled in demo mode.

This is a real browser execution of the panel/worker, not an unpacked-extension installation test. Source screenshots show synthetic points only.

## Not yet verified

- Native installation in Brave, Chrome or Edge on all operating systems.
- Live adapter compatibility with the user's hosted CVAT 2.77.1, real Save/Auto save, native Undo/Redo and track-ID changes on that host.
- Real point-cloud accuracy, deskew, slopes, long occlusions, touching vehicles, ID switches, rare PCD field layouts or jobs using filtered/strided frames.
- Full privacy/security review of all possible customized CVAT/plugin internals.

No real CVAT annotation was modified in this development session. The release is experimental; the distinction between automated/synthetic/browser checks and real-host integration must remain visible in future release notes.
