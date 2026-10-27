#!/usr/bin/env python3
"""Validate gettext sources and compile deterministic GNU MO catalogs, without external tools."""
from source_safety import check_inputs
import argparse
import gettext
import io
import json
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[1]
DOMAIN = 'trait-justtiling'


def source_messages():
    messages = set()
    for path in [ROOT / 'extension.js', ROOT / 'prefs.js', *(ROOT / 'src').rglob('*.js')]:
        text = path.read_text()
        for token in re.findall(r'(?<![\w])(?:_|N_)\(("(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\')\)', text):
            # Source markers use JSON-quoted English strings.
            messages.add(json.loads(token) if token.startswith('"') else token[1:-1])
    return messages


def read_po(path):
    entries = {}
    key = value = None
    field = None
    for line in [*path.read_text().splitlines(), '']:
        line = line.strip()
        if not line or line.startswith('#'):
            if not line and key is not None:
                if value is None or key in entries: raise ValueError(f'Invalid/duplicate PO entry in {path}')
                entries[key] = value
                key = value = field = None
            continue
        if line.startswith('msgid '):
            key = json.loads(line[6:]); field = 'key'
        elif line.startswith('msgstr '):
            value = json.loads(line[7:]); field = 'value'
        elif line.startswith('"') and field:
            if field == 'key': key += json.loads(line)
            else: value += json.loads(line)
        else:
            raise ValueError(f'Unsupported PO directive in {path}: {line}')
    return entries


def compile_mo(entries):
    pairs = sorted((key.encode('utf-8'), value.encode('utf-8')) for key, value in entries.items())
    count = len(pairs); start = 28 + 16 * count
    originals = b''.join(key + b'\0' for key, _ in pairs)
    translations = b''.join(value + b'\0' for _, value in pairs)
    key_offset = start; value_offset = start + len(originals)
    keys = []; values = []
    for key, value in pairs:
        keys.append((len(key), key_offset)); values.append((len(value), value_offset))
        key_offset += len(key) + 1; value_offset += len(value) + 1
    table = b''.join(struct.pack('<2I', *entry) for entry in keys + values)
    return struct.pack('<7I', 0x950412de, 0, count, 28, 28 + 8 * count, 0, 0) + table + originals + translations


def compile_catalogs(destination):
    check_inputs(ROOT)
    messages = source_messages()
    template = read_po(ROOT / 'po' / f'{DOMAIN}.pot')
    if set(template) - {''} != messages:
        raise ValueError('Translation template does not match source messages')
    count = 0
    for source in sorted((ROOT / 'po').glob('*.po')):
        entries = read_po(source)
        if set(entries) - {''} != messages:
            raise ValueError(f'Catalog mismatch in {source}: missing={messages - set(entries)}, extra={set(entries) - messages - {""}}')
        for key in messages:
            if not entries[key]: raise ValueError(f'Empty translation: {key}')
            if re.findall(r'%%|%s', key) != re.findall(r'%%|%s', entries[key]):
                raise ValueError(f'Placeholder mismatch: {key}')
        binary = compile_mo(entries)
        parsed = gettext.GNUTranslations(io.BytesIO(binary))
        for key in messages:
            if parsed.gettext(key) != entries[key]: raise ValueError(f'MO verification failed: {key}')
        languages = [source.stem]
        if source.stem == 'pt_BR': languages.append('pt')
        for language in languages:
            target = Path(destination) / language / 'LC_MESSAGES' / f'{DOMAIN}.mo'
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(binary); count += 1
    if not count: raise ValueError('No translation catalogs')
    return count, len(messages)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    catalogs, messages = compile_catalogs(args.output)
    print(f'Translations OK: {messages} English messages; {catalogs} verified Portuguese catalogs.')
