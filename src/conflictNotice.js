// SPDX-License-Identifier: GPL-3.0-or-later
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {_} from './i18n.js';
import {format} from './strings.js';

export class ConflictNotice {
    constructor(adapter, onResume) {
        this.adapter = adapter;
        this.onResume = onResume;
        this.conflicts = [];
        this.resolved = false;
        this.signature = null;
        this.notification = null;
        this.destroyId = null;
        this.destroyed = false;
    }

    message() {
        return format(_("%s\nDisable these extensions in the Extension Manager, then resume automatic tiling."),
            this.conflicts.map(({name}) => name).join(', '));
    }

    update(conflicts) {
        if (this.destroyed) return;
        const signature = JSON.stringify(conflicts);
        if (signature === this.signature) return;
        if (!conflicts.length && !this.conflicts.length) return;
        this.signature = signature;
        this.conflicts = conflicts;
        this.resolved = conflicts.length === 0;
        this.clearNotification();
        const source = MessageTray.getSystemSource();
        const notification = new MessageTray.Notification({source,
            title: this.resolved ? _("Trait JustTiling: conflicts resolved") : _("Trait JustTiling: tiling paused"),
            body: this.resolved ? _("Conflicting extensions are no longer active. Resume automatic tiling when you are ready.") : this.message(),
            useBodyMarkup: false, resident: true, isTransient: false});
        this.notification = notification;
        this.destroyId = notification.connect('destroy', () => {
            notification.clearActions();
            this.notification = null;
            this.destroyId = null;
        });
        notification.addAction(this.resolved ? _("Resume automatic tiling") : _("Open Extension Manager"),
            this.resolved ? () => this.resume() : () => this.openManager());
        source.addNotification(notification);
    }

    openManager() {
        if (this.destroyed) return;
        try {
            const system = Shell.AppSystem.get_default();
            const app = system.lookup_app('org.gnome.Extensions.desktop') ??
                system.lookup_app('com.mattjakeman.ExtensionManager.desktop');
            if (app) app.activate();
            else Main.notify('Trait JustTiling', _("No extension manager was found. Install GNOME Extensions to manage conflicting extensions."));
        } catch (error) {
            this.adapter.log('warn', `Open Extension Manager: ${error}`);
            Main.notify('Trait JustTiling', _("Could not open the Extension Manager. Open it from your applications menu."));
        }
    }

    resume() {
        if (!this.destroyed && this.resolved) this.onResume();
    }

    clearNotification() {
        const notification = this.notification;
        if (!notification) return;
        this.notification = null;
        notification.clearActions();
        notification.disconnect(this.destroyId);
        this.destroyId = null;
        notification.destroy();
    }

    clear() {
        this.clearNotification();
        this.signature = null;
        this.conflicts = [];
        this.resolved = false;
    }

    destroy() {
        this.clear();
        this.destroyed = true;
        this.adapter = null;
        this.onResume = null;
    }
}
