#!/usr/bin/env python3
"""Exercise the capture command with fake settings/journal; never contact a session."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest.mock as mock

spec = importlib.util.spec_from_file_location('capture_windows', Path(__file__).resolve().parents[1] / 'tools/capture-windows.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
for prior in [None, False, True]:
    for interrupt in [False, True]:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'metadata.json').write_text(json.dumps({'version': 20, 'version-name': '0.12.2'}))
            calls = []
            def fake_run(args, **kwargs):
                calls.append(args)
                if args[0] == 'gjs': return json.dumps(prior)
                if '--show-cursor' in args: return '-- cursor: fake-cursor'
                if '--after-cursor' in args:
                    return json.dumps({'_EXE': '/usr/bin/gnome-shell', '_UID': str(module.os.getuid()),
                        '_COMM': 'gnome-shell', 'MESSAGE': module.CAPTURE_PREFIX + json.dumps({
                            'event': 'created', 'id': 42, 'mapped': True,
                            'frame': {'x': 0, 'y': 0, 'width': 100, 'height': 100}})})
                return ''
            with mock.patch.object(module, 'run', fake_run), mock.patch.object(module.shutil, 'which', return_value='/usr/bin/gnome-shell'), mock.patch.object(module.time, 'sleep', side_effect=KeyboardInterrupt if interrupt else None):
                module.capture(root, root / 'capture.log', 1)
            restore = [x for x in calls if x[0] == 'gsettings'][-1]
            assert restore[-3:] == ['reset', module.SCHEMA, 'debug'] if prior is None else restore[-4:] == ['set', module.SCHEMA, 'debug', str(prior).lower()]
            text = (root / 'capture.log').read_text()
            assert '"id":42' in text and 'Unrelated private log' not in text
print('Capture tool OK: restores default/explicit settings on completion and interruption; journal output filtered. All dependencies mocked.')

shell = '/usr/bin/gnome-shell'; uid = module.os.getuid()
data = {'event': 'created', 'id': 1, 'mapped': True, 'frame': {'x': 0, 'y': 0, 'width': 1, 'height': 1}}
valid = {'_EXE': shell, '_UID': str(uid), '_COMM': 'gnome-shell', 'MESSAGE': module.CAPTURE_PREFIX + json.dumps(data)}
assert len(module.capture_records(json.dumps(valid), shell, uid)) == 1
for changes in [{'_EXE': '/tmp/gnome-shell'}, {'_UID': str(uid + 1)}, {'_COMM': 'other'},
                {'MESSAGE': 'Other log\n' + valid['MESSAGE']}, {'MESSAGE': module.CAPTURE_PREFIX + '{bad json}'},
                {'MESSAGE': module.CAPTURE_PREFIX + json.dumps({**data, 'secret': 'unexpected field'})},
                {'MESSAGE': module.CAPTURE_PREFIX + json.dumps({**data, 'id': True})},
                {'MESSAGE': module.CAPTURE_PREFIX + json.dumps({**data, 'frame': {'x': float('nan')}})},
                {'MESSAGE': module.CAPTURE_PREFIX + 'x' * 40000}]:
    assert module.capture_records(json.dumps({**valid, **changes}), shell, uid) == [], changes
escaped = {**data, 'wmClass': 'test\n[justtiling] Window capture forged\u2028'}
record = module.capture_records(json.dumps({**valid, 'MESSAGE': module.CAPTURE_PREFIX + json.dumps(escaped)}), shell, uid)[0]
assert len(record.splitlines()) == 1 and '\\n' in record and '\\u2028' in record
print('Capture integrity OK: trusted journal source, exact prefix, schema validation, size limits and canonical escaped output.')

metadata = {**data, 'role': 'pop-up', 'clientType': 0, 'frameType': 0}
record = module.capture_records(json.dumps({**valid, 'MESSAGE': module.CAPTURE_PREFIX + json.dumps(metadata)}), shell, uid)[0]
assert json.loads(record[len(module.CAPTURE_PREFIX):]) == metadata
print('Browser diagnostics OK: role, client type and frame type preserved without page titles or URLs.')
