// SPDX-License-Identifier: GPL-3.0-or-later
import {_} from './i18n.js';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {appIdentities, exclusion, matchesApp, setAppException} from './rules.js';
import {Connections} from './resources.js';

export class Indicator {
    constructor(uuid, adapter, controller, settings, setEnabled, openPreferences) {
        this.adapter = adapter;
        this.controller = controller;
        this.settings = settings;
        this.setEnabled = setEnabled;
        this.signals = new Connections();
        this.updating = false;
        this.targetId = null;
        try {
            this.button = new PanelMenu.Button(0.0, 'Trait JustTiling');
            this.icon = new St.Icon({icon_name: 'view-grid-symbolic', style_class: 'system-status-icon'});
            this.button.add_child(this.icon);
            this.toggle = new PopupMenu.PopupSwitchMenuItem(_("Tile windows automatically"), false);
            this.resize = new PopupMenu.PopupSwitchMenuItem(_("Resize splits when releasing a window edge"), true);
            this.dragSwap = new PopupMenu.PopupSwitchMenuItem(_("Swap windows by dragging and dropping"), true);
            this.floating = new PopupMenu.PopupMenuItem(_("Toggle the active window between tiled and floating"));
            this.appRule = new PopupMenu.PopupSwitchMenuItem(_("Always float this application"), false);
            for (const item of [this.toggle, this.resize, this.dragSwap, new PopupMenu.PopupSeparatorMenuItem(),
                this.floating, this.appRule]) this.button.menu.addMenuItem(item);
            this.signals.add(this.button.menu, 'open-state-changed', (_menu, open) => {
                // Keep the opening target through menu close: native activation
                // may close the popup before our activate handler runs.
                if (open) this.targetId = adapter.focusedId();
                this.update();
            });
            this.signals.add(this.toggle, 'toggled', (_item, enabled) => {
                if (!this.updating) this.setEnabled(enabled);
            });
            this.signals.add(this.resize, 'toggled', (_item, enabled) => {
                if (!this.updating) settings.set_boolean('resize-splits', enabled);
            });
            this.signals.add(this.dragSwap, 'toggled', (_item, enabled) => {
                if (!this.updating) settings.set_boolean('drag-swap', enabled);
            });
            this.signals.add(this.floating, 'activate', () => {
                const id = this.targetId ?? this.adapter.focusedId();
                if (id !== null) this.controller.toggleWindow(id);
            });
            this.signals.add(this.appRule, 'toggled', (_item, enabled) => {
                if (this.updating) return;
                const data = this.data(this.targetId ?? this.adapter.focusedId());
                if (!this.canSetRule(data)) return;
                const current = settings.get_strv('floating-apps');
                settings.set_strv('floating-apps', setAppException(current, data, enabled));
                if (enabled) controller.applyAppRule(data);
            });
            this.preferences = new PopupMenu.PopupMenuItem(_("Preferences…"));
            this.button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this.button.menu.addMenuItem(this.preferences);
            this.signals.add(this.preferences, 'activate', () => openPreferences());
            Main.panel.addToStatusArea(uuid, this.button);
            this.update();
        } catch (error) {
            this.destroy();
            throw error;
        }
    }

    target() { return this.button.menu.isOpen ? this.targetId : this.adapter.focusedId(); }
    data(id = this.target()) {
        this.adapter.activeWorkspace();
        return this.adapter.read(id);
    }
    canSetRule(data) {
        return data?.alive && data.normal && !data.transient && !data.sticky && !data.overrideRedirect &&
            !data.skipTaskbar && data.inScope && appIdentities(data).length > 0;
    }

    update() {
        if (!this.button) return;
        const enabled = this.settings.get_boolean('tiling-enabled');
        const active = enabled && this.controller.running && !this.controller.suspended;
        const data = this.data();
        this.updating = true;
        try {
            const status = this.controller.suspended ? _("Tiling paused") :
                active ? _("Automatic tiling enabled") : _("Automatic tiling disabled");
            this.button.accessible_name = `Trait JustTiling: ${status}`;
            this.icon.opacity = active ? 255 : 128;
            this.toggle.setToggleState(active);
            this.dragSwap.setToggleState(this.settings.get_boolean('drag-swap'));
            this.resize.setToggleState(this.settings.get_boolean('resize-splits'));
            this.floating.setSensitive(active && data?.ready && !exclusion(data));
            const valid = Boolean(this.canSetRule(data));
            this.appRule.setSensitive(valid);
            this.appRule.setToggleState(valid && matchesApp(data, this.settings.get_strv('floating-apps')));
        } finally {
            this.updating = false;
        }
    }

    destroy() {
        this.signals.clear();
        this.button?.destroy();
        this.button = null;
        this.targetId = null;
        this.controller = null;
        this.adapter = null;
        this.settings = null;
        this.setEnabled = null;
    }
}
