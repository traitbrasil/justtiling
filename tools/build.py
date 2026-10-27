#!/usr/bin/env python3
"""Build a local extension ZIP only. Never install, enable or modify GNOME settings."""
from source_safety import check_inputs
from pathlib import Path
import json
import shutil
import subprocess
import tempfile
import zipfile
from translations import compile_catalogs

root = Path(__file__).resolve().parents[1]
check_inputs(root)
metadata = json.loads((root / 'metadata.json').read_text())
dist = root / 'dist'
dist.mkdir(exist_ok=True)
output = dist / f"trait-justtiling-{metadata['version-name']}.zip"
with tempfile.TemporaryDirectory(prefix='justtiling-build-') as tmp:
    stage = Path(tmp)
    for name in ['metadata.json', 'extension.js', 'prefs.js', 'LICENSE']:
        shutil.copyfile(root / name, stage / name)
    shutil.copytree(root / 'src', stage / 'src')
    compile_catalogs(stage / 'locale')
    (stage / 'schemas').mkdir()
    for source in (root / 'schemas').glob('*.gschema.xml'):
        shutil.copyfile(source, stage / 'schemas' / source.name)
    # GNOME 45+ compiles schemas during installation; validate without shipping the cache.
    subprocess.run(['glib-compile-schemas', '--strict', '--dry-run', str(stage / 'schemas')], check=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for source in sorted(stage.rglob('*')):
            if source.is_file():
                info = zipfile.ZipInfo(source.relative_to(stage).as_posix(), (2026, 10, 23, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, source.read_bytes())
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert 'schemas/gschemas.compiled' not in archive.namelist()
print(f'Created {output} ({output.stat().st_size} bytes). Not installed or activated.')
