#!/usr/bin/env python3
"""Exercise packaging attacks with synthetic external files in temporary copies."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def run(root, tool):
    return subprocess.run(['python3', f'tools/{tool}.py'], cwd=root, capture_output=True, text=True)

with tempfile.TemporaryDirectory(prefix='justtiling-build-safety-') as tmp:
    base = Path(tmp); root = base / 'source'; root.mkdir()
    for name in ['src', 'schemas', 'po', 'tools']:
        shutil.copytree(ROOT / name, root / name, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    for name in ['metadata.json', 'extension.js', 'prefs.js', 'LICENSE']:
        shutil.copyfile(ROOT / name, root / name)
    assert run(root, 'build').returncode == 0
    assert run(root, 'check-submission').returncode == 0
    external = base / 'synthetic-external.txt'; external.write_text('SYNTHETIC DATA ONLY')
    # Every validation is independent: an already-created ZIP must not make
    # the checker accept a subsequently linked source input.
    for relative in ['LICENSE', 'metadata.json', 'src/rules.js', 'po/pt_BR.po',
                     'schemas/org.gnome.shell.extensions.justtiling.gschema.xml']:
        path = root / relative; original = path.read_bytes()
        path.unlink(); path.symlink_to(external)
        for tool in ['build', 'check-submission']:
            result = run(root, tool)
            assert result.returncode != 0 and 'Unsafe build input' in result.stderr, (relative, tool, result.stderr)
        path.unlink(); path.write_bytes(original)
    # A linked directory and a link to another in-repository file also fail.
    source = root / 'src'; source.rename(root / 'saved-src'); source.symlink_to(root / 'saved-src', target_is_directory=True)
    assert run(root, 'build').returncode != 0 and run(root, 'check-submission').returncode != 0
    source.unlink(); (root / 'saved-src').rename(source)
    path = root / 'LICENSE'; original = path.read_bytes(); path.unlink(); path.symlink_to(root / 'prefs.js')
    assert run(root, 'build').returncode != 0 and run(root, 'check-submission').returncode != 0
    path.unlink(); path.write_bytes(original)
    assert run(root, 'build').returncode == 0 and run(root, 'check-submission').returncode == 0
print('Build safety OK: clean package accepted; linked files/directories/catalogs/schemas rejected by builder and checker. Synthetic data only.')
