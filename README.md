# CVAT Track Refiner

**Experimental v0.3.2 · Multi-frame LiDAR reconstruction and common cuboid editing for CVAT**

**English** | [Tiếng Việt](README.vi.md)

[Download releases](https://github.com/phanhieunghia353/cvat-track-refiner/releases) · [Current release: v0.3.2](https://github.com/phanhieunghia353/cvat-track-refiner/releases/tag/v0.3.2) · [Validation](VALIDATION.md) · [Design](DESIGN.md) · [Changelog](CHANGELOG.md)

CVAT Track Refiner is a browser extension for inspecting a tracked LiDAR object across multiple frames. It aligns observed surface points into a common object coordinate system, lets an annotator inspect where those observations came from, and provides an optional shared cuboid editor. A manually reviewed common box can then be projected back onto supported frames of the selected track.

It runs locally in Brave, Chrome or Edge, using JavaScript, a Web Worker and Canvas. Using the extension does not require Python, a dedicated GPU, model weights, a separate inference server, or administrative access to the CVAT host. It uses the CVAT tab you explicitly open it from and your existing signed-in session. You do not enter a token or hardcode a particular hostname.

**Status:** this is an experimental geometry tool. The default core does not automatically recognize a complete vehicle, distinguish bodywork from mirrors, complete hidden surfaces or prove that a correction is better than the supplied pre-label. Automated tests and synthetic examples do not certify a customized hosted CVAT instance. The extension interface is currently Vietnamese; this README documents its controls in English with the original labels.

## Contents

- [Downloads and release history](#downloads-and-release-history)
- [Requirements](#requirements)
- [First installation](#first-installation)
- [Update without losing backups](#update-without-losing-backups)
- [Quick start](#quick-start)
- [How reconstruction works](#how-reconstruction-works)
- [Inspect surfaces and edit a common box](#inspect-surfaces-and-edit-a-common-box)
- [Apply, Save, Undo and identity protection](#apply-save-undo-and-identity-protection)
- [Exports and privacy](#exports-and-privacy)
- [Troubleshooting](#troubleshooting)
- [Limits and quality](#limits-and-quality)
- [Development and validation](#development-and-validation)
- [License and attribution](#license-and-attribution)

## Downloads and release history

Use the actual [GitHub Releases page](https://github.com/phanhieunghia353/cvat-track-refiner/releases), then expand **Assets** under a version. Releases are published as **Pre-release**, rather than being presented as stable production builds. They are not just Git tags.

| Asset for v0.3.2                                                                                                                                                     | Purpose                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [cvat-track-refiner-brave-v0.3.2.zip](https://github.com/phanhieunghia353/cvat-track-refiner/releases/download/v0.3.2/cvat-track-refiner-brave-v0.3.2.zip)           | Ready-to-load extension for Chromium browsers                     |
| [cvat-track-refiner-source-v0.3.2.zip](https://github.com/phanhieunghia353/cvat-track-refiner/releases/download/v0.3.2/cvat-track-refiner-source-v0.3.2.zip)         | Source, comments, tests and documentation at the release snapshot |
| [cvat-track-refiner-v0.3.2-SHA256SUMS.txt](https://github.com/phanhieunghia353/cvat-track-refiner/releases/download/v0.3.2/cvat-track-refiner-v0.3.2-SHA256SUMS.txt) | SHA256 checksums of the two original ZIPs                         |

GitHub's automatically generated **Source code (zip/tar.gz)** assets contain the tagged repository. They are not the prepackaged extension ZIP. If installing from a source checkout, load its `extension/` directory.

| Release                                                                              | Main change / historical status                                                                                             |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| [v0.3.2](https://github.com/phanhieunghia353/cvat-track-refiner/releases/tag/v0.3.2) | Server/native identity and order guards, per-frame audits, persistent backups/journals and read-only post-Save verification |
| [v0.3.1](https://github.com/phanhieunghia353/cvat-track-refiner/releases/tag/v0.3.1) | Replaced the object-replacement writer with native in-place point updates and batch restoration                             |
| [v0.3.0](https://github.com/phanhieunghia353/cvat-track-refiner/releases/tag/v0.3.0) | First reconstruction core, 3D provenance viewer and common box editor; its Apply path changed object IDs                    |
| [v0.2.1](https://github.com/phanhieunghia353/cvat-track-refiner/releases/tag/v0.2.1) | Legacy fitter with final per-frame box checks                                                                               |
| [v0.2.0](https://github.com/phanhieunghia353/cvat-track-refiner/releases/tag/v0.2.0) | Temporal evidence filtering; final recentering checks were incomplete                                                       |
| [v0.1.0](https://github.com/phanhieunghia353/cvat-track-refiner/releases/tag/v0.1.0) | Initial fitter; exterior point clusters could pull the proposed box outward                                                 |

Older packages are retained for traceability, not recommended for applying annotations. In particular, do not use the v0.3.0 Apply path when object identity matters. **v0.3.2 does not automatically restore IDs changed by an older version.**

Documentation updated on **23 October 2026**: the repository's current English and Vietnamese READMEs are also offered as separate documentation assets on the v0.3.2 release. The original ZIPs, checksums and version tags remain unchanged; their bundled documentation reflects their original snapshots.

## Requirements

- A Chromium-based browser supporting Manifest V3 and `chrome.scripting`; the manifest requires Chromium 111 or later. Brave is the primary intended workflow. Chrome and Edge are also targets; Firefox is not supported by this package.
- A signed-in CVAT **3D LiDAR job** with cuboid tracks and permission to view the relevant annotations and point-cloud frames. Applying also requires the usual annotation-editing permission.
- PCD frames accessible from the same CVAT origin. ASCII, binary and binary_compressed/LZF PCD are supported, including float32/float64 coordinates.
- Consecutive job frames. A frame filter/step other than 1 is refused.
- For Apply, readable saved annotation identities on the server and a compatible native CVAT session. Merely matching the displayed CVAT version does not guarantee compatibility with a customized host.

Ubuntu, Windows and macOS are intended targets; full native installation and host compatibility have not been verified on every browser/OS. The reported target is CVAT 2.77.1, but its real hosted Save/Auto save behavior has not been certified by the automated suite.

## First installation

1. Download the ZIP containing **brave** from the release's **Assets** section.
2. Extract it to a permanent directory. Do not load an extension from a temporary extraction location that will disappear later.
3. Open `brave://extensions` (or `chrome://extensions` / `edge://extensions`) and enable **Developer mode**.
4. Choose **Load unpacked**, then select the extracted `cvat-track-refiner/` folder containing `manifest.json`. For a repository checkout, select `extension/`.
5. Temporarily disable other annotation-resizing extensions so that only this tool controls the operation being evaluated.
6. Open your CVAT job tab, then click **CVAT Track Refiner · Experimental** in the browser toolbar.

The panel is tied to the tab from which you opened it. Changing the active browser tab does not silently retarget an already open panel. No CVAT page reload is required to analyze or Apply.

To check the downloaded ZIPs on a system with `sha256sum`, place both ZIPs and the checksum file in one directory and run:

```sh
sha256sum -c cvat-track-refiner-v0.3.2-SHA256SUMS.txt
```

## Update without losing backups

**Keep the existing extension identity and installation path. Do not uninstall it, clear its storage or load the new version from a different directory.** A different unpacked installation may have a different extension ID and cannot automatically access the old installation's local backups.

1. Download the existing backup/recovery log if the old panel still opens. Retain the old installation directory and browser data.
2. Close the tool's panel.
3. Extract the new ZIP into a temporary directory, then copy the **contents inside** its `cvat-track-refiner/` folder over the files in the exact directory currently loaded by Brave. Avoid nesting another `cvat-track-refiner/` directory inside it.
4. On `brave://extensions`, click **Reload on the extension card**. This reloads the extension, not the CVAT page.
5. Reopen the tool from the CVAT job tab and read the job. Use **Tải lịch sử backup/audit** to save a separate local copy of the available recovery records.

Updating the extension does not restore annotation identities already changed on the server. It also does not migrate backups from a different browser profile or extension installation.

## Quick start

### Try synthetic data first

Choose **Thử dữ liệu mẫu** (Try sample data), then **Phân tích** (Analyze). The default reconstruction example contains a curved synthetic body and jittered initial poses. **Mẫu có cụm điểm ngoài** provides a separate clutter example. Apply is always disabled in demo mode. These samples are controlled examples, not the user's actual scans or an accuracy benchmark for real vehicles.

### Read a real job

1. Select one tracked object in CVAT and finish any active drag or text edit.
2. Open the extension and click **Đọc job / object đang chọn** (Read job / selected object).
3. Check the job, the actual **CVAT client ID**, and the selected frame range. The server database ID is a different identifier; do not infer one from the other.
4. Keep **Lõi dựng hình + box chung** (Reconstruction core + common box), choose a range with useful overlapping observations, then click **Phân tích**.
5. Review the fused view **and individual frames** before creating or applying a box proposal.

Unsaved annotation edits are read from the open CVAT session. Analysis does not require saving them first. Apply has stricter identity checks and may be blocked even when analysis is possible.

## How reconstruction works

The core separates **surface reconstruction** from **choosing a bounding box**:

1. Use the pre-label poses and expanded crop region as an initialization and search hint.
2. Load sampled PCD frames from the current CVAT origin. Decode them locally and retain bounded object crops in a worker.
3. Mark likely ground or neighboring objects as contextual masks. The reconstruction branch retains those observations for inspection; masked points do not drive alignment.
4. Estimate local surface information and refine translation X/Y/Z plus yaw using robust local surface matching. The chosen reference fixes the common coordinate system; optional pinned frames preserve trusted pre-label poses.
5. Check alignment constraints and held-out point subsets. Weakly constrained planes, disconnected observations or failed checks remain unresolved rather than being treated as a complete object.
6. Fuse accepted observations into surface cells while retaining source frame IDs and spread. A surface seen in only one frame can survive; a low observation count alone does not prove it is noise.
7. Let the annotator optionally define a common box. Project that box through the supported per-frame poses to build a draft for the selected track.

The default core **does not calculate box dimensions from the outermost points**. Pre-label dimensions are crop hints, not the final reconstructed shape. This is not a neural model, complete shape reconstruction, ray-traced free-space validation or semantic body/mirror segmentation.

The separate **Bộ fit box cũ (đối chiếu)** (Legacy box fitter / comparison) estimates dimensions and local pose using temporal evidence, connected components, body-band endpoints and conservative acceptance checks. It remains available for comparison and retains its known limitations; it is not the default reconstruction core. See [DESIGN.md](DESIGN.md) and [RECONSTRUCTION-CORE.md](RECONSTRUCTION-CORE.md).

## Inspect surfaces and edit a common box

| Control / result                  | Meaning                                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Drag / wheel in the 3D viewer     | Rotate / zoom; reset and angle controls are also available                                                                                |
| **Màu theo**                      | Color by source frame, support count or spread; these are not calibrated correctness probabilities                                        |
| Click a surface point             | Inspect the contributing observations; point IDs refer to the crop/surface data, not original PCD indices                                 |
| **Quan sát → Frame …**            | Inspect an individual frame in the shared coordinate system                                                                               |
| X/Y, X/Z, Y/Z views               | Compare geometry in three projections                                                                                                     |
| Frame display checkbox            | Change display only; it does not change the alignment result or Apply scope                                                               |
| **Loại / nhận lại frame chọn**    | Exclude/reinclude a frame and rebuild from retained crops                                                                                 |
| **Chọn làm mốc**                  | Use the selected pre-label pose as the fixed reference                                                                                    |
| **Ghim / bỏ ghim theo pre-label** | Pin/unpin an additional frame's pose                                                                                                      |
| **4/4**                           | The current equations support X/Y/Z and yaw under the configured thresholds; it is not a confidence percentage or an accuracy certificate |
| **Chưa xác định**                 | Insufficient/failed alignment evidence; do not treat this frame as a reliable reconstructed pose                                          |

Changing the reference or rebuilding invalidates the previous common-box proposal and resets the editor. A reference is an assumption, not ground truth. To correct its pre-label pose, edit it in CVAT, then read and analyze again.

To create a box proposal:

1. Expand **Box chung chỉnh tay** (Manual common box). Initial values come from the reference pre-label, not a new automatic measurement.
2. Enable **Hiện box chung** and edit center X/Y/Z, yaw, length, width and height numerically. This version has no face-dragging handles.
3. Inspect multiple views and frames. Decide whether the task's labeling rules include mirrors or other protrusions; the core does not decide this for you.
4. Click **Tạo đề xuất từ box tôi chỉnh** (Create proposal from my box). Further numeric edits invalidate the existing draft.
5. Read the changed-frame, added-keyframe and interpolation counts. A shared size is combined with each supported pose; unresolved samples and blocked interpolation intervals retain the original geometry.
6. Click **Apply vào CVAT** only after reviewing the draft. Size/shift/angle bounds are checked; values outside them are refused rather than silently clipped.

Sampling defaults to 24 frames, with a configurable maximum of 48. A sampled reconstruction does not mean every frame in the Apply range has been independently verified against its own point cloud.

## Apply, Save, Undo and identity protection

### What Apply changes

Apply edits the selected track's existing native `ObjectState.points` and invokes local `ObjectState.save()`. It may add keyframes to represent the reviewed draft and preserve interpolation boundaries. It does not replace the track, import the collection or call annotation-write HTTP APIs. It preserves original roll/pitch, padding, class, group, attributes, visibility flags and existing IDs; CVAT may mark the native annotation `source` as edited (for example, auto → semi-auto).

The extension does not invoke CVAT's server Save, reload the job or change Auto save settings. **Auto save is allowed and may persist edits before you inspect them.** If you need a manual review before persistence, turn Auto save off yourself in CVAT before applying.

### Identity checks in v0.3.2

1. Before the first edit, read saved annotations with a bounded same-origin GET. Require agreement between native/server object ID order, existing keyframe IDs and the fresh session baseline. Unsaved top-level objects, missing/duplicate IDs or client numbering inconsistent with fresh import order block Apply.
2. Persist a full pre-edit snapshot and a separate journal for each attempt in `chrome.storage.local`, then read them back before requesting mutation. Previous backups are not automatically overwritten or deleted. Quota/read-back failure blocks Apply.
3. After **each native frame edit**, compare the selected track's permitted changes, every object ID and its order, and the complete contents of all unrelated tracks/shapes/tags/intervals. Audit reads data; it does not edit other labels to test them.
4. On mismatch, stop and quarantine further Apply operations. Do not retry an ambiguous write or automatically overwrite the job with a backup. Unresolved journal records continue to block retries after reopening the panel.
5. At the end, recheck saved server identity. This only verifies the server at that moment; it does not certify a future Save.
6. After your Save or Auto save, click **Kiểm tra ID sau Save (chỉ đọc)** (Verify IDs after Save — read only). It reads native/server data and previous identity records. It distinguishes identity agreement from full session/server content agreement. Legitimate additions/deletions may also require manual review because the previous identity map changed.

These checks detect side effects **after** a native call. They cannot guarantee the behavior of every customized CVAT host or another extension. A successful local audit is not a promise about later external changes. The old ID-loss incident is not repaired automatically by this version.

### Undo and partial failures

- **Hoàn tác Apply gần nhất** restores the audited batch when the snapshot and history still match. A still-valid page-owned Undo record can be recovered when reopening the panel in the same page.
- When all actions remain in CVAT history, the tool undoes the batch's action count and audits the full original export. If a long batch exceeded the bounded history, it restores original points and removes only keys that this Apply introduced, through native states on the same track.
- The fallback can leave CVAT's edited-source marker; the tool reports that explicitly.
- Native **Ctrl+Z may undo only one frame**, not a complete batch.
- Subsequent edits/Save/Undo/Redo can invalidate the restoration snapshot. The tool refuses to overwrite newer data.
- A verified partial batch may permit explicit restoration. A failed identity/content audit locks restoration rather than guessing which state to overwrite. Keep the recovery log and stop applying.
- A backup is a recovery artifact, **not a one-click full-job restore/import feature**. Reloading the CVAT page does not recreate its previous in-memory Undo history.

## Exports and privacy

| Button                         | Contents / use                                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tải báo cáo phân tích**      | Settings, poses, acceptance/constraint checks and frame decisions; no crop point coordinates, so it is insufficient to replay the point-cloud computation |
| **Tải chẩn đoán có điểm crop** | Bounded crops, masks and settings for local replay; not the full PCD dataset                                                                              |
| **Tải snapshot dựng hình**     | Reconstructed surfaces, observation provenance and current view/common-box choices; UI snapshot import is not implemented                                 |
| **Tải backup trước Apply**     | A full annotation pre-image from a recorded Apply attempt, potentially including unsaved edits                                                            |
| **Tải lịch sử backup/audit**   | Per-attempt backups/journals, a current session snapshot and a read-only verification result/error for the current job                                    |

Point coordinates, labels and recovery data may be confidential. Recovery exports include job/host context. These files are downloaded only on request; the extension does not automatically upload them to GitHub, another service or an external model. The source and demos do not contain real private annotations or point clouds.

Same-origin GET requests use the browser's current CVAT session; no token needs to be pasted into the tool. Browser permissions are `activeTab`, `scripting` and `storage`. There is no inference service, telemetry endpoint, CDN or runtime package download. Local backups use the current browser profile/extension storage and are not automatically shared between machines.

Replay a diagnostic locally:

```sh
node scripts/replay.mjs /path/to/track-refiner-crop-diagnostic.json > replay-report.json
```

## Troubleshooting

| Symptom                                                                     | Meaning and next step                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cannot find the CVAT session                                                | Open the actual 3D job and Objects sidebar, finish loading, then open the tool from that tab. A customized host may not expose a compatible store/native API.                                                                           |
| API 404 / cannot download PCD or annotation IDs                             | The reverse proxy may use a different API path. In advanced options try the actual same-origin path, such as `/api` or `/cvat/api`; external URLs are refused. Frame responses must be supported PCD, not HTML, images or ZIP archives. |
| Tab changed job / reloaded                                                  | Read the job again. Old proposals are bound to their original tab/job/document context.                                                                                                                                                 |
| Frame does not match the native keyframe/baseline                           | Annotation state changed or the native adapter could not verify it. Read/analyze again; do not force Apply by changing IDs.                                                                                                             |
| Server ID/order differs, gapped client numbering, unsaved top-level objects | Apply is preview-only in this state. Export the recovery log and reconcile the identity map. Do not Save merely to bypass a warning you do not understand.                                                                              |
| Prepared/partial/quarantined attempt blocks Apply                           | An earlier attempt was not confirmed. Do not repeatedly Apply; use the still-valid explicit Undo if offered or retain the log for investigation. Reopening the panel does not clear the guard.                                          |
| Storage quota or backup read-back failure                                   | No new Apply should be sent. Export existing recovery records before considering storage maintenance; backups are not silently rotated.                                                                                                 |
| Frame unresolved / one-sided or sparse cloud                                | Add overlapping observations or review the reference/crop. Missing geometric constraints cannot be solved just by enlarging a box.                                                                                                      |
| Box includes mirrors or misses the far body side                            | The core has no semantic body/mirror model or hidden-surface completion. Review the common box using multiple frames and the annotation specification.                                                                                  |
| Apply succeeded but server content does not match session                   | The session may still have unsaved edits or serialization differences. Check CVAT Save state, then use read-only verification. It does not force Save or restore anything.                                                              |
| Object IDs were changed by an old build                                     | Stop applying, retain original backups/current exports and investigate separately. Installing this version does not restore those IDs.                                                                                                  |

## Limits and quality

- The supported shape is an approximately upright, rigid 3D cuboid track with 16-value CVAT points. Original roll/pitch are retained; unsupported tilts are refused. Deformable people, articulated vehicles and arbitrary object types are outside the intended scope.
- Alignment is local, initialized near the pre-label. It refines translation and yaw, not full ego-motion, global pose graphs, roll/pitch or scan deskew. It does not resolve a front/back 180° ambiguity automatically.
- Surfaces are observed samples with provenance, not a watertight mesh or an inferred complete vehicle. A region never observed is not measured, and missing points are not verified free space.
- Touching objects, clutter attached to the body, wrong tracking IDs, poor initialization, sloped ground, motion distortion, low density and repeated clutter can still produce incorrect results.
- Internal residual/support/constraint checks are not expert-reviewed ground truth. A visually clean fused cloud, more points or a lower residual does not establish better annotations than the original pre-label.
- The Apply range is capped at 1200 frames. PCD download is capped at 32 MiB/frame, decoded input at 2 million points/frame and decompression at 128 MiB. The worker retains sampled bounded crops. Large jobs and per-frame full annotation audits can still be expensive.
- Drafts can introduce dense keyframes; keyframe reduction is not implemented. Intermediate frames may use bounded interpolation between supported samples, not independent point-cloud verification.
- The legacy fitter has separate temporal/endpoint/coverage heuristics. They can fail when alignment or point selection is wrong; see [VALIDATION.md](VALIDATION.md) for specific controlled regressions and remaining gaps.

Before trusting an automatic correction system, compare both the original pre-label and proposed result against expert-reviewed reference labels, including changes from wrong to right, right to wrong and review time. This project has not established such a real-data quality advantage.

## Development and validation

The source uses ES modules, English code comments, Canvas2D and a Web Worker, with no extension runtime dependencies. The UI is Vietnamese; both READMEs describe the same v0.3.2 behavior. No machine-specific absolute paths, required account IDs or hardcoded CVAT hostname are needed to use it.

```text
extension/cvat/           Native adapter, identity guard and persistent write boundary
extension/core/           Coordinates, interpolation, draft construction and diagnostics
extension/reconstruction/ Surface registration, constraints, fusion and common-box projection
extension/pointcloud/     PCD/LZF decoding, bounded crops and sampling
extension/fitting/        Separate legacy box fitter and evidence checks
extension/workers/        Off-main-thread computation; analysis has no mutation API
extension/ui/             Preview, provenance viewer and common-box controls
extension/demo/           Controlled synthetic fixtures
tests/                   Adapter/transaction/import contracts, geometry and real worker tests
scripts/                 Testing, building, diagnostic replay and publishing
releases/                Version notes and exact source-commit/asset index
release-assets/          Preserved original versioned ZIPs and checksums
```

For development, use Node.js 20+ (CI uses Node.js 22). Python 3 is needed only for packaging or the optional local HTTP demo, not by extension users.

```sh
node scripts/test.mjs
python3 scripts/build.py
```

The builder writes extension/source ZIPs and `SHA256SUMS` to `dist/`. It includes both READMEs in future packages built from the current source. Published original release assets are retained unchanged. Do not commit real CVAT exports, point clouds, credentials or backup files into this public repository.

For a local UI demo:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory extension
```

Open `http://127.0.0.1:8765/panel.html` and choose a sample. Reading/applying real CVAT jobs requires the installed extension and a supported CVAT tab. Optional source formatting: `npx prettier@3.6.2 --write extension tests`.

**Validation for the v0.3.2 implementation:** 96 automated tests passed, including native in-place identity checks, unrelated-label/order failure injection, persistent transaction guards, 80-object Save/reload simulation and a test-only import method from official CVAT source. The import model factories and server/native state fixtures are doubles. Earlier browser checks exercised the actual worker/viewer on synthetic data; they did not certify a real Brave installation or the user's hosted CVAT Save/Undo behavior. See [VALIDATION.md](VALIDATION.md) for evidence and unverified cases. Documentation updates do not establish new host compatibility or fitting accuracy.

## License and attribution

MIT. See [LICENSE](LICENSE), [NOTICE.md](NOTICE.md) and [THIRD-PARTY-LICENSES.txt](THIRD-PARTY-LICENSES.txt).

The original adapter/refresh and PCD patterns were developed with reference to [prelabelcheck_CVAT](https://github.com/thanhdanh11-test/prelabelcheck_CVAT), source commit `0c6246c03704c142c27cddf9df4b9be2f3d7522b`, with its MIT notices retained. Since v0.3.1, this extension's replacement-Commit writer has been removed. The official CVAT import method is included only as an attributed test fixture; it is not a bundled CVAT runtime. No research-model weights or private dataset are distributed.

This is an independent project, not an official CVAT product. For exact release source commits, consult [releases/index.json](releases/index.json); imported release history is not backdated development history.
