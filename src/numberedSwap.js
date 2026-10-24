// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Connections} from './resources.js';
import {NumberChoice} from './numberChoice.js';

export class NumberedSwap {
    constructor(adapter, controller) {
        this.adapter = adapter;
        this.controller = controller;
        this.signals = new Connections();
        this.overlays = [];
        this.context = null;
        this.timer = null;
        this.grab = null;
        this.actor = null;
        try {
            for (const signal of ['showing', 'hidden'])
                this.signals.add(Main.overview, signal, () => this.sync());
            this.signals.add(Main.sessionMode, 'updated', () => this.sync());
            this.signals.add(Main.layoutManager, 'system-modal-opened', () => this.cancel());
        } catch (error) { this.destroy(); throw error; }
    }

    toggle() {
        if (this.context) { this.cancel(); return; }
        if (Main.actionMode !== Shell.ActionMode.NORMAL || Main.modalCount ||
            Main.overview.visible || Main.sessionMode.isLocked || !Main.sessionMode.hasWindows) return;
        const context = this.controller.numberedSwapContext();
        if (!context) return;
        this.context = context;
        this.choice = new NumberChoice(context.targets.length);
        this.held = new Set();
        try {
            this.actor = new St.Widget({name: 'justtiling-number-input', reactive: true, can_focus: true,
                width: global.stage.width, height: global.stage.height});
            Main.uiGroup.add_child(this.actor);
            this.actor.connect('key-press-event', (_actor, event) => this.key(event));
            this.actor.connect('key-release-event', (_actor, event) => {
                this.held.delete(event.get_key_code()); return Clutter.EVENT_STOP;
            });
            this.actor.connect('button-press-event', () => { this.cancel(); return Clutter.EVENT_STOP; });
            this.grab = Main.pushModal(this.actor, {actionMode: Shell.ActionMode.POPUP});
            if (!this.grab || this.grab.is_revoked()) { this.cancel(); return; }
            this.grabSignal = this.grab.connect('notify::revoked', () => {
                if (this.grab?.is_revoked()) this.cancel();
            });
            for (const [index, id] of context.targets.entries()) {
                const visual = this.adapter.windowVisual(id);
                if (!visual?.actor) { this.cancel(); return; }
                const background = new St.Widget({reactive: false, opacity: 80,
                    style: 'background-color: -st-accent-color; border: 2px solid -st-accent-color; border-radius: 8px;',
                    x_expand: true, y_expand: true});
                const label = new St.Label({text: String(index + 1), reactive: false,
                    x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
                    style: 'font-size: 32px; font-weight: bold; color: white; background-color: rgba(0,0,0,0.75); border-radius: 12px; padding: 8px 18px;'});
                const widget = new St.Widget({name: 'justtiling-numbered-swap', reactive: false,
                    layout_manager: new Clutter.BinLayout()});
                widget.add_child(background); widget.add_child(label);
                const entry = {id, actor: visual.actor, widget};
                this.overlays.push(entry);
                visual.actor.add_child(widget);
                entry.destroyId = visual.actor.connect('destroy', () => this.cancel());
                entry.transformId = visual.actor.connect('notify::child-transform', () => this.sync());
            }
            this.sync();
        } catch (error) {
            this.cancel();
            this.adapter.log('warn', `Numbered swap: ${error}`);
        }
    }

    key(event) {
        const code = event.get_key_code(), symbol = event.get_key_symbol();
        if (this.held.has(code)) return Clutter.EVENT_STOP;
        this.held.add(code);
        if (symbol === Clutter.KEY_Escape) this.cancel();
        else if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter)
            this.select(Number(this.choice.prefix));
        else if (symbol === Clutter.KEY_BackSpace) { this.stopTimer(); this.choice.prefix = ''; }
        else {
            const modifiers = event.get_state() & (Clutter.ModifierType.CONTROL_MASK |
                Clutter.ModifierType.MOD1_MASK | Clutter.ModifierType.SUPER_MASK);
            if (modifiers) return Clutter.EVENT_STOP;
            const digit = symbol >= Clutter.KEY_0 && symbol <= Clutter.KEY_9 ? symbol - Clutter.KEY_0 :
                symbol >= Clutter.KEY_KP_0 && symbol <= Clutter.KEY_KP_9 ? symbol - Clutter.KEY_KP_0 : null;
            if (digit !== null) {
                this.stopTimer();
                const result = this.choice.digit(String(digit));
                if (result.wait) this.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 650, () => {
                    this.timer = null; this.select(result.number); return GLib.SOURCE_REMOVE;
                });
                else if (result.number !== null) this.select(result.number);
            }
        }
        return Clutter.EVENT_STOP;
    }

    select(number) {
        const context = this.context;
        if (!Number.isInteger(number) || number < 1 || number > context?.targets.length) return;
        this.cancel();
        this.controller.selectNumberedSwap(context, number);
    }

    sync() {
        if (!this.context) return;
        try {
            if (Main.overview.visible || Main.sessionMode.isLocked || !Main.sessionMode.hasWindows ||
                !this.controller.validNumberedSwap(this.context)) { this.cancel(); return; }
            for (const entry of this.overlays) {
                const visual = this.adapter.windowVisual(entry.id);
                if (visual?.actor !== entry.actor) { this.cancel(); return; }
                const {frame, buffer, actor} = visual;
                const matrix = actor.get_child_transform();
                const x = matrix.get_value(0, 0), y = matrix.get_value(1, 1);
                if (![x, y, frame.width, frame.height].every(v => Number.isFinite(v) && v > 0)) {
                    this.cancel(); return;
                }
                entry.widget.set_scale(1 / x, 1 / y);
                entry.widget.set_position((frame.x - buffer.x) / x, (frame.y - buffer.y) / y);
                entry.widget.set_size(frame.width, frame.height);
            }
        } catch (error) { this.cancel(); this.adapter.log('warn', `Numbered swap update: ${error}`); }
    }

    stopTimer() {
        if (this.timer !== null) GLib.source_remove(this.timer);
        this.timer = null;
    }

    cancel() {
        this.context = null;
        this.stopTimer();
        const overlays = this.overlays; this.overlays = [];
        for (const {actor, widget, destroyId, transformId} of overlays) {
            if (destroyId) actor.disconnect(destroyId);
            if (transformId) actor.disconnect(transformId);
            widget.destroy();
        }
        if (this.grab) {
            const grab = this.grab; this.grab = null;
            if (this.grabSignal) grab.disconnect(this.grabSignal);
            this.grabSignal = null;
            Main.popModal(grab);
        }
        this.actor?.destroy(); this.actor = null;
    }

    destroy() { this.cancel(); this.signals.clear(); }
}
