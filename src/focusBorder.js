// SPDX-License-Identifier: GPL-3.0-or-later
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Connections} from './resources.js';
import {cornerRadius} from './cornerGeometry.js';
import {focusBorderEligible} from './rules.js';

// Child of the native window actor: follows its transforms and stacking, never a chrome overlay.
export class FocusBorder {
    constructor(adapter, settings) {
        this.adapter = adapter;
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

    clearWidget() {
        const widget = this.widget;
        this.widget = null;
        widget?.destroy();
    }

    clear() {
        this.targetSignals.clear();
        this.actor = null;
        this.clearWidget();
    }

    watchActor(actor) {
        if (this.actor === actor) return;
        this.clear();
        this.actor = actor;
        this.targetSignals.add(actor, 'destroy', () => {
            // Native parent owns child destruction; do not touch a dying actor.
            this.targetSignals.clear();
            this.actor = null; this.widget = null;
        });
        // Focus can arrive before mapping/first paint, or while the opening
        // animation has a zero child scale. Keep observing even without a widget.
        for (const signal of ['notify::child-transform', 'notify::mapped',
            'notify::allocation', 'first-frame'])
            this.targetSignals.add(actor, signal, () => this.sync());
        this.targetSignals.add(actor, 'child-added', (_actor, child) => {
            if (child !== this.widget) this.sync();
        });
    }

    sync() {
        try {
            if (!this.settings.get_boolean('focus-border') || Main.overview.visible ||
                Main.sessionMode.isLocked || !Main.sessionMode.hasWindows) {
                this.clear(); return;
            }
            const visual = this.adapter.focusBorderData();
            if (!visual?.actor) { this.clear(); return; }
            const {actor, frame, buffer} = visual;
            this.watchActor(actor);
            if (!focusBorderEligible(visual)) { this.clearWidget(); return; }
            if (![frame.x, frame.y, frame.width, frame.height, buffer.x, buffer.y].every(Number.isFinite) ||
                frame.width <= 0 || frame.height <= 0) { this.clearWidget(); return; }
            const transform = actor.get_child_transform();
            const scaleX = transform.get_value(0, 0), scaleY = transform.get_value(1, 1);
            if (![scaleX, scaleY].every(value => Number.isFinite(value) && value > 0)) {
                this.clearWidget(); return;
            }
            const style = `border: ${this.settings.get_int('focus-border-width')}px solid -st-accent-color; border-radius: ${cornerRadius(this.settings.get_int('corner-radius'))}px; background-color: transparent;`;
            if (!this.widget) {
                this.widget = new St.Widget({name: 'justtiling-focus-border', reactive: false,
                    can_focus: false, track_hover: false,
                    style});
                actor.add_child(this.widget);
            }
            if (this.widget.style !== style) this.widget.style = style;
            // Buffer may contain shadows outside the frame. Draw inward, without consuming gaps.
            // Mutter scales the actor's children for some client/monitor configurations.
            this.widget.set_scale(1 / scaleX, 1 / scaleY);
            this.widget.set_position((frame.x - buffer.x) / scaleX, (frame.y - buffer.y) / scaleY);
            this.widget.set_size(frame.width, frame.height);
            // A client surface can be attached after early focus. Keep the
            // decoration above native surface children within this window only.
            actor.set_child_above_sibling(this.widget, null);
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
