// SPDX-License-Identifier: GPL-3.0-or-later
import {_} from './i18n.js';
import St from 'gi://St';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {appIdentities, exclusion, matchesApp, setAppException} from './rules.js';
import {learningMatch} from './learning.js';
import {Connections} from './resources.js';

export class Indicator {
    constructor(uuid, adapter, controller, settings, setEnabled, openPreferences, conflictNotice) {
        this.adapter = adapter;
        this.controller = controller;
        this.conflictNotice = conflictNotice;
        this.settings = settings;
        this.setEnabled = setEnabled;
        this.signals = new Connections();
        this.updating = false;
        this.targetId = null;
        try {
            this.button = new PanelMenu.Button(0.0, 'Trait JustTiling');
            this.icon = new St.Icon({icon_name: 'view-grid-symbolic', style_class: 'system-status-icon'});
            this.button.add_child(this.icon);
            this.conflict = this.conflictRow('');
            this.conflictList = new PopupMenu.PopupMenuSection();
            this.conflictRows = [];
            this.conflictSignature = null;
            this.manager = new PopupMenu.PopupMenuItem(_("Open Extension Manager"));
            this.resume = new PopupMenu.PopupMenuItem(_("Resume automatic tiling"));
            this.conflictSeparator = new PopupMenu.PopupSeparatorMenuItem();
            for (const item of [this.conflict, this.conflictList, this.manager, this.resume, this.conflictSeparator])
                this.button.menu.addMenuItem(item);
            this.signals.add(this.manager, 'activate', () => this.conflictNotice.openManager());
            this.signals.add(this.resume, 'activate', () => this.conflictNotice.resume());
            this.toggle = new PopupMenu.PopupSwitchMenuItem(_("Tile windows automatically"), false);
            this.floating = new PopupMenu.PopupMenuItem(_("Toggle the active window between tiled and floating"));
            this.pinRule = new PopupMenu.PopupSwitchMenuItem(_("Pin this application's position and size"), false);
            this.appRule = new PopupMenu.PopupSwitchMenuItem(_("Always float this application"), false);
            for (const item of [this.toggle, new PopupMenu.PopupSeparatorMenuItem(),
                this.floating, new PopupMenu.PopupSeparatorMenuItem(), this.pinRule, this.appRule]) this.button.menu.addMenuItem(item);
            this.signals.add(this.button.menu, 'open-state-changed', (_menu, open) => {
                // Keep the opening target through menu close: native activation
                // may close the popup before our activate handler runs.
                if (open) this.targetId = adapter.focusedId();
                this.update();
            });
            this.signals.add(this.toggle, 'toggled', (_item, enabled) => {
                if (!this.updating) this.setEnabled(enabled);
            });
            this.signals.add(this.floating, 'activate', () => {
                const id = this.targetId ?? this.adapter.focusedId();
                if (id !== null) this.controller.toggleWindow(id);
            });
            this.signals.add(this.pinRule, 'toggled', () => {
                if (!this.updating) controller.togglePin(this.targetId ?? adapter.focusedId());
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

    conflictRow(text) {
        const row = new PopupMenu.PopupMenuItem(text, {reactive: false, can_focus: false});
        // St.Label otherwise ellipsizes even when wrapping is enabled.
        row.label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        row.label.clutter_text.line_wrap = true;
        row.label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        row.label.style = 'max-width: 24em;';
        return row;
    }

    updateConflictList(blocked) {
        const conflicts = blocked ? this.conflictNotice.conflicts : [];
        const signature = JSON.stringify(conflicts);
        if (signature !== this.conflictSignature) {
            this.conflictList.removeAll();
            this.conflictRows = conflicts.map(({name, uuid}) => this.conflictRow(`${name}\n${uuid}`));
            for (const row of this.conflictRows) this.conflictList.addMenuItem(row);
            this.conflictSignature = signature;
        }
        this.conflictList.actor.visible = conflicts.length > 0;
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
        const visible = !this.settings.get_boolean('hide-panel-icon');
        if (!visible && this.button.menu.isOpen) this.button.menu.close();
        this.button.visible = visible;
        this.button.container.visible = visible;
        const enabled = this.settings.get_boolean('tiling-enabled');
        const active = enabled && this.controller.running && !this.controller.suspended;
        const data = this.data();
        this.updating = true;
        try {
            const status = this.controller.suspended ? _("Tiling paused") :
                active ? _("Automatic tiling enabled") : _("Automatic tiling disabled");
            this.button.accessible_name = `Trait JustTiling: ${status}`;
            this.icon.opacity = active ? 255 : 128;
            const blocked = enabled && this.conflictNotice.conflicts.length > 0;
            const resolved = enabled && this.conflictNotice.resolved && this.controller.suspended;
            this.conflict.visible = Boolean(blocked || resolved);
            this.conflictSeparator.visible = this.conflict.visible;
            this.manager.visible = Boolean(blocked);
            this.resume.visible = Boolean(resolved);
            this.updateConflictList(blocked);
            this.conflict.label.text = blocked ? _("Conflicting extensions") :
                resolved ? _("Conflicts resolved. Resume automatic tiling when you are ready.") : '';
            this.toggle.setToggleState(active);
            this.floating.setSensitive(active && data?.ready && !exclusion(data));
            const valid = Boolean(this.canSetRule(data));
            const pinned = Boolean(data && learningMatch(data, this.controller.pinnedLayouts));
            this.pinRule.setSensitive(active && valid && (pinned || this.controller.records.get(this.target())?.state === 'tiled'));
            this.pinRule.setToggleState(pinned);
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
        this.conflictRows = [];
        this.conflictList = null;
        this.controller = null;
        this.conflictNotice = null;
        this.adapter = null;
        this.settings = null;
        this.setEnabled = null;
    }
}
