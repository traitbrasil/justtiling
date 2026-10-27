#!/usr/bin/env python3
"""Reject linked, external and non-regular build inputs before reading content."""
from pathlib import Path
import stat


def check_source(root, source):
    root = Path(root).resolve()
    source = Path(source)
    try:
        relative = source.relative_to(root)
    except ValueError:
        raise ValueError('Source outside repository') from None
    current = root
    for component in relative.parts:
        current = current / component
        mode = current.lstat().st_mode
        if stat.S_ISLNK(mode) or not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
            raise ValueError(f'Unsafe build input: {relative}')
        if current.resolve().is_relative_to(root) is False:
            raise ValueError(f'External build input: {relative}')
    return source


def check_inputs(root):
    root = Path(root).resolve()
    for name in ['metadata.json', 'extension.js', 'prefs.js', 'LICENSE', 'src', 'schemas', 'po']:
        source = check_source(root, root / name)
        if source.is_dir():
            # Walk only after checking each directory; never follow a link.
            pending = [source]
            while pending:
                folder = pending.pop()
                for child in folder.iterdir():
                    check_source(root, child)
                    if child.is_dir(): pending.append(child)
