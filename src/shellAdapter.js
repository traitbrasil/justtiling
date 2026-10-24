// SPDX-License-Identifier: GPL-3.0-or-later
import {_} from './i18n.js';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import {SYSTEM_SCHEMAS} from './shortcutOverrides.js';
import {Connections} from './resources.js';
import {clampRect, frameLimits, plainRect} from './geometry.js';
import {applicationIdentities, canonicalAppExceptions} from './rules.js';
import {PackageIdentity} from './packageIdentity.js';
import {PackageLookup} from './packageLookup.js';
import {processLineage} from './processInfo.js';
import {describeGrab} from './grab.js';

export class ShellAdapter {
    constructor() {
        this.workspace = global.workspace_manager.get_active_workspace();
        this.windows = new Map();
        this.connections = new Connections();
        this.callback = null;
        this.shortcutSettings = null;
        this.tracker = Shell.WindowTracker.get_default();
        this.packageLookup = new PackageLookup();
        this.packageIdentity = new PackageIdentity(executable => this.packageLookup.lookup(executable),
            () => this.emit('changed'));
        this.identitySnapshot = null;
        this.traceWindows = false;
    }

    conflicts() {
        return Main.extensionManager.getUuids().filter(uuid => {
            if (!/^(justtiling@dudu\.local$|just@trait\.com\.br$|o-tiling@|pop-shell@|forge@|smarttiling@|tilingshell@|tiling-assistant@|paperwm@|material-shell@)/i.test(uuid))
                return false;
            const state = Main.extensionManager.lookup(uuid)?.state;
            return [ExtensionState.ACTIVE, ExtensionState.ACTIVATING].includes(state);
        });
    }

    conflictDetails() {
        return this.conflicts().sort().map(uuid => {
            const name = Main.extensionManager.lookup(uuid)?.metadata?.name;
            return {uuid, name: typeof name === 'string' && name.trim() ?
                name.replace(/\s+/g, ' ').trim().slice(0, 160) : uuid};
        });
    }

    observe(callback) {
        this.callback = callback;
        const on = (object, name, fn) => this.connections.add(object, name, fn);
        on(this.tracker, 'tracked-windows-changed', () => {
            this.emit('changed'); this.traceAllWindows('tracker');
        });
        on(global.display, 'window-created', (_display, win) => {
            this.watch(win);
            this.emit('changed');
        });
        // Meta focus/mapped notifications may precede actor creation. Shell's
        // map signal supplies the point at which a native actor is available.
        on(global.window_manager, 'map', () => this.emit('changed'));
        on(global.display, 'notify::focus-window', () =>
            this.emit('focus', global.display.focus_window?.get_stable_sequence()));
        on(global.display, 'grab-op-begin', (_display, win, op) =>
            this.emit('grab-begin', win.get_stable_sequence(), describeGrab(op, Meta.GrabOp)));
        on(global.display, 'grab-op-end', (_display, win) => this.emit('grab-end', win.get_stable_sequence()));
        for (const signal of ['window-entered-monitor', 'window-left-monitor'])
            on(global.display, signal, () => this.emit('changed'));
        on(global.display, 'workareas-changed', () => this.emit('changed'));
        on(Main.layoutManager, 'monitors-changed', () => this.emit('topology'));
        on(global.workspace_manager, 'active-workspace-changed', () => this.emit('workspace'));
        on(global.workspace_manager, 'workspace-removed', () => this.emit('workspace'));
        on(global.workspace_manager, 'workspace-added', () => this.emit('workspace'));
        on(global.workspace_manager, 'workspaces-reordered', () => this.emit('workspace'));
        on(Main.extensionManager, 'extension-state-changed', () => this.emit('conflict'));
        // Connect before enumeration so creations cannot fall between the two operations.
        for (const win of global.display.list_all_windows()) this.watch(win);
    }

    emit(kind, id = null, grab = null) {
        if (kind !== 'geometry') this.identitySnapshot = null;
        try { this.callback?.({kind, id, grab}); }
        catch (e) { this.log('error', `Event ${kind}: ${e.stack ?? e}`); }
    }

    watch(win) {
        const id = win.get_stable_sequence();
        if (this.windows.has(id)) return;
        const signals = new Connections();
        this.identitySnapshot = null;
        this.windows.set(id, {win, signals});
        this.traceWindow(win, 'created');
        signals.add(win, 'unmanaging', () => {
            signals.clear();
            this.windows.delete(id);
            this.emit('closed', id);
        });
        for (const name of ['size-changed', 'position-changed'])
            signals.add(win, name, () => this.emit('geometry', id));
        for (const name of ['workspace-changed', 'shown', 'notify::mapped',
            'notify::minimized', 'notify::fullscreen', 'notify::maximized-horizontally',
            'notify::maximized-vertically', 'notify::wm-class', 'notify::gtk-application-id',
            'notify::window-type', 'notify::resizeable', 'notify::on-all-workspaces',
            'notify::gtk-unique-bus-name', 'notify::gtk-application-object-path',
            'notify::gtk-window-object-path'])
            signals.add(win, name, () => {
                this.emit('changed', id); this.traceWindow(win, name);
            });
    }

    list() { return [...this.windows.keys()]; }
    pointer() {
        const [x, y] = global.get_pointer();
        return {x, y};
    }
    monitorCount() { return global.display.get_n_monitors(); }
    activeWorkspace() {
        this.workspace = global.workspace_manager.get_active_workspace();
        return this.workspace;
    }
    workspaces() {
        const manager = global.workspace_manager;
        return Array.from({length: manager.get_n_workspaces()}, (_, i) => manager.get_workspace_by_index(i));
    }
    focusedId() { return global.display.focus_window?.get_stable_sequence() ?? null; }
    targetActive() { return global.workspace_manager.get_active_workspace() === this.workspace; }
    targetExists() {
        const manager = global.workspace_manager;
        for (let i = 0; i < manager.get_n_workspaces(); i++) {
            if (manager.get_workspace_by_index(i) === this.workspace) return true;
        }
        return false;
    }
    area() { return plainRect(this.workspace.get_work_area_for_monitor(0)); }

    traceAllWindows(event = 'snapshot') {
        if (this.traceWindows)
            for (const {win} of this.windows.values()) this.traceWindow(win, event);
    }

    traceWindow(win, event) {
        if (!this.traceWindows) return;
        try {
            const app = this.tracker.get_window_app(win);
            const pid = win.get_pid();
            const lineage = processLineage(pid, key => {
                const [, bytes] = Gio.File.new_for_path(`/proc/${key}/status`).load_contents(null);
                return new TextDecoder().decode(bytes);
            }, key => Gio.File.new_for_path(`/proc/${key}/exe`).query_info(
                'standard::symlink-target', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null).get_symlink_target());
            const info = {
                event, id: win.get_stable_sequence(), pid, lineage,
                wmClass: win.get_wm_class(), wmInstance: win.get_wm_class_instance(),
                gtkAppId: win.get_gtk_application_id(), sandboxId: win.get_sandboxed_app_id(),
                gtkBusName: win.get_gtk_unique_bus_name(),
                gtkApplicationPath: win.get_gtk_application_object_path(),
                gtkWindowPath: win.get_gtk_window_object_path(),
                appId: app?.get_id() ?? null, windowBacked: app?.is_window_backed() ?? null,
                transientFor: win.get_transient_for()?.get_stable_sequence() ?? null,
                type: Object.keys(Meta.WindowType).find(key => Meta.WindowType[key] === win.get_window_type()) ?? win.get_window_type(),
                mapped: win.mapped, skipTaskbar: win.is_skip_taskbar(),
                overrideRedirect: win.is_override_redirect(), resizable: win.allows_resize(),
                above: win.is_above(), frame: plainRect(win.get_frame_rect()),
                minimum: win.get_min_size(), maximum: win.get_max_size(),
            };
            this.log('info', `Window capture ${JSON.stringify(info)}`);
        } catch (error) {
            this.log('warn', `Window capture unavailable: ${error.message}`);
        }
    }

    applicationSnapshot() {
        if (this.identitySnapshot) return this.identitySnapshot;
        const raw = new Map();
        for (const [id, entry] of this.windows) {
            const {win, inheritedIdentities} = entry;
            const app = this.tracker.get_window_app(win);
            const group = app?.get_id() ?? null;
            const nativeAppId = app && !app.is_window_backed() ? group : null;
            let fallback = {pending: false, appId: null};
            if (!nativeAppId && win.mapped && win.get_window_type() === Meta.WindowType.NORMAL &&
                !win.get_sandboxed_app_id() && !win.get_gtk_application_id()) {
                if (!entry.executable) entry.executable = this.packageLookup.executable(win.get_pid());
                fallback = this.packageIdentity.get(entry.executable);
            }
            raw.set(id, {
                appId: nativeAppId ?? fallback.appId, identityPending: fallback.pending,
                appGroupId: nativeAppId ?? fallback.appId ?? group, pid: win.get_pid(),
                applicationIdentities: [...(inheritedIdentities ?? []), ...this.packageLookup.aliases(fallback.appId)],
                transientFor: win.get_transient_for()?.get_stable_sequence() ?? null,
                wmClass: win.get_wm_class(), wmInstance: win.get_wm_class_instance(),
                gtkAppId: win.get_gtk_application_id(), sandboxId: win.get_sandboxed_app_id(),
            });
        }
        const related = applicationIdentities(raw);
        this.identitySnapshot = new Map([...raw].map(([id, d]) => {
            const inherited = [...new Set([...(d.applicationIdentities ?? []), ...related.get(id)])];
            // A child remains part of its application after the parent closes.
            // This association lasts only for this native window's lifetime.
            this.windows.get(id).inheritedIdentities = inherited;
            return [id, {...d, applicationIdentities: inherited}];
        }));
        return this.identitySnapshot;
    }

    canonicalFloatingApps(exceptions) {
        return canonicalAppExceptions(exceptions, this.applicationSnapshot());
    }

    read(id) {
        const win = this.windows.get(id)?.win;
        if (!win) return null;
        const rect = plainRect(win.get_frame_rect());
        const identity = this.applicationSnapshot().get(id);
        const limits = frameLimits(win.get_min_size(), win.get_max_size(), (width, height) =>
            win.client_rect_to_frame_rect(new Mtk.Rectangle({x: 0, y: 0, width, height})));
        return {
            alive: true, ready: !identity?.identityPending && win.mapped && Boolean(win.get_compositor_private()) && rect.width > 0 && rect.height > 0,
            normal: win.get_window_type() === Meta.WindowType.NORMAL,
            transient: Boolean(win.get_transient_for()), overrideRedirect: win.is_override_redirect(),
            skipTaskbar: win.is_skip_taskbar(), sticky: win.is_on_all_workspaces(),
            inScope: win.get_workspace() === this.workspace && win.get_monitor() === 0,
            domain: win.get_workspace(), monitor: win.get_monitor(),
            fullscreen: win.is_fullscreen(), minimized: win.minimized,
            maximized: win.get_maximize_flags() !== 0,
            movable: win.allows_move(), resizable: win.allows_resize(), above: win.is_above(),
            ...identity,
            gtkBusName: win.get_gtk_unique_bus_name(),
            gtkApplicationPath: win.get_gtk_application_object_path(),
            gtkWindowPath: win.get_gtk_window_object_path(),
            rect, ...limits,
        };
    }

    focusBorderData() { return this.decorationData(this.focusedId()); }

    decorationData(id) {
        const win = this.windows.get(id)?.win;
        if (!win) return null;
        const type = win.get_window_type();
        return {
            ...this.windowVisual(id), alive: true, mapped: win.mapped,
            appWindow: [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG,
                Meta.WindowType.MODAL_DIALOG, Meta.WindowType.UTILITY].includes(type),
            inScope: win.is_on_all_workspaces() ||
                win.get_workspace() === global.workspace_manager.get_active_workspace(),
            overrideRedirect: win.is_override_redirect(), minimized: win.minimized,
            fullscreen: win.is_fullscreen(), maximized: win.get_maximize_flags() !== 0,
        };
    }

    focusedVisual() { return this.windowVisual(this.focusedId()); }

    windowVisual(id) {
        const win = this.windows.get(id)?.win;
        if (!win) return null;
        return {actor: win.get_compositor_private(), frame: plainRect(win.get_frame_rect()),
            buffer: plainRect(win.get_buffer_rect())};
    }

    capture(id) {
        const win = this.windows.get(id).win;
        return {rect: plainRect(win.get_frame_rect()), flags: win.get_maximize_flags()};
    }
    shortcutSources() {
        if (!this.shortcutSettings) {
            this.shortcutSettings = [];
            const source = Gio.SettingsSchemaSource.get_default();
            for (const name of SYSTEM_SCHEMAS) {
                const schema = source.lookup(name, true);
                if (!schema) continue;
                const settings = new Gio.Settings({settings_schema: schema});
                this.shortcutSettings.push({name, settings, schema});
                this.connections.add(settings, 'changed', () => this.emit('shortcuts'));
            }
        }
        const bindings = [];
        for (const {name, settings, schema} of this.shortcutSettings) {
            for (const key of schema.list_keys()) {
                if (settings.get_value(key).get_type_string() === 'as')
                    bindings.push({schema: name, key, accelerators: settings.get_strv(key)});
            }
        }
        return bindings;
    }
    flushShortcutJournal() { Gio.Settings.sync(); }
    readSystemShortcut(schema, key) {
        if (!this.shortcutSettings) this.shortcutSources();
        const source = this.shortcutSettings.find(s => s.name === schema);
        if (!source?.schema.has_key(key) || source.settings.get_value(key).get_type_string() !== 'as') return null;
        return {values: source.settings.get_strv(key), userValue: source.settings.get_user_value(key)?.deep_unpack() ?? null};
    }
    writeSystemShortcut(schema, key, value) {
        const source = this.shortcutSettings?.find(s => s.name === schema);
        if (!source?.schema.has_key(key) || !source.settings.is_writable(key)) return false;
        if (value === null) source.settings.reset(key);
        else if (!source.settings.set_strv(key, value)) return false;
        return true;
    }
    bindShortcut(name, settings, handler) {
        return Main.wm.addKeybinding(name, settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | (name === 'swap-select' ? Shell.ActionMode.POPUP : 0), handler) !== Meta.KeyBindingAction.NONE;
    }
    unbindShortcut(name) { Main.wm.removeKeybinding(name); }
    move(id, r) {
        this.windows.get(id)?.win.move_resize_frame(false, r.x, r.y, r.width, r.height);
    }
    focusWindow(id) {
        const win = this.windows.get(id)?.win;
        if (!win || win.get_workspace() !== global.workspace_manager.get_active_workspace() ||
            win.minimized || win.is_fullscreen()) return;
        win.activate(global.get_current_time());
    }
    unmaximize(id) { this.windows.get(id)?.win.unmaximize(); }
    restore(id, snapshot) {
        const win = this.windows.get(id)?.win;
        if (!win || win.is_fullscreen() || win.minimized) return;
        const workspace = win.get_workspace();
        const monitor = win.get_monitor();
        if (!workspace || monitor < 0 || monitor >= this.monitorCount()) return;
        const area = plainRect(workspace.get_work_area_for_monitor(monitor));
        const r = clampRect(snapshot.rect, area);
        win.unmaximize();
        this.move(id, r);
        if (snapshot.flags) win.set_maximize_flags(snapshot.flags);
    }

    translate(message) { return _(message); }
    notice(message) { Main.notify('Trait JustTiling', _(message)); }
    log(level, message) {
        // Routine lifecycle/window messages are opt-in; warnings remain visible.
        if (level === 'info' && !this.traceWindows) return;
        const line = `[justtiling] ${message}`;
        if (level === 'error') console.error(line);
        else if (level === 'warn') console.warn(line);
        else console.log(line);
    }
    stopObserving() {
        this.callback = null;
        this.connections.clear();
        this.identitySnapshot = null;
        for (const {signals} of this.windows.values()) signals.clear();
    }
    dispose() {
        this.packageIdentity.dispose();
        this.packageLookup.dispose();
        this.stopObserving();
        this.windows.clear();
        this.workspace = null;
        this.shortcutSettings = null;
        this.tracker = null;
        this.shortcutEnabled = null;
    }
}
