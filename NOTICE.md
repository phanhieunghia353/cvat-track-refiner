# Attribution

CVAT Track Refiner is an independent experimental extension, not an official CVAT product.

The original MAIN-world native Commit/refresh approach and PCD loading/decoding patterns were adapted with reference to:

- Project: prelabelcheck_CVAT / CVAT Track Resizer
- Author notice: Copyright (c) 2026 danhtongAI11
- Repository: https://github.com/thanhdanh11-test/prelabelcheck_CVAT
- Source commit: 0c6246c03704c142c27cddf9df4b9be2f3d7522b
- License: MIT, reproduced in THIRD-PARTY-LICENSES.txt

The multi-frame fitting module, expanded-crop pipeline, proposal controller, tests and UI here are a separate implementation. No research model weights, training data, private annotation or real point cloud is included.

Since v0.3.1 the replacement-Commit writer has been removed. Apply uses native ObjectState.save on the existing track; identity-aware audit and batch restoration are implemented here.
