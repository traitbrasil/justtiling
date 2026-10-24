// SPDX-License-Identifier: GPL-3.0-or-later
import {canonicalAccelerator, SHORTCUT_TITLES} from './keybindings.js';

// Migrate only known defaults; custom, disabled and multiple bindings stay intact.
export function migrateShortcuts(settings) {
    const version = settings.get_int('preferences-version');
    if (version >= 2) return;
    const changes = new Map();
    const legacy = {
        'toggle-tiling': ['<Super><Control><Alt>t'],
        'toggle-floating': ['<Super>f', ...(version < 1 ? ['<Super><Control><Alt>f'] : [])],
        'cycle-focus': ['<Super>c'],
    };
    const next = {'toggle-tiling': '<Super>t', 'toggle-floating': '<Super>o', 'cycle-focus': '<Super>f'};
    const custom = new Map();
    for (const key of Object.keys(SHORTCUT_TITLES)) {
        if (settings.get_user_value(key) === null) continue;
        const values = settings.get_strv(key);
        if (values.length === 1 && legacy[key]?.some(value =>
            canonicalAccelerator(value) === canonicalAccelerator(values[0]))) {
            if (key !== 'toggle-tiling' || version < 1) changes.set(key, [next[key]]);
            else custom.set(key, values);
        } else custom.set(key, values);
    }
    for (const key of Object.keys(SHORTCUT_TITLES)) {
        if (custom.has(key)) continue;
        const values = changes.get(key) ?? settings.get_strv(key);
        if ([...custom.values()].flat().some(value => values.some(candidate =>
            canonicalAccelerator(candidate) === canonicalAccelerator(value))))
            changes.set(key, []);
    }
    for (const [key, values] of changes) settings.set_strv(key, values);
    settings.set_int('preferences-version', 2);
}
