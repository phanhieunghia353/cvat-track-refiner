# Validation record · 22 October 2026

## Automated checks

36 tests passed with Node.js using `node scripts/test.mjs`:

- 13 adapter tests: read-only snapshot/preflight, unsaved unrelated edits, Auto save allowed, exact off-target audit, baseline and context conflicts, locked/saving/drawing/review states, metadata/geometry validation, native Undo, post-commit refresh failure, ambiguous Commit error, navigation after Commit, API prefix/trailing-slash discovery without following redirects, filtered-frame rejection and adding keys from a sparse-track draft.
- 7 geometry/draft tests: XYZ transforms, angular wrap, mutable-attribute inheritance, frame sampling, unsupported cuboids, range boundaries and outside frames, unmeasured dimensions and rejected-sample interpolation.
- 6 fitting/crop tests: undersized synthetic cuboid, center/yaw refinement, empty/ambiguous inputs, partial-side observability, search expansion, known neighbors, crop boundaries, bounded reservoir sampling and configuration limits.
- 5 PCD tests: ASCII, binary AoS, binary_compressed SoA, LZF overlap, invalid references, truncation, HTML responses, nonfinite returns and allocation limits.
- 3 transaction tests: backup quota abort, backup-before-Apply order and no automatic retry after transport failure.
- 2 worker tests: actual worker-thread PCD → crop → fit pipeline, transferable buffers, parse failure and termination during analysis.

The mocked adapter forbids server Save and unexpected network access. Its commits are in-memory mocks; these tests do not certify native CVAT history internals on a hosted instance.

All extension JavaScript modules passed syntax checks. Source is formatted with Prettier 3.6.2; formatting is a developer tool, not an extension runtime dependency.

## Controlled synthetic case

`extension/demo/generate.js` uses deterministic seed 72 and complementary surfaces across 12 frames. Full report is in `demo-validation.json` in the source package.

| Measure                          | Pre-label             | Proposed              |
| -------------------------------- | --------------------- | --------------------- |
| L / W / H, metres                | 3.900 / 1.650 / 1.450 | 4.649 / 1.968 / 1.618 |
| True dimensions, metres          | 4.600 / 1.900 / 1.600 | same reference        |
| Mean center error, metres        | 0.193                 | 0.046                 |
| Mean absolute yaw error, degrees | 4.870                 | 1.004                 |

All 12 samples accepted in this fixture. These results are **not an accuracy estimate for real cars, real occlusion, or the user's dataset**. The synthetic object is cuboidal and the scenario is intentionally controlled. Test thresholds must not be relaxed just to produce a proposal on harder inputs.

## Browser verification

Verified the actual panel and ES-module Web Worker in the in-app Chromium browser, served locally on loopback, with synthetic data only:

- Load demo, analyze 12 frames, render proposed dimensions and accepted/rejected rows.
- Fused and individual-frame Top/Side/Front views, original/proposed box overlays.
- Size/pose option switching and refusal when fewer than three visible frames are selected.
- Apply remains disabled in demo mode.

This is a real browser execution of the panel/worker, not an unpacked-extension installation test. Source screenshots show synthetic points only.

## Not yet verified

- Native installation in Brave, Chrome or Edge on all operating systems.
- Live adapter compatibility with the user's hosted CVAT 2.77.1, real Save/Auto save, native Undo/Redo and track-ID changes on that host.
- Real point-cloud accuracy, deskew, slopes, long occlusions, touching vehicles, ID switches, rare PCD field layouts or jobs using filtered/strided frames.
- Full privacy/security review of all possible customized CVAT/plugin internals.

No real CVAT annotation was modified in this development session. The release is experimental; the distinction between automated/synthetic/browser checks and real-host integration must remain visible in future release notes.
