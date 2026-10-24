#!/usr/bin/env python3
"""Open an English preferences preview with temporary, memory-only settings."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='trait-english-preview-') as tmp:
    schemas = Path(tmp) / 'schemas'
    shutil.copytree(root / 'schemas', schemas)
    subprocess.run(['glib-compile-schemas', '--strict', str(schemas)], check=True)
    env = os.environ.copy()
    env.update(LANGUAGE='en', LC_ALL='C.UTF-8', GSETTINGS_BACKEND='memory',
               GSETTINGS_SCHEMA_DIR=str(schemas))
    print('English preview: default settings only; changes are discarded on closing.', flush=True)
    subprocess.run(['gjs', '-m', str(root / 'tools/preview-preferences.js')], env=env, check=True)
