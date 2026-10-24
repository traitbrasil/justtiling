// SPDX-License-Identifier: GPL-3.0-or-later
// Explicit recovery command; not imported by the extension or automated tests.
import Gio from 'gi://Gio';
import {ShortcutOverrides, SYSTEM_SCHEMAS} from '../src/shortcutOverrides.js';
const own = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.justtiling'});
const source = Gio.SettingsSchemaSource.get_default();
const settings = new Map(SYSTEM_SCHEMAS.flatMap(name => {
    const schema = source.lookup(name, true);
    return schema ? [[name, {schema, value: new Gio.Settings({settings_schema: schema})}]] : [];
}));
const backend = {
    flushShortcutJournal() { Gio.Settings.sync(); },
    readSystemShortcut(name, key) {
        const s = settings.get(name);
        if (!s?.schema.has_key(key) || s.value.get_value(key).get_type_string() !== 'as') return null;
        return {values: s.value.get_strv(key), userValue: s.value.get_user_value(key)?.deep_unpack() ?? null};
    },
    writeSystemShortcut(name, key, value) {
        const s = settings.get(name);
        if (!s?.value.is_writable(key)) return false;
        if (value === null) s.value.reset(key);
        else if (!s.value.set_strv(key, value)) return false;
        return true;
    },
};
const recovery = new ShortcutOverrides(backend, own);
recovery.restore();
Gio.Settings.sync();
if (recovery.entries.length) throw new Error('Some shortcuts could not be restored; journal retained for retry.');
print('Shortcut recovery complete. Later user edits were preserved.');
