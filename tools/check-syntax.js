// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

let count = 0;
function scan(path) {
    const file = Gio.File.new_for_path(path);
    if (file.query_file_type(Gio.FileQueryInfoFlags.NONE, null) === Gio.FileType.DIRECTORY) {
        const entries = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        try {
            for (let info; (info = entries.next_file(null));)
                scan(`${path}/${info.get_name()}`);
        } finally { entries.close(null); }
    } else if (path.endsWith('.js')) {
        const [ok, bytes] = GLib.file_get_contents(path);
        if (!ok) throw new Error(`Cannot read ${path}`);
        Reflect.parse(new TextDecoder().decode(bytes), {target: 'module', source: path});
        count++;
    }
}
for (const path of ['extension.js', 'prefs.js', 'src', 'tests', 'tools']) scan(path);
print(`Syntax OK: ${count} ES modules parsed without importing Shell or connecting to the session.`);
