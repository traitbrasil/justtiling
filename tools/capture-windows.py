#!/usr/bin/env python3
"""Opt-in terminal capture. Run as the graphical-session user, without sudo."""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import subprocess
import shutil
import time

UUID = 'justtiling@trait.com.br'
SCHEMA = 'org.gnome.shell.extensions.justtiling'
ROOT = Path(__file__).resolve().parents[1]


def run(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs).stdout.strip()


CAPTURE_PREFIX = '[justtiling] Window capture '
CAPTURE_FIELDS = {'event', 'id', 'pid', 'lineage', 'wmClass', 'wmInstance', 'gtkAppId',
                  'sandboxId', 'gtkBusName', 'gtkApplicationPath', 'gtkWindowPath',
                  'appId', 'windowBacked', 'transientFor', 'type', 'mapped', 'skipTaskbar',
                  'overrideRedirect', 'resizable', 'above', 'frame', 'minimum', 'maximum',
                  'role', 'clientType', 'frameType'}


def capture_records(journal, shell_executable, uid):
    records = []
    for line in journal.splitlines():
        if len(line) > 65536: continue
        try:
            row = json.loads(line)
            if not isinstance(row, dict) or row.get('_EXE') != shell_executable or row.get('_UID') != str(uid): continue
            if row.get('_COMM') != 'gnome-shell': continue
            message = row.get('MESSAGE')
            if not isinstance(message, str) or len(message) > 32768 or not message.startswith(CAPTURE_PREFIX): continue
            data = json.loads(message[len(CAPTURE_PREFIX):])
            if not isinstance(data, dict) or set(data) - CAPTURE_FIELDS: continue
            if not isinstance(data.get('id'), int) or isinstance(data['id'], bool) or data['id'] <= 0: continue
            if not isinstance(data.get('event'), str) or len(data['event']) > 64: continue
            if not isinstance(data.get('mapped'), bool) or not isinstance(data.get('frame'), dict): continue
            if set(data['frame']) != {'x', 'y', 'width', 'height'}: continue
            if any(type(value) not in (int, float) or not -1e7 <= value <= 1e7 for value in data['frame'].values()): continue
            records.append(CAPTURE_PREFIX + json.dumps(data, ensure_ascii=True, allow_nan=False, separators=(',', ':')))
        except (ValueError, TypeError):
            continue
    return records


def capture(installed, output, seconds):
    metadata = json.loads((installed / 'metadata.json').read_text())
    if tuple(int(part) for part in metadata.get('version-name', '0').split('.')) < (0, 12, 2):
        raise SystemExit('Instale a versão 0.12.2 ou posterior e encerre/inicie a sessão antes da captura.')
    schemas = installed / 'schemas'
    env = {**os.environ, 'GSETTINGS_SCHEMA_DIR': str(schemas)}
    # Preserve both the value and whether it was explicitly customized.
    original = json.loads(run(['gjs', '-c',
        f"const s = new imports.gi.Gio.Settings({{schema_id: '{SCHEMA}'}}); "
        "print(JSON.stringify(s.get_user_value('debug')?.deep_unpack() ?? null));"], env=env))
    cursor_lines = run(['journalctl', '--user', '-n', '0', '--show-cursor', '--no-pager']).splitlines()
    cursor = next((line.split(': ', 1)[1] for line in cursor_lines if line.startswith('-- cursor: ')), None)
    if not cursor:
        raise SystemExit('Não foi possível obter o cursor do journal; nenhuma configuração foi alterada.')
    command = ['gsettings', '--schemadir', str(schemas)]
    interrupted = False
    try:
        run([*command, 'set', SCHEMA, 'debug', 'true'])
        print(f'Captura por {seconds} segundos. Abra a janela que deseja investigar e mantenha-a aberta até terminar.', flush=True)
        print('Mantenha a janela principal aberta também, para comparação. Não é necessário concluir o login.', flush=True)
        time.sleep(seconds)
    except KeyboardInterrupt:
        interrupted = True
    finally:
        if original is None:
            run([*command, 'reset', SCHEMA, 'debug'])
        else:
            run([*command, 'set', SCHEMA, 'debug', str(original).lower()])
    shell_executable = str(Path(shutil.which('gnome-shell') or '/usr/bin/gnome-shell').resolve())
    journal = run(['journalctl', '--user', '--after-cursor', cursor, '--no-pager',
                   f'_EXE={shell_executable}', f'_UID={os.getuid()}', '-o', 'json'])
    rows = capture_records(journal, shell_executable, os.getuid())
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(f"Just Tiling {metadata['version-name']} — captura {datetime.now().astimezone().isoformat()}\n"
                      'Sem títulos de janelas, argumentos ou variáveis de ambiente.\n' + '\n'.join(rows) + '\n')
    print(f'Captura {"interrompida" if interrupted else "concluída"}; configuração anterior de debug restaurada.')
    print(f'{len(rows)} registros salvos em: {output}')
    if not rows:
        print('Nenhuma janela capturada. Confira se a extensão está ativa e se encerrou/iniciou a sessão após atualizar.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seconds', type=int, default=20)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist/captura-janelas.log')
    args = parser.parse_args()
    if not 1 <= args.seconds <= 120:
        parser.error('--seconds deve estar entre 1 e 120')
    installed = Path(os.environ.get('XDG_DATA_HOME', str(Path.home() / '.local/share'))) / 'gnome-shell/extensions' / UUID
    if not (installed / 'metadata.json').is_file():
        raise SystemExit('Extensão não encontrada nesta conta. Execute sem sudo no usuário da sessão gráfica.')
    capture(installed, args.output, args.seconds)


if __name__ == '__main__':
    main()
