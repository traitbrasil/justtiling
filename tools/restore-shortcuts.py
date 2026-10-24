#!/usr/bin/env python3
"""Manual recovery: run only after disabling Just Tiling, as the affected user, without sudo."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='justtiling-recovery-') as tmp:
    shutil.copytree(root / 'schemas', Path(tmp) / 'schemas')
    subprocess.run(['glib-compile-schemas', '--strict', str(Path(tmp) / 'schemas')], check=True)
    env = os.environ.copy()
    env['GSETTINGS_SCHEMA_DIR'] = str(Path(tmp) / 'schemas')
    subprocess.run(['gjs', '-m', str(root / 'tools/restore-shortcuts.js')], env=env, check=True)
