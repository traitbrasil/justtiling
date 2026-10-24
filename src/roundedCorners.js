// SPDX-License-Identifier: GPL-3.0-or-later
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Connections} from './resources.js';
import {focusBorderEligible} from './rules.js';
import {cornerGeometry} from './cornerGeometry.js';
import {CornerEffect} from './cornerEffect.js';

// Only our effect is owned here: never replace a native clip or another effect.
export class RoundedCorners {
    constructor(adapter, settings) {
        this.adapter = adapter;
        this.settings = settings;
        this.windows = new Map();
        this.deadActors = new WeakSet();
        this.signals = new Connections();
        this.destroyed = false;
        this.signals.add(Main.sessionMode, 'updated', () => this.sync());
        for (const name of ['showing', 'hidden'])
            this.signals.add(Main.overview, name, () => this.sync());
    }

    remove(id, dying = false) {
        const entry = this.windows.get(id);
        if (!entry) return;
        this.windows.delete(id);
        entry.signals.clear();
        if (!dying && entry.effect) entry.actor.remove_effect(entry.effect);
        entry.effect = null;
    }

    clear() {
        for (const id of [...this.windows.keys()]) this.remove(id);
    }

    syncWindow(id) {
        if (this.destroyed) return;
        if (!this.settings.get_boolean('round-window-corners') || this.settings.get_int('corner-radius') === 0 ||
            Main.sessionMode.isLocked ||
            !Main.sessionMode.hasWindows) { this.remove(id); return; }
        let entry = this.windows.get(id);
        if (entry?.syncing) return;
        try {
            const visual = this.adapter.decorationData(id);
            if (!visual?.actor || this.deadActors.has(visual.actor) || !visual.appWindow || visual.overrideRedirect) { this.remove(id); return; }
            if (entry?.actor !== visual.actor) {
                this.remove(id);
                entry = {actor: visual.actor, effect: null, signals: new Connections(), syncing: false};
                this.windows.set(id, entry);
                entry.signals.add(entry.actor, 'destroy', () => {
                    this.deadActors.add(entry.actor);
                    this.remove(id, true);
                });
                for (const name of ['first-frame', 'notify::allocation', 'notify::mapped',
                    'notify::child-transform', 'resource-scale-changed', 'child-added'])
                    entry.signals.add(entry.actor, name, () => this.syncWindow(id));
            }
            entry.syncing = true;
            const geometry = cornerGeometry({...visual, width: visual.actor.width, height: visual.actor.height},
                this.settings.get_int('corner-radius'));
            // Include inactive workspaces and floating windows; focus and tiling are irrelevant.
            const eligible = focusBorderEligible({...visual, inScope: true});
            if (!eligible || !geometry) {
                if (entry.effect) entry.actor.remove_effect(entry.effect);
                entry.effect = null;
                entry.geometrySignature = null;
                return;
            }
            geometry.focusBorderWidth = this.settings.get_boolean('focus-border') && !Main.overview.visible && this.adapter.focusedId() === id ?
                this.settings.get_int('focus-border-width') * geometry.scale : 0;
            const signature = JSON.stringify(geometry);
            if (entry.effect && entry.geometrySignature === signature) return;
            if (!entry.effect) {
                entry.effect = new CornerEffect();
                entry.effect.update(geometry);
                entry.actor.add_effect_with_name('justtiling-rounded-corners', entry.effect);
            } else entry.effect.update(geometry);
            entry.geometrySignature = signature;
        } catch (error) {
            this.remove(id);
            this.adapter.log('warn', `Rounded corners: ${error}`);
        } finally {
            if (entry) entry.syncing = false;
        }
    }

    sync() {
        if (this.destroyed) return;
        if (!this.settings.get_boolean('round-window-corners') || this.settings.get_int('corner-radius') === 0 ||
            Main.sessionMode.isLocked ||
            !Main.sessionMode.hasWindows) { this.clear(); return; }
        const ids = new Set(this.adapter.list());
        for (const id of [...this.windows.keys()]) if (!ids.has(id)) this.remove(id);
        for (const id of ids) this.syncWindow(id);
    }

    destroy() {
        this.destroyed = true;
        this.signals.clear();
        this.clear();
    }
}
