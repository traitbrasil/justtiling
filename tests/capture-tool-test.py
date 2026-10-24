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
                if '--after-cursor' in args: return '[justtiling] Window capture {"id":42}\nUnrelated private log'
                return ''
            with mock.patch.object(module, 'run', fake_run), mock.patch.object(module.time, 'sleep', side_effect=KeyboardInterrupt if interrupt else None):
                module.capture(root, root / 'capture.log', 1)
            restore = [x for x in calls if x[0] == 'gsettings'][-1]
            assert restore[-3:] == ['reset', module.SCHEMA, 'debug'] if prior is None else restore[-4:] == ['set', module.SCHEMA, 'debug', str(prior).lower()]
            text = (root / 'capture.log').read_text()
            assert '"id":42' in text and 'Unrelated private log' not in text
print('Capture tool OK: restores default/explicit settings on completion and interruption; journal output filtered. All dependencies mocked.')
