#!/usr/bin/env python3
"""Stage Shell import doubles in /tmp; do not load or contact the real Shell."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from translations import compile_catalogs

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
env['GSETTINGS_BACKEND'] = 'memory'
with tempfile.TemporaryDirectory(prefix='justtiling-smoke-') as tmp:
    stage = Path(tmp)
    compile_catalogs(stage / 'locale')
    env['TRAIT_TEST_LOCALEDIR'] = str(stage / 'locale')
    env['LANGUAGE'] = 'pt_BR'
    for name in ['src', 'tests', 'schemas']:
        shutil.copytree(root / name, stage / name)
    shutil.copyfile(root / 'extension.js', stage / 'extension.js')
    replacements = {
        'resource:///org/gnome/shell/ui/messageTray.js': (stage / 'tests/fixtures/messageTray.js').as_uri(),
        'resource:///org/gnome/shell/ui/main.js': (stage / 'tests/fixtures/main.js').as_uri(),
        'resource:///org/gnome/shell/extensions/extension.js': (stage / 'tests/fixtures/extension.js').as_uri(),
        'resource:///org/gnome/shell/misc/extensionUtils.js': (stage / 'tests/fixtures/extensionUtils.js').as_uri(),
        'resource:///org/gnome/shell/ui/panelMenu.js': (stage / 'tests/fixtures/panelMenu.js').as_uri(),
        'resource:///org/gnome/shell/ui/popupMenu.js': (stage / 'tests/fixtures/popupMenu.js').as_uri(),
        './cornerEffect.js': (stage / 'tests/fixtures/cornerEffect.js').as_uri(),
        './packageLookup.js': (stage / 'tests/fixtures/packageLookup.js').as_uri(),
        'gi://Shell': (stage / 'tests/fixtures/shell.js').as_uri(),
        'gi://Clutter': (stage / 'tests/fixtures/clutter.js').as_uri(),
        'gi://St': (stage / 'tests/fixtures/st.js').as_uri(),
    }
    for path in [stage / 'extension.js', *(stage / 'src').rglob('*.js')]:
        text = path.read_text()
        for original, double in replacements.items():
            text = text.replace(original, double)
        path.write_text(text)
    subprocess.run(['glib-compile-schemas', '--strict', str(stage / 'schemas')], check=True)
    env['GSETTINGS_SCHEMA_DIR'] = str(stage / 'schemas')
    for language in ['pt_BR', 'en']:
        env['LANGUAGE'] = language
        env['LC_ALL'] = 'pt_BR.UTF-8'
        print(f'Testing isolated Shell {version}: {language}', flush=True)
        subprocess.run(['gjs', '-m', str(stage / 'tests/shell-smoke.js'), stage.as_uri()],
                       cwd=stage, env=env, check=True, timeout=45)
