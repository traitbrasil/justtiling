#!/usr/bin/env python3
"""Real installed Nautilus + GTK in headless GNOME, private bus/profile/sockets.

No connection to the user's display, D-Bus session, settings or extension.
The private broker has no service activation directories. No file is selected.
"""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def stop(process):
    if process.poll() is None:
        process.terminate()
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=3)


def run_private():
    runtime = Path(os.environ['XDG_RUNTIME_DIR'])
    subprocess.run(['gsettings', 'set', 'org.gnome.shell', 'enabled-extensions',
                    "['chooser-probe@local']"], check=True, timeout=5)
    subprocess.run(['gsettings', 'set', 'org.gnome.shell', 'disable-user-extensions',
                    'false'], check=True, timeout=5)
    children = []
    with (runtime / 'native.log').open('w+') as log:
        try:
            shell = subprocess.Popen(['gnome-shell', '--headless', '--wayland', '--no-x11',
                                      '--virtual-monitor', '1280x900', '--wayland-display',
                                      'justtiling-private'], stdout=log, stderr=log)
            children.append(shell)
            for _ in range(100):
                if shell.poll() is not None:
                    raise RuntimeError('Private compositor exited')
                if (runtime / 'justtiling-private').exists():
                    break
                time.sleep(0.1)
            else:
                raise RuntimeError('Private compositor socket unavailable')
            children.append(subprocess.Popen(['nautilus', '--new-window', str(runtime)],
                                             stdout=log, stderr=log))
            # Wait for Nautilus's real main window before testing its portal.
            for _ in range(100):
                log.flush()
                text = (runtime / 'native.log').read_text()
                if '"gtkWindowPath":"/org/gnome/Nautilus/window/' in text:
                    break
                time.sleep(0.1)
            else:
                raise RuntimeError('Nautilus main window unavailable')
            for action, caller, handle in [('OpenFile', 'org.test.Upload', 'open'),
                                            ('SaveFile', 'org.test.Download', 'save')]:
                children.append(subprocess.Popen([
                    'gdbus', 'call', '--session', '--dest', 'org.gnome.Nautilus',
                    '--object-path', '/org/freedesktop/portal/desktop', '--method',
                    'org.freedesktop.impl.portal.FileChooser.' + action,
                    '/org/freedesktop/portal/desktop/request/probe/' + handle,
                    caller, '', 'Arbitrary test title', '{}'], stdout=log, stderr=log))
            for _ in range(100):
                rows = []
                for line in (runtime / 'native.log').read_text().splitlines():
                    if 'CHOOSER_PROBE ' in line:
                        rows = json.loads(line.split('CHOOSER_PROBE ', 1)[1])
                main = [r for r in rows if r['gtkWindowPath']]
                choosers = [r for r in rows if r['gtkWindowPath'] is None]
                if len(main) == 1 and len(choosers) == 2:
                    assert main[0]['reason'] is None, rows
                    assert all(r['normal'] and not r['transient'] and
                               r['reason'] == 'auxiliary-window' for r in choosers), rows
                    print('Installed Nautilus/GTK: main Files window eligible; '
                          'unparented OpenFile and SaveFile excluded. No titles used.')
                    return
                time.sleep(0.1)
            raise RuntimeError('Native chooser metadata did not match expected windows')
        except Exception:
            log.flush()
            print((runtime / 'native.log').read_text()[-12000:], file=sys.stderr)
            raise
        finally:
            for child in reversed(children):
                stop(child)


def main():
    if len(sys.argv) == 2 and sys.argv[1] == '--private-child':
        run_private()
        return
    with tempfile.TemporaryDirectory(prefix='justtiling-native-chooser-') as tmp:
        root = Path(tmp)
        os.chmod(tmp, 0o700)
        env = os.environ.copy()
        env.update(HOME=tmp, XDG_RUNTIME_DIR=tmp, XDG_CONFIG_HOME=tmp+'/config',
                   XDG_DATA_HOME=tmp+'/data', XDG_CACHE_HOME=tmp+'/cache',
                   GSETTINGS_BACKEND='keyfile', GTK_A11Y='none', GDK_BACKEND='wayland',
                   WAYLAND_DISPLAY='justtiling-private', LIBGL_ALWAYS_SOFTWARE='1',
                   GNOME_SHELL_SESSION_MODE='user', XDG_CURRENT_DESKTOP='GNOME')
        for key in ['DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'DBUS_STARTER_ADDRESS',
                    'DBUS_STARTER_BUS_TYPE', 'GSETTINGS_SCHEMA_DIR']:
            env.pop(key, None)
        extension = root / 'data/gnome-shell/extensions/chooser-probe@local'
        extension.mkdir(parents=True)
        (extension / 'metadata.json').write_text(json.dumps({
            'uuid': 'chooser-probe@local', 'name': 'Private metadata probe',
            'description': 'Isolated native test', 'shell-version': ['51']}))
        shutil.copyfile(ROOT / 'tests/fixtures/nativeChooser.js', extension / 'extension.js')
        (extension / 'src').mkdir()
        shutil.copyfile(ROOT / 'src/rules.js', extension / 'src/rules.js')
        config = root / 'bus.conf'
        config.write_text('<busconfig><type>session</type><auth>EXTERNAL</auth>'
                          '<policy context="default"><allow send_destination="*"/>'
                          '<allow receive_sender="*"/><allow own="*"/></policy></busconfig>')
        with socket.socket(socket.AF_UNIX) as listener:
            listener.bind(tmp+'/bus')
            listener.listen(128)
            broker = os.fork()
            if broker == 0:
                os.dup2(listener.fileno(), 3)
                os.set_inheritable(3, True)
                broker_env = env | {'LISTEN_FDS': '1', 'LISTEN_PID': str(os.getpid())}
                os.execve('/usr/bin/dbus-broker-launch', ['dbus-broker-launch', '--scope',
                          'user', '--config-file', str(config)], broker_env)
        env['DBUS_SESSION_BUS_ADDRESS'] = 'unix:path='+tmp+'/bus'
        try:
            subprocess.run([sys.executable, __file__, '--private-child'], env=env,
                           check=True, timeout=60)
        finally:
            os.kill(broker, 15)
            os.waitpid(broker, 0)


if __name__ == '__main__':
    main()
