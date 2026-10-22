"""Reproducible extension/source ZIPs; no machine-specific paths or packages."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'extension/manifest.json').read_text())['version']
DIST = ROOT / 'dist'
DIST.mkdir(exist_ok=True)

def write_zip(output, entries):
    with ZipFile(output, 'w') as archive:
        for path, name in sorted(entries, key=lambda item: item[1]):
            info = ZipInfo(name, (2026, 10, 22, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())

documents = ['README.md', 'DESIGN.md', 'VALIDATION.md', 'LICENSE', 'NOTICE.md', 'THIRD-PARTY-LICENSES.txt']
extension_entries = [(p, 'cvat-track-refiner/' + p.relative_to(ROOT / 'extension').as_posix())
                     for p in (ROOT / 'extension').rglob('*') if p.is_file()]
extension_entries += [(ROOT / name, 'cvat-track-refiner/' + name) for name in documents]
extension_zip = DIST / f'cvat-track-refiner-brave-v{VERSION}.zip'
write_zip(extension_zip, extension_entries)
source_entries = [(p, 'cvat-track-refiner-source/' + p.relative_to(ROOT).as_posix())
                  for p in ROOT.rglob('*') if p.is_file()
                  and not any(part in {'.git', 'dist', 'node_modules', '__pycache__', '.test-results'}
                              for part in p.relative_to(ROOT).parts)]
source_zip = DIST / f'cvat-track-refiner-source-v{VERSION}.zip'
write_zip(source_zip, source_entries)
(DIST / 'SHA256SUMS').write_text(''.join(
    hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.name + '\n'
    for p in [extension_zip, source_zip]))
print(extension_zip)
print(source_zip)
