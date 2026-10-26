// SPDX-License-Identifier: GPL-3.0-or-later
// Installed only in a temporary headless GNOME profile by test-native-chooser.py.
import GLib from 'gi://GLib';
import {exclusion} from './src/rules.js';
import {sameRect} from './src/layout/tree.js';
import JustTiling from './runtime.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export default class Probe extends JustTiling {
    enable() {
        super.enable();
        Main.overview.hide();
        this.assigned = new Set();
        if (GLib.getenv('TRAIT_TEST_DEBUG')) { this._adapter.traceWindows = true; this._controller.debug = true; }
        this.multi = GLib.getenv('TRAIT_TEST_MONITORS') === '2';
        this.missingPinMonitor = GLib.getenv('TRAIT_TEST_PIN_MONITOR') === 'missing';
        this.pinOpening = GLib.getenv('TRAIT_TEST_PIN_MONITOR') === '1' || this.missingPinMonitor;
        if (this.pinOpening) {
            this._controller.pinnedLayouts = {'gtk-app-id:org.gnome.Nautilus': {
                x: 0, y: 0, width: 0.5, height: 1, monitor: this.missingPinMonitor ? {index: 1, connector: 'DISCONNECTED-TEST'} : this._adapter.monitorIdentity(1)}};
            console.log(`PIN_MONITOR ${JSON.stringify(this._adapter.monitorIdentity(1))}`);
        }
        if (this.multi) this._adapter.monitorPreferences.set_boolean('workspaces-only-on-primary',
            GLib.getenv('TRAIT_TEST_WORKSPACES') !== 'all');
        this.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            const windows = global.display.list_all_windows()
                .filter(win => win.get_gtk_application_id() === 'org.gnome.Nautilus');
            if (this.multi && !this.pinOpening) {
                const main = windows.filter(win => win.get_gtk_window_object_path())
                    .sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence());
                if (main.length === 2 && main.every(win => {
                    const record = this._controller.records.get(win.get_stable_sequence());
                    return win.mapped && record?.state === 'tiled' &&
                        sameRect(win.get_frame_rect(), record.request?.rect, 1);
                })) {
                    for (const [index, win] of main.entries()) {
                        const id = win.get_stable_sequence();
                        if (this.assigned.has(id)) continue;
                        this.assigned.add(id);
                        // Move an already mapped window as a user operation.
                        // This also exercises native monitor-enter/leave signals.
                        const destination = global.workspace_manager.get_active_workspace().get_work_area_for_monitor(index);
                        win.move_frame(true, destination.x + 20, destination.y + 40);
                    }
                }
            }
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
                const record = this._controller.records.get(win.get_stable_sequence());
                const effect = win.get_compositor_private()?.get_effect('justtiling-rounded-corners');
                const area = global.workspace_manager.get_active_workspace().get_work_area_for_monitor(win.get_monitor());
                const frame = win.get_frame_rect();
                return {...data, reason: exclusion(data), state: record?.state, monitor: win.get_monitor(), count: global.display.get_n_monitors(),
                    areas: Array.from({length: global.display.get_n_monitors()}, (_, i) => { const r = global.workspace_manager.get_active_workspace().get_work_area_for_monitor(i); return [r.x, r.y, r.width, r.height]; }),
                    area: {x: area.x, y: area.y, width: area.width, height: area.height},
                    pinActive: Boolean(this._controller.owner(win.get_stable_sequence())?.pinGoals().has(win.get_stable_sequence())),
                    menuEligible: Boolean(this._indicator.canSetRule(this._adapter.read(win.get_stable_sequence()))),
                    inside: frame.x >= area.x && frame.y >= area.y && frame.x + frame.width <= area.x + area.width &&
                        frame.y + frame.height <= area.y + area.height,
                    rounded: Boolean(effect), painted: effect?.warned === false};
            });
            console.log(`CHOOSER_PROBE ${JSON.stringify(rows)}`);
            return GLib.SOURCE_CONTINUE;
        });
    }
    disable() { if (this.timer) GLib.source_remove(this.timer); super.disable(); }
}
