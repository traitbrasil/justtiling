#!/usr/bin/env python3
"""Locate installed typelib/runtime paths; inspect interfaces without starting Shell."""
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
version = os.environ.get('TRAIT_TEST_GNOME', '51')
if version not in ['50', '51']:
    raise SystemExit('TRAIT_TEST_GNOME must be 50 or 51')
# Mutter 50 packages use ABI namespace 18; Mutter 51 uses namespace 51.
abi = '18' if version == '50' else '51'
typelibs = list(Path('/usr/lib').glob(f'*/mutter-{abi}/Meta-{abi}.typelib'))
typelibs += list(Path('/usr/lib').glob(f'mutter-{abi}/Meta-{abi}.typelib'))
if not typelibs:
    raise SystemExit(f'Meta-{abi}.typelib not found for GNOME {version}; no compositor started.')
runtime = str(typelibs[0].parent)
env = os.environ.copy()
env['GI_TYPELIB_PATH'] = runtime + ':/usr/lib/gnome-shell:' + env.get('GI_TYPELIB_PATH', '')
env['LD_LIBRARY_PATH'] = runtime + ':/usr/lib/gnome-shell:' + env.get('LD_LIBRARY_PATH', '')
subprocess.run(['gjs', '-m', 'tools/check-api.js'], cwd=root, env=env, check=True)
