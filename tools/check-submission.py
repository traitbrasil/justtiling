#!/usr/bin/env python3
"""Offline validation of the public submission ZIP. Never install or contact Shell."""
import hashlib
import json
from source_safety import check_inputs
from pathlib import Path
import posixpath
import re
import xml.etree.ElementTree as ET
import zipfile
import tempfile
from translations import compile_catalogs, DOMAIN

root = Path(__file__).resolve().parents[1]
check_inputs(root)
metadata = json.loads((root / 'metadata.json').read_text())
archive = root / 'dist' / f"trait-justtiling-{metadata['version-name']}.zip"
assert metadata['uuid'] == 'justtiling@trait.com.br', 'Unexpected public UUID'
assert metadata['name'] == 'Trait JustTiling'
assert metadata['settings-schema'] == 'org.gnome.shell.extensions.justtiling', 'Keep existing user settings'
assert 'version' not in metadata, 'EGO controls the numeric submission version'
assert re.fullmatch(r'(?![. ]+$)[a-zA-Z0-9 .]{1,16}', metadata['version-name'])
assert metadata['url'] == 'https://trait.li/just'
assert metadata['shell-version'] == ['50', '51'], 'Claim only the locally validated GNOME version'
assert metadata['gettext-domain'] == DOMAIN
with tempfile.TemporaryDirectory(prefix='trait-catalog-check-') as tmp:
    compile_catalogs(Path(tmp) / 'locale')
    catalogs = {p.relative_to(tmp).as_posix(): p.read_bytes() for p in Path(tmp).rglob('*.mo')}
required = {'metadata.json', 'extension.js', 'prefs.js', 'LICENSE'}
required.update(p.relative_to(root).as_posix() for p in (root / 'src').rglob('*.js'))
required.update(p.relative_to(root).as_posix() for p in (root / 'schemas').glob('*.gschema.xml'))
required.update(catalogs)
with zipfile.ZipFile(archive) as package:
    assert package.testzip() is None
    assert set(package.namelist()) == required, 'Unexpected/missing packaged file'
    assert json.loads(package.read('metadata.json')) == metadata
    for name, binary in catalogs.items():
        assert package.read(name) == binary, f'Stale translation: {name}'
    for name in required - set(catalogs):
        assert package.read(name) == (root / name).read_bytes(), f'Stale packaged source: {name}'
    schema_file = f"schemas/{metadata['settings-schema']}.gschema.xml"
    schema = ET.fromstring(package.read(schema_file)).find('schema')
    assert schema.attrib['id'] == metadata['settings-schema']
    assert schema.attrib['path'] == '/org/gnome/shell/extensions/justtiling/', 'Keep existing settings storage'
    def graph(entry):
        pending = [entry]; visited = set()
        while pending:
            name = pending.pop()
            if name in visited: continue
            visited.add(name)
            source = package.read(name).decode()
            for target in re.findall(r"(?:from\s+|import\s*)['\"]([^'\"]+)['\"]", source):
                if target.startswith('.'):
                    child = posixpath.normpath(posixpath.join(posixpath.dirname(name), target))
                    assert child in required, f'Unpackaged import: {child}'
                    pending.append(child)
            yield name, source
    for entry, forbidden in [('extension.js', ['Gtk', 'Gdk', 'Adw']), ('prefs.js', ['Meta', 'Shell', 'St', 'Clutter'])]:
        for name, source in graph(entry):
            for library in forbidden:
                assert not re.search(rf"['\"]gi://{library}(?:\?|['\"])", source), f'Forbidden import in {entry}: {name}'
    reachable = {name for entry in ['extension.js', 'prefs.js'] for name, _ in graph(entry)}
    assert not {name for name in required if name.startswith('src/') and name not in reachable}, 'Unused shipped code'
checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix(archive.suffix + '.sha256').write_text(f'{checksum}  {archive.name}\n')
print(f'Submission ZIP OK: {len(required)} necessary files; metadata, source equality, schema and import boundaries checked.')
print(f'SHA-256: {checksum}')
print('Offline checks do not constitute GNOME approval or maintainer code review.')
