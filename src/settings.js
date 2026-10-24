// SPDX-License-Identifier: GPL-3.0-or-later
import {canonicalAccelerator} from './keybindings.js';

// Only our own known legacy bindings migrate. Empty/custom values remain untouched.
export function migrateShortcuts(settings) {
    if (settings.get_int('preferences-version') >= 1) return;
    const bindings = {
        'toggle-tiling': ['<Super><Control><Alt>t', '<Super>t'],
        'toggle-floating': ['<Super><Control><Alt>f', '<Super>f'],
    };
    for (const [key, [previous, next]] of Object.entries(bindings)) {
        if (settings.get_user_value(key) === null) continue;
        const value = settings.get_strv(key);
        if (value.length === 1 && canonicalAccelerator(value[0]) === canonicalAccelerator(previous))
            settings.set_strv(key, [next]);
    }
    settings.set_int('preferences-version', 1);
}
