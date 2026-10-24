#!/usr/bin/env python3
"""Opt-in terminal capture. Run as the graphical-session user, without sudo."""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import subprocess
import time

UUID = 'just@trait.com.br'
SCHEMA = 'org.gnome.shell.extensions.justtiling'
ROOT = Path(__file__).resolve().parents[1]


def run(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs).stdout.strip()


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
        print(f'Captura por {seconds} segundos. Aperte Caps Lock para mostrar e ocultar o aviso.', flush=True)
        print('Você também pode abrir a janela principal e outras janelas auxiliares nesse intervalo.', flush=True)
        time.sleep(seconds)
    except KeyboardInterrupt:
        interrupted = True
    finally:
        if original is None:
            run([*command, 'reset', SCHEMA, 'debug'])
        else:
            run([*command, 'set', SCHEMA, 'debug', str(original).lower()])
    lines = run(['journalctl', '--user', '--after-cursor', cursor, '--no-pager', '-o', 'cat']).splitlines()
    rows = [line for line in lines if '[justtiling] Window capture ' in line]
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
