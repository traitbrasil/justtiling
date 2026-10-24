// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {_} from './i18n.js';
import {dragMoved, insideBar, layoutBarGeometry, layoutHit, presetFrame} from './layout/presets.js';

// Non-reactive chrome: native dragging keeps ownership of pointer and keyboard.
// SwapPreview owns the shared polling timer; this class never schedules work.
export class LayoutBar {
    constructor(adapter, controller) {
        this.adapter = adapter;
        this.controller = controller;
        this.panel = null;
        this.preview = null;
        this.signature = null;
        this.tiles = new Map();
    }
    clear() {
        this.controller.assistantVisible = false;
        this.controller.assistantReady = false;
        this.panel?.destroy(); this.preview?.destroy();
        this.panel = null; this.preview = null; this.signature = null;
        this.tiles.clear();
    }
    sync(point) {
        const context = this.controller.drag;
        if (!this.controller.layoutAssistant || !context || !this.controller.validLayoutContext(context) ||
            !dragMoved(context, this.adapter.read(context.id)?.rect)) { this.clear(); return false; }
        const geometry = layoutBarGeometry(context.area);
        if (!geometry) { this.clear(); return false; }
        const signature = JSON.stringify(geometry.frame);
        if (signature !== this.signature) {
            this.clear();
            const {frame} = geometry;
            this.panel = new St.Widget({name: 'justtiling-layout-bar', reactive: false, can_focus: false,
                style: 'background-color: rgba(30,30,30,0.96); border: 1px solid rgba(255,255,255,0.25); border-radius: 14px;'});
            this.panel.set_position(frame.x, frame.y); this.panel.set_size(frame.width, frame.height);
            const label = new St.Label({text: _("Drop on a region to pin"), reactive: false,
                style: 'font-size: 11px; color: white;'});
            label.set_position(12, 9); label.set_size(frame.width - 24, 20);
            this.panel.add_child(label);
            for (const zone of geometry.zones) {
                const tile = new St.Widget({reactive: false, can_focus: false});
                tile.set_position(zone.hit.x - frame.x, zone.hit.y - frame.y);
                tile.set_size(zone.hit.width, zone.hit.height);
                this.panel.add_child(tile); this.tiles.set(zone.id, tile);
            }
            Main.uiGroup.add_child(this.panel);
            this.controller.assistantReady = true;
            if (typeof this.panel.ease === 'function') {
                this.controller.assistantReady = false;
                const panel = this.panel;
                this.panel.translation_y = -frame.height;
                this.panel.ease({translation_y: 0, duration: 160, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => { if (this.panel === panel && this.controller.drag === context) this.controller.assistantReady = true; }});
            }
            this.signature = signature;
        }
        this.controller.assistantVisible = true;
        const hovered = layoutHit(point, geometry);
        const plan = hovered && this.controller.assistantReady ? this.controller.presetPlan(hovered.region) : null;
        for (const zone of geometry.zones) {
            const fits = this.controller.presetFits(zone.region);
            const active = hovered?.id === zone.id && plan;
            const tile = this.tiles.get(zone.id);
            tile.opacity = fits && (hovered?.id !== zone.id || plan) ? 255 : 65;
            tile.style = active ? 'background-color: -st-accent-color; border: 1px solid white; border-radius: 4px;' :
                'background-color: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.35); border-radius: 4px;';
        }
        if (plan) {
            const rect = presetFrame(hovered.region, context.area, context.gaps);
            if (!this.preview) {
                this.preview = new St.Widget({name: 'justtiling-layout-preview', reactive: false, can_focus: false,
                    opacity: 65, style: 'background-color: -st-accent-color; border: 3px solid -st-accent-color; border-radius: 8px;'});
                Main.uiGroup.add_child(this.preview);
                // Keep the palette above its large, non-reactive destination preview.
                Main.uiGroup.set_child_above_sibling(this.panel, this.preview);
            }
            this.preview.set_position(rect.x, rect.y); this.preview.set_size(rect.width, rect.height);
        } else { this.preview?.destroy(); this.preview = null; }
        return insideBar(point, geometry);
    }
    destroy() { this.clear(); }
}
