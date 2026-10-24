// SPDX-License-Identifier: GPL-3.0-or-later
// Installed only in a temporary headless GNOME profile by test-native-chooser.py.
import GLib from 'gi://GLib';
import {exclusion} from './src/rules.js';

export default class Probe {
    enable() {
        this.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            const windows = global.display.list_all_windows()
                .filter(win => win.get_gtk_application_id() === 'org.gnome.Nautilus');
            const rows = windows.map(win => {
                const data = {
                    alive: true, normal: win.get_window_type() === 0,
                    transient: Boolean(win.get_transient_for()), inScope: true,
                    movable: win.allows_move(), resizable: win.allows_resize(),
                    gtkAppId: win.get_gtk_application_id(),
                    gtkBusName: win.get_gtk_unique_bus_name(),
                    gtkApplicationPath: win.get_gtk_application_object_path(),
                    gtkWindowPath: win.get_gtk_window_object_path(),
                };
                return {...data, reason: exclusion(data)};
            });
            console.log(`CHOOSER_PROBE ${JSON.stringify(rows)}`);
            return GLib.SOURCE_CONTINUE;
        });
    }
    disable() { if (this.timer) GLib.source_remove(this.timer); }
}
