#!/usr/bin/env python3
"""Run real GTK widgets using private Broadway sockets; never connect to desktop."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from translations import compile_catalogs
import time

root = Path(__file__).resolve().parents[1]
if not shutil.which('gtk4-broadwayd'):
    raise SystemExit('gtk4-broadwayd is required for the isolated GTK test.')
with tempfile.TemporaryDirectory(prefix='justtiling-prefs-') as tmp:
    stage = Path(tmp)
    compile_catalogs(stage / 'locale')
    env = os.environ.copy()
    env.update({'XDG_RUNTIME_DIR': tmp, 'GDK_BACKEND': 'broadway', 'BROADWAY_DISPLAY': ':39',
                'GSETTINGS_BACKEND': 'memory', 'LANGUAGE': 'pt_BR',
                'TRAIT_TEST_LOCALEDIR': str(stage / 'locale'), 'GTK_A11Y': 'none',
                'DBUS_SESSION_BUS_ADDRESS': f'unix:path={tmp}/no-session-bus'})
    shutil.copytree(root / 'schemas', stage / 'schemas')
    subprocess.run(['glib-compile-schemas', '--strict', str(stage / 'schemas')], check=True)
    env['GSETTINGS_SCHEMA_DIR'] = str(stage / 'schemas')
    with (stage / 'broadway.log').open('w+') as log:
        server = subprocess.Popen(['gtk4-broadwayd', '--unixsocket', f'{tmp}/http.socket', ':39'],
                                  env=env, stdout=log, stderr=log)
        try:
            ready = False
            for _ in range(100):
                if server.poll() is not None:
                    log.seek(0)
                    raise RuntimeError(log.read())
                if (stage / 'broadway40.socket').exists():
                    ready = True
                    break
                time.sleep(0.02)
            if not ready:
                raise RuntimeError('Private Broadway socket did not become ready')
            for language in ['pt_BR', 'en']:
                env['LANGUAGE'] = language
                env['LC_ALL'] = 'pt_BR.UTF-8'
                print(f'Testing GTK preferences: {language}', flush=True)
                subprocess.run(['gjs', '-m', str(root / 'tests/preferences-smoke.js')],
                               cwd=root, env=env, check=True, timeout=20)
            env['TRAIT_PREVIEW_SMOKE'] = '1'
            subprocess.run(['python3', str(root / 'tools/preview-english.py')],
                           cwd=root, env=env, check=True, timeout=20)
        finally:
            server.terminate()
            try:
                server.wait(timeout=3)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=3)
