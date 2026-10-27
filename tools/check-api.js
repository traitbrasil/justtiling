// SPDX-License-Identifier: GPL-3.0-or-later
// Read-only introspection. Never construct Meta.Context, Shell.Global or windows.
import Meta from 'gi://Meta';
import GObject from 'gi://GObject';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Graphene from 'gi://Graphene';

const methods = {
    Window: ['activate', 'get_stable_sequence', 'get_min_size', 'get_max_size', 'get_frame_rect',
        'get_compositor_private', 'get_buffer_rect', 'client_rect_to_frame_rect', 'move_resize_frame',
        'get_workspace', 'get_monitor', 'move_frame', 'get_maximize_flags', 'set_maximize_flags',
        'unmaximize', 'make_above', 'unmake_above', 'is_above', 'get_window_type',
        'get_transient_for', 'is_override_redirect', 'is_skip_taskbar',
        'is_on_all_workspaces', 'is_fullscreen', 'allows_move', 'allows_resize',
        'get_pid', 'get_client_type', 'get_wm_class', 'get_wm_class_instance', 'get_gtk_application_id', 'get_sandboxed_app_id',
        'get_gtk_unique_bus_name', 'get_gtk_application_object_path', 'get_gtk_window_object_path'],
    Display: ['list_all_windows', 'get_n_monitors', 'get_primary_monitor'],
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
    'window-type', 'on-all-workspaces', 'gtk-unique-bus-name',
    'gtk-application-object-path', 'gtk-window-object-path']) {
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
for (const method of ['add_child', 'get_child_transform', 'set_child_above_sibling']) {
    if (typeof Meta.WindowActor.prototype[method] !== 'function') throw new Error(`Missing actor ${method}`);
    count++;
}
for (const method of ['set_position', 'set_size', 'set_scale', 'set_child_above_sibling', 'show', 'destroy']) {
    if (typeof St.Widget.prototype[method] !== 'function') throw new Error(`Missing St.Widget.${method}`);
    count++;
}
const matrix = new Graphene.Matrix(); matrix.init_identity();
if (matrix.get_value(0, 0) !== 1) throw new Error('Missing matrix value access');
count++;
const r = new Mtk.Rectangle({x: 0, y: 0, width: 1, height: 1});
if (r.width !== 1) throw new Error('Mtk.Rectangle unavailable');
print(`Meta/Shell/St contract OK: ${count} methods, signals, properties and grab operations. No compositor initialized.`);

for (const [type, names] of [[Shell.WindowTracker, ['get_window_app']],
    [Shell.App, ['get_id', 'is_window_backed', 'activate']],
    [Shell.AppSystem, ['lookup_app']]]) {
    for (const name of names) {
        if (typeof type.prototype[name] !== 'function') throw new Error(`Missing application method ${name}`);
    }
}
void Shell.WindowTracker.prototype;
if (!GObject.signal_lookup('tracked-windows-changed', Shell.WindowTracker.$gtype))
    throw new Error('Missing WindowTracker::tracked-windows-changed');

for (const [type, methods] of [[Clutter.Grab, ['is_revoked']],
    [Clutter.Event, ['get_key_code', 'get_key_symbol', 'get_state']],
    [St.Widget, ['add_child']], [St.Label, ['set_text']]]) {
    for (const method of methods)
        if (typeof type.prototype[method] !== 'function') throw new Error(`Missing selection API ${method}`);
}
for (const value of [Clutter.AnimationMode.EASE_OUT_QUAD, Shell.ActionMode.POPUP, Clutter.ActorAlign.CENTER,
    Clutter.ModifierType.SUPER_MASK, Clutter.ModifierType.MOD1_MASK, Clutter.KEY_0, Clutter.KEY_KP_0])
    if (!Number.isInteger(value)) throw new Error('Missing numbered selection constant');
print('Numbered selection input and overlay API contract OK.');

void Meta.WindowActor.prototype;
for (const signal of ['first-frame', 'destroy', 'child-added'])
    if (!GObject.signal_lookup(signal, Meta.WindowActor.$gtype))
        throw new Error(`Missing window actor signal ${signal}`);
const actorProperties = GObject.Object.list_properties.call(Meta.WindowActor).map(p => p.name);
for (const name of ['mapped', 'allocation', 'child-transform'])
    if (!actorProperties.includes(name)) throw new Error(`Missing window actor property ${name}`);
void Shell.WM.prototype;
if (!GObject.signal_lookup('map', Shell.WM.$gtype)) throw new Error('Missing Shell.WM::map');
print('Opening focus border actor/map signals OK.');

for (const method of ['add_effect_with_name', 'remove_effect', 'get_paint_volume', 'get_resource_scale', 'get_paint_opacity', 'invalidate_paint_volume'])
    if (typeof Meta.WindowActor.prototype[method] !== 'function') throw new Error(`Missing rounding API ${method}`);
void Meta.WindowActor.prototype;
if (!GObject.signal_lookup('resource-scale-changed', Meta.WindowActor.$gtype))
    throw new Error('Missing actor resource-scale-changed');
for (const method of ['get_target_size', 'get_actor'])
    if (typeof Clutter.ShaderEffect.prototype[method] !== 'function') throw new Error(`Missing shader API ${method}`);
const {modernShader, CornerBackend} = await import('../src/cornerBackend.js');
const {CornerEffect} = await import('../src/cornerEffect.js');
if (modernShader) {
    const cornerEffect = new CornerEffect();
    cornerEffect.update({bounds: [10, 15, 700, 500], radius: 8});
    const snippet = cornerEffect.vfunc_get_static_snippet();
    if (!snippet) throw new Error('Corner effect snippet missing');
    const shadowVolume = {origin: {x: 0, y: 0, z: 0}, width: 700, height: 500,
        get_origin() { return this.origin; }, get_width() { return this.width; }, get_height() { return this.height; },
        set_origin(origin) { this.origin = origin; }, set_width(width) { this.width = width; }, set_height(height) { this.height = height; }};
    cornerEffect.vfunc_modify_paint_volume(shadowVolume);
    if (shadowVolume.origin.x !== -10 || shadowVolume.origin.y !== -5 || shadowVolume.width !== 740 || shadowVolume.height !== 540)
        throw new Error('Rounded shadow paint volume did not expand correctly');

} else {
    for (const method of ['add_glsl_snippet', 'get_uniform_location', 'set_uniform_float'])
        if (typeof CornerBackend.prototype[method] !== 'function') throw new Error(`Missing legacy shader API ${method}`);
    print('Legacy shader construction is checked inside the private compositor.');
}
for (const method of ['get_origin', 'get_width', 'get_height', 'set_origin', 'set_width', 'set_height'])
    if (typeof Clutter.PaintVolume.prototype[method] !== 'function') throw new Error(`Missing paint volume API ${method}`);
print('Rounded corner native GObject class, Cogl snippet, uniforms and actor contracts OK (no compositor).');
