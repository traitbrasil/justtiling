// SPDX-License-Identifier: GPL-3.0-or-later
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {LayoutBar} from './layoutBar.js';
import {Connections} from './resources.js';

// Observe the pointer only during a native tile drag. Never grab input or move
// windows: the same controller validation decides both preview and final drop.
export class SwapPreview {
    constructor(adapter, controller) {
        this.adapter = adapter;
        this.controller = controller;
        this.signals = new Connections();
        this.targetSignals = new Connections();
        this.timer = null;
        this.layoutBar = new LayoutBar(adapter, controller);
        this.widget = null;
        this.actor = null;
        this.destroyed = false;
        this.warned = false;
        try {
            for (const signal of ['showing', 'hidden'])
                this.signals.add(Main.overview, signal, () => this.sync());
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

    stopTimer() {
        if (this.timer !== null) GLib.source_remove(this.timer);
        this.timer = null;
    }

    sync() {
        if (this.destroyed) return;
        try {
            if (!this.controller.running || this.controller.suspended || !this.controller.drag ||
                (!this.controller.dragSwap && !this.controller.layoutAssistant) || Main.overview.visible || Main.sessionMode.isLocked ||
                !Main.sessionMode.hasWindows || this.adapter.monitorCount() !== 1) {
                this.stopTimer();
                this.clear();
                this.layoutBar.clear();
                return;
            }
            if (this.timer === null) {
                this.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                    this.timer = null;
                    this.sync();
                    return GLib.SOURCE_REMOVE;
                });
            }
            const point = this.adapter.pointer();
            if (this.layoutBar.sync(point)) { this.clear(); return; }
            const id = this.controller.previewDrag(point);
            const visual = id === null ? null : this.adapter.windowVisual(id);
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
                this.widget = new St.Widget({name: 'justtiling-swap-preview', reactive: false,
                    can_focus: false, track_hover: false, opacity: 80,
                    style: 'background-color: -st-accent-color; border: 2px solid -st-accent-color; border-radius: 8px;'});
                this.targetSignals.add(actor, 'destroy', () => {
                    this.targetSignals.clear();
                    this.actor = null;
                    this.widget = null;
                });
                this.targetSignals.add(actor, 'notify::child-transform', () => this.sync());
                actor.add_child(this.widget);
            }
            this.widget.set_scale(1 / scaleX, 1 / scaleY);
            this.widget.set_position((frame.x - buffer.x) / scaleX, (frame.y - buffer.y) / scaleY);
            this.widget.set_size(frame.width, frame.height);
            this.widget.show();
            this.warned = false;
        } catch (error) {
            this.stopTimer();
            this.clear();
            this.layoutBar.clear();
            if (!this.warned) this.adapter.log('warn', `Swap preview: ${error}`);
            this.warned = true;
        }
    }

    destroy() {
        this.destroyed = true;
        this.stopTimer();
        this.signals.clear();
        this.layoutBar.destroy();
        this.clear();
    }
}
