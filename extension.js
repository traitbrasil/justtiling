// SPDX-License-Identifier: GPL-3.0-or-later
import {N_} from './src/strings.js';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {readLearning, writeLearning} from './src/learning.js';
import {Controller} from './src/controller.js';
import {ShellAdapter} from './src/shellAdapter.js';
import {Connections} from './src/resources.js';
import {ShortcutOverrides} from './src/shortcutOverrides.js';
import {Keybindings} from './src/keybindings.js';
import {migrateShortcuts} from './src/settings.js';
import {RoundedCorners} from './src/roundedCorners.js';
import {FocusBorder} from './src/focusBorder.js';
import {NumberedSwap} from './src/numberedSwap.js';
import {SwapPreview} from './src/swapPreview.js';
import {Indicator} from './src/indicator.js';
import {ConflictNotice} from './src/conflictNotice.js';

export default class JustTiling extends Extension {
    enable() {
        try {
            this._adapter = new ShellAdapter();
            this._settings = this.getSettings();
            migrateShortcuts(this._settings);
            this._connections = new Connections();
            const clock = {
                now: () => GLib.get_monotonic_time() / 1000,
                after: (delay, callback) => GLib.timeout_add(GLib.PRIORITY_DEFAULT,
                    Math.max(1, Math.ceil(delay)), () => {
                        callback();
                        return GLib.SOURCE_REMOVE;
                    }),
                cancel: id => GLib.source_remove(id),
            };
            this._controller = new Controller(this._adapter, clock, this._gaps());
            this._controller.floatingApps = this._settings.get_strv('floating-apps');
            this._controller.pinnedLayouts = readLearning(this._settings.get_string('pinned-layouts'));
            this._controller.onPinnedLayouts = apps => this._settings.set_string('pinned-layouts', writeLearning(apps));
            this._controller.learnLayouts = this._settings.get_boolean('learn-layouts');
            this._controller.learnedLayouts = readLearning(this._settings.get_string('learned-layouts'));
            this._controller.onLearnedLayouts = apps => this._settings.set_string('learned-layouts', writeLearning(apps));
            this._controller.debug = this._settings.get_boolean('debug');
            this._adapter.traceWindows = this._controller.debug;
            this._controller.resizeSplits = this._settings.get_boolean('resize-splits');
            this._controller.layoutAssistant = this._settings.get_boolean('layout-assistant');
            this._controller.dragSwap = this._settings.get_boolean('drag-swap');
            this._controller.insertionSide = this._settings.get_string('new-window-side');
            this._controller.preserveFocusedWindow = this._settings.get_boolean('preserve-focused-window');
            this._conflictNotice = new ConflictNotice(this._adapter, () => this._syncEnabled());
            this._adapter.observe(event => {
                if (event.kind === 'changed') this._controller.floatingApps = this._floatingApps();
                if (event.kind === 'conflict') {
                    const conflicts = this._adapter.conflictDetails();
                    if (this._settings.get_boolean('tiling-enabled') && conflicts.length)
                        this._pauseForConflicts(conflicts);
                    else if (this._conflictNotice.conflicts.length)
                        this._conflictNotice.update([]);
                } else if (event.kind === 'shortcuts')
                    this._keys?.refresh();
                else
                    this._controller.event(event);
                this._corners?.sync();
                this._border?.sync();
                this._preview?.sync();
                this._numberedSwap?.sync();
                if (event.kind !== 'geometry') this._indicator?.update();
            });
            this._controller.floatingApps = this._floatingApps();
            this._adapter.shortcutEnabled = name => (!name.startsWith('swap-') && name !== 'cycle-focus') ||
                (this._controller.running && !this._controller.suspended);
            this._keys = new Keybindings(this._adapter, this._settings, {
                'toggle-tiling': () => {
                    if (this._controller.suspended && this._settings.get_boolean('tiling-enabled'))
                        this._syncEnabled();
                    else
                        this._settings.set_boolean('tiling-enabled', !this._settings.get_boolean('tiling-enabled'));
                },
                'swap-select': () => this._numberedSwap?.toggle(),
                'cycle-focus': () => this._controller.cycleFocus(),
                'toggle-pin': () => this._controller.togglePin(this._adapter.focusedId()),
                'toggle-floating': () => this._controller.toggleWindow(this._adapter.focusedId()),
                ...Object.fromEntries(['left', 'right', 'up', 'down'].map(direction =>
                    [`swap-${direction}`, () => this._controller.swapDirection(direction)])),
            }, new ShortcutOverrides(this._adapter, this._settings));
            this._keys.refresh();
            this._connections.add(this._settings, 'changed', (_settings, key) => {
                if (key === 'system-shortcut-backup') return;
                this._numberedSwap?.cancel();
                if (key === 'learn-layouts' || key === 'learned-layouts') {
                    this._controller.learnLayouts = this._settings.get_boolean('learn-layouts');
                    this._controller.learnedLayouts = readLearning(this._settings.get_string('learned-layouts'));
                    this._controller.learningPending = null;
                    return;
                }
                if (key === 'pinned-layouts') {
                    this._controller.pinnedLayouts = readLearning(this._settings.get_string(key));
                    this._controller.pinCache.clear();
                    this._controller.learningPending = null;
                }
                if (key === 'debug') {
                    this._adapter.traceWindows = this._settings.get_boolean('debug');
                    this._adapter.traceAllWindows();
                }
                if (key === 'tiling-enabled') this._syncEnabled();
                else if (key === 'toggle-tiling' || key === 'toggle-floating' || key === 'toggle-pin' || key === 'cycle-focus' || key.startsWith('swap-')) this._keys.refresh();
                else if (key !== 'hide-panel-icon' && key !== 'focus-border' && key !== 'round-window-corners' && key !== 'corner-radius' && key !== 'focus-border-width') {
                    this._controller.gaps = this._gaps();
                    this._controller.floatingApps = this._settings.get_strv('floating-apps');
                    this._controller.debug = this._settings.get_boolean('debug');
                    this._controller.resizeSplits = this._settings.get_boolean('resize-splits');
                    this._controller.layoutAssistant = this._settings.get_boolean('layout-assistant');
                    this._controller.dragSwap = this._settings.get_boolean('drag-swap');
                    this._controller.insertionSide = this._settings.get_string('new-window-side');
                    this._controller.preserveFocusedWindow = this._settings.get_boolean('preserve-focused-window');
                    this._controller.schedule(0);
                }
                this._indicator?.update();
                this._corners?.sync();
                this._border?.sync();
                this._preview?.sync();
                this._numberedSwap?.sync();
            });
            this._indicator = new Indicator(this.uuid, this._adapter, this._controller, this._settings, enabled => {
                const previous = this._settings.get_boolean('tiling-enabled');
                this._settings.set_boolean('tiling-enabled', enabled);
                if (previous === enabled) this._syncEnabled();
            }, () => this.openPreferences(), this._conflictNotice);
            this._corners = new RoundedCorners(this._adapter, this._settings);
            this._border = new FocusBorder(this._adapter, this._settings);
            this._preview = new SwapPreview(this._adapter, this._controller);
            this._numberedSwap = new NumberedSwap(this._adapter, this._controller);
            this._controller.onStateChanged = () => {
                const active = this._controller.running && !this._controller.suspended;
                if (this._keysActive !== active) {
                    this._keysActive = active;
                    this._keys.refresh();
                }
                this._indicator?.update();
                this._corners?.sync();
                this._border?.sync();
                this._preview?.sync();
                this._numberedSwap?.sync();
            };
            this._adapter.log('info', `Trait JustTiling ${this.metadata['version-name']} loaded.`);
            this._syncEnabled(false);
        } catch (error) {
            this.disable();
            throw error;
        }
    }

    _floatingApps() {
        const current = this._settings.get_strv('floating-apps');
        const canonical = this._adapter.canonicalFloatingApps(current);
        if (JSON.stringify(current) !== JSON.stringify(canonical))
            this._settings.set_strv('floating-apps', canonical);
        return canonical;
    }

    _gaps() {
        return {inner: this._settings.get_int('inner-gap'), outer: this._settings.get_int('outer-gap')};
    }

    _pauseForConflicts(conflicts) {
        this._controller.suspend(N_("Auto-tiling paused: another window manager is active"), false);
        this._conflictNotice.update(conflicts);
        this._indicator?.update();
    }

    _syncEnabled(notify = true) {
        if (!this._settings.get_boolean('tiling-enabled')) {
            this._conflictNotice.clear();
            this._controller.stop();
            if (notify) this._adapter.notice(N_("Automatic tiling disabled."));
            return;
        }
        const conflicts = this._adapter.conflictDetails();
        if (conflicts.length) {
            this._pauseForConflicts(conflicts);
            return;
        }
        this._conflictNotice.clear();
        this._controller.start();
        if (notify) this._adapter.notice(N_("Automatic tiling enabled."));
    }

    disable() {
        // Synchronous, including partial-enable failure; observers go away before restoration.
        this._connections?.clear();
        this._keys?.dispose();
        if (this._controller) {
            this._controller.onStateChanged = null;
            this._controller.onLearnedLayouts = null;
            this._controller.onPinnedLayouts = null;
        }
        this._conflictNotice?.destroy();
        this._numberedSwap?.destroy();
        this._preview?.destroy();
        this._corners?.destroy();
        this._border?.destroy();
        this._indicator?.destroy();
        this._adapter?.stopObserving();
        this._controller?.stop();
        this._adapter?.dispose();
        this._connections = null;
        this._controller = null;
        this._adapter = null;
        this._settings = null;
        this._keys = null;
        this._keysActive = null;
        this._indicator = null;
        this._corners = null;
        this._border = null;
        this._preview = null;
        this._numberedSwap = null;
        this._conflictNotice = null;
    }
}
