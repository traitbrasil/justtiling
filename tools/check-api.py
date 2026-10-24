#!/usr/bin/env python3
"""Locate installed typelib/runtime paths; inspect interfaces without starting Shell."""
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
typelibs = list(Path('/usr/lib').glob('*/mutter-51/Meta-51.typelib'))
typelibs += list(Path('/usr/lib').glob('mutter-51/Meta-51.typelib'))
if not typelibs:
    raise SystemExit('Meta-51.typelib not found; run this check in the GNOME 51 VM.')
runtime = str(typelibs[0].parent)
env = os.environ.copy()
env['GI_TYPELIB_PATH'] = runtime + ':/usr/lib/gnome-shell:' + env.get('GI_TYPELIB_PATH', '')
env['LD_LIBRARY_PATH'] = runtime + ':/usr/lib/gnome-shell:' + env.get('LD_LIBRARY_PATH', '')
subprocess.run(['gjs', '-m', 'tools/check-api.js'], cwd=root, env=env, check=True)
