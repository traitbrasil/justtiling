// SPDX-License-Identifier: GPL-3.0-or-later
// Read-only introspection. Never construct Meta.Context, Shell.Global or windows.
import Meta from 'gi://Meta?version=51';
import GObject from 'gi://GObject';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Graphene from 'gi://Graphene';

const methods = {
    Window: ['activate', 'get_stable_sequence', 'get_min_size', 'get_max_size', 'get_frame_rect',
        'get_compositor_private', 'get_buffer_rect', 'client_rect_to_frame_rect', 'move_resize_frame',
        'get_workspace', 'get_monitor', 'get_maximize_flags', 'set_maximize_flags',
        'unmaximize', 'make_above', 'unmake_above', 'is_above', 'get_window_type',
        'get_transient_for', 'is_override_redirect', 'is_skip_taskbar',
        'is_on_all_workspaces', 'is_fullscreen', 'allows_move', 'allows_resize',
        'get_pid', 'get_wm_class', 'get_wm_class_instance', 'get_gtk_application_id', 'get_sandboxed_app_id'],
    Display: ['list_all_windows', 'get_n_monitors'],
    Workspace: ['get_work_area_for_monitor'],
    WorkspaceManager: ['get_active_workspace', 'get_n_workspaces', 'get_workspace_by_index'],
};
const signals = {
    Window: ['unmanaging', 'size-changed', 'position-changed', 'workspace-changed', 'shown'],
    Display: ['window-created', 'grab-op-begin', 'grab-op-end', 'window-entered-monitor',
        'window-left-monitor', 'workareas-changed'],
    WorkspaceManager: ['active-workspace-changed', 'workspace-removed', 'workspace-added', 'workspaces-reordered'],
};
let count = 0;
for (const [name, names] of Object.entries(methods)) {
    for (const method of names) {
        if (typeof Meta[name].prototype[method] !== 'function')
            throw new Error(`Missing Meta.${name}.${method}`);
        count++;
    }
}
for (const [name, names] of Object.entries(signals)) {
    // Access prototype first, to register the class with GObject.
    void Meta[name].prototype;
    for (const signal of names) {
        if (!GObject.signal_lookup(signal, Meta[name].$gtype))
            throw new Error(`Missing Meta.${name}::${signal}`);
        count++;
    }
}
const properties = GObject.Object.list_properties.call(Meta.Window).map(p => p.name);
for (const property of ['mapped', 'minimized', 'fullscreen', 'above', 'resizeable',
    'maximized-horizontally', 'maximized-vertically', 'wm-class', 'gtk-application-id',
    'window-type', 'on-all-workspaces']) {
    if (!properties.includes(property)) throw new Error(`Missing Window property ${property}`);
    count++;
}
for (const prefix of ['RESIZING_', 'KEYBOARD_RESIZING_']) {
    for (const suffix of ['N', 'S', 'E', 'W', 'NW', 'NE', 'SW', 'SE']) {
        if (!Number.isInteger(Meta.GrabOp[`${prefix}${suffix}`]))
            throw new Error(`Missing Meta.GrabOp.${prefix}${suffix}`);
        count++;
    }
}
for (const name of ['MOVING', 'MOVING_UNCONSTRAINED', 'KEYBOARD_MOVING']) {
    if (!Number.isInteger(Meta.GrabOp[name])) throw new Error(`Missing Meta.GrabOp.${name}`);
    count++;
}
if (typeof Shell.Global.prototype.get_pointer !== 'function') throw new Error('Missing Shell.Global.get_pointer');
count++;
for (const method of ['add_child', 'get_child_transform']) {
    if (typeof Meta.WindowActor.prototype[method] !== 'function') throw new Error(`Missing actor ${method}`);
    count++;
}
for (const method of ['set_position', 'set_size', 'set_scale', 'show', 'destroy']) {
    if (typeof St.Widget.prototype[method] !== 'function') throw new Error(`Missing St.Widget.${method}`);
    count++;
}
const matrix = new Graphene.Matrix(); matrix.init_identity();
if (matrix.get_value(0, 0) !== 1) throw new Error('Missing matrix value access');
count++;
const r = new Mtk.Rectangle({x: 0, y: 0, width: 1, height: 1});
if (r.width !== 1) throw new Error('Mtk.Rectangle unavailable');
print(`Meta/Shell/St 51 contract OK: ${count} methods, signals, properties and grab operations. No compositor initialized.`);

for (const [type, names] of [[Shell.WindowTracker, ['get_window_app']],
    [Shell.App, ['get_id', 'is_window_backed']]]) {
    for (const name of names) {
        if (typeof type.prototype[name] !== 'function') throw new Error(`Missing application method ${name}`);
    }
}
void Shell.WindowTracker.prototype;
if (!GObject.signal_lookup('tracked-windows-changed', Shell.WindowTracker.$gtype))
    throw new Error('Missing WindowTracker::tracked-windows-changed');
