// SPDX-License-Identifier: GPL-3.0-or-later
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Connections} from './resources.js';

// Child of the native window actor: follows its transforms and stacking, never a chrome overlay.
export class FocusBorder {
    constructor(adapter, controller, settings) {
        this.adapter = adapter;
        this.controller = controller;
        this.settings = settings;
        this.signals = new Connections();
        this.targetSignals = new Connections();
        this.actor = null;
        this.widget = null;
        this.warned = false;
        try {
            for (const name of ['showing', 'hidden'])
                this.signals.add(Main.overview, name, () => this.sync());
            this.signals.add(Main.sessionMode, 'updated', () => this.sync());
        } catch (error) {
            this.destroy();
            throw error;
        }
    }

    clear() {
        this.targetSignals.clear();
        const widget = this.widget;
        this.widget = null;
        this.actor = null;
        widget?.destroy();
    }

    sync() {
        try {
            if (!this.settings.get_boolean('focus-border') || !this.controller.running ||
                this.controller.suspended || Main.overview.visible || Main.sessionMode.isLocked ||
                !Main.sessionMode.hasWindows || this.adapter.monitorCount() !== 1) {
                this.clear(); return;
            }
            this.adapter.activeWorkspace();
            const id = this.adapter.focusedId();
            const data = this.adapter.read(id);
            const record = this.controller.records.get(id);
            if (!data?.ready || !data.normal || data.transient || !data.inScope || data.minimized ||
                data.fullscreen || data.maximized || !['tiled', 'floating'].includes(record?.state)) {
                this.clear(); return;
            }
            const visual = this.adapter.focusedVisual();
            if (!visual?.actor) { this.clear(); return; }
            const {actor, frame, buffer} = visual;
            if (![frame.x, frame.y, frame.width, frame.height, buffer.x, buffer.y].every(Number.isFinite) ||
                frame.width <= 0 || frame.height <= 0) { this.clear(); return; }
            const transform = actor.get_child_transform();
            const scaleX = transform.get_value(0, 0), scaleY = transform.get_value(1, 1);
            if (![scaleX, scaleY].every(value => Number.isFinite(value) && value > 0)) {
                this.clear(); return;
            }
            if (this.actor !== actor || !this.widget) {
                this.clear();
                this.actor = actor;
                this.widget = new St.Widget({name: 'justtiling-focus-border', reactive: false,
                    can_focus: false, track_hover: false,
                    style: 'border: 3px solid -st-accent-color; border-radius: 8px; background-color: transparent;'});
                this.targetSignals.add(actor, 'destroy', () => {
                    // Native parent owns child destruction; do not touch a dying actor.
                    this.targetSignals.clear();
                    this.actor = null; this.widget = null;
                });
                this.targetSignals.add(actor, 'notify::child-transform', () => this.sync());
                actor.add_child(this.widget);
            }
            // Buffer may contain shadows outside the frame. Draw inward, without consuming gaps.
            // Mutter scales the actor's children for some client/monitor configurations.
            this.widget.set_scale(1 / scaleX, 1 / scaleY);
            this.widget.set_position((frame.x - buffer.x) / scaleX, (frame.y - buffer.y) / scaleY);
            this.widget.set_size(frame.width, frame.height);
            this.widget.show();
            this.warned = false;
        } catch (error) {
            this.clear();
            if (!this.warned) this.adapter.log('warn', `Focus border: ${error}`);
            this.warned = true;
        }
    }

    destroy() {
        this.signals.clear();
        this.clear();
    }
}
