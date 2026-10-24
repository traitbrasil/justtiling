// SPDX-License-Identifier: GPL-3.0-or-later
import {N_, format} from './strings.js';
// No GI dependency: backend owns native shortcut registration and read-only discovery.
export function canonicalAccelerator(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const aliases = {primary: 'ctrl', control: 'ctrl', ctrl: 'ctrl', mod1: 'alt', mod4: 'super'};
    const modifiers = [...value.matchAll(/<([^>]+)>/g)]
        .map(m => aliases[m[1].toLowerCase()] ?? m[1].toLowerCase());
    const key = value.replace(/<[^>]+>/g, '').trim().toLowerCase();
    if (!key || /[<>\s]/.test(key)) return null;
    return [...new Set(modifiers)].sort().concat(key).join('+');
}

export function canOverride(action, value) {
    return ['swap-left', 'swap-right', 'swap-up', 'swap-down'].includes(action) &&
        ['left', 'right', 'up', 'down'].some(key =>
            canonicalAccelerator(value) === canonicalAccelerator(`<Super>${key}`));
}

export const SHORTCUT_TITLES = {
    'toggle-tiling': N_("Toggle automatic tiling"),
    'swap-select': N_("Swap with a numbered window"),
    'cycle-focus': N_("Cycle focus through tiled windows"),
    'toggle-pin': N_("Pin or unpin the active application"),
    'toggle-floating': N_("Toggle the window between tiled and floating"),
    'swap-left': N_("Swap with the window on the left"), 'swap-right': N_("Swap with the window on the right"),
    'swap-up': N_("Swap with the window above"), 'swap-down': N_("Swap with the window below"),
};

export class Keybindings {
    constructor(backend, settings, actions, overrides = null) {
        this.backend = backend;
        this.settings = settings;
        this.actions = actions;
        this.overrides = overrides;
        this.refreshing = false;
        this.disposed = false;
        this.overrideFailures = new Map();
        this.active = new Set();
        this.warnings = new Map();
    }

    refresh() {
        if (this.disposed) return;
        if (this.refreshing) { this.again = true; return; }
        this.refreshing = true;
        try { this.refreshBindings(); }
        finally {
            this.refreshing = false;
            if (this.again) {
                this.again = false;
                Promise.resolve().then(() => this.refresh()).catch(e => this.backend.log('warn', `Shortcut refresh: ${e}`));
            }
        }
    }

    refreshBindings() {
        this.clear();
        const wanted = new Set(), used = new Set();
        for (const name of Object.keys(this.actions)) {
            if (this.backend.shortcutEnabled?.(name) === false) { this.overrideFailures.delete(name); continue; }
            const values = this.settings.get_strv(name);
            const canonical = values.map(canonicalAccelerator);
            if (canonical.some(key => key === null || used.has(key))) continue;
            for (const value of values) {
                if (this.overrideFailures.get(name) === JSON.stringify(values)) continue;
                if (canOverride(name, value)) wanted.add(canonicalAccelerator(value));
            }
            canonical.forEach(key => used.add(key));
        }
        this.overrides?.sync(wanted);
        const translate = message => this.backend.translate?.(message) ?? message;
        const occupied = new Map();
        for (const {schema, key, accelerators} of this.backend.shortcutSources()) {
            for (const value of accelerators) {
                const canonical = canonicalAccelerator(value);
                if (canonical) occupied.set(canonical, `${schema}:${key}`);
            }
        }
        for (const [name, callback] of Object.entries(this.actions)) {
            if (this.backend.shortcutEnabled?.(name) === false) continue;
            const values = this.settings.get_strv(name).filter(v => v.trim());
            if (!values.length) { this.warnings.delete(name); continue; }
            const keys = values.map(canonicalAccelerator);
            const conflict = keys.find(k => k && occupied.has(k));
            let warning = keys.includes(null) ? translate(N_("invalid shortcut")) :
                conflict ? format(translate(N_("conflicts with %s")), occupied.get(conflict)) : null;
            if (!warning) {
                const added = this.backend.bindShortcut(name, this.settings, () => {
                    try { callback(); }
                    catch (e) { this.backend.log('error', `Shortcut ${name}: ${e.stack ?? e}`); }
                });
                if (added) {
                    this.active.add(name);
                    this.overrideFailures.delete(name);
                    for (const key of keys) occupied.set(key, name);
                } else {
                    warning = translate(N_("the compositor refused the shortcut"));
                    if (this.overrides && values.some(v => canOverride(name, v)))
                        this.overrideFailures.set(name, JSON.stringify(values));
                }
            }
            if (warning && this.warnings.get(name) !== warning) {
                this.backend.notice(format(translate(N_("Shortcut %s unavailable: %s. Choose another shortcut in Preferences.")), translate(SHORTCUT_TITLES[name] ?? name), warning));
                this.backend.log('warn', `${name}: ${warning}`);
            }
            if (warning) this.warnings.set(name, warning);
            else this.warnings.delete(name);
        }
        const accepted = new Set();
        for (const name of this.active) {
            for (const value of this.settings.get_strv(name)) {
                if (canOverride(name, value)) accepted.add(canonicalAccelerator(value));
            }
        }
        this.overrides?.sync(accepted);
    }

    clear() {
        for (const name of this.active) {
            try { this.backend.unbindShortcut(name); }
            catch (e) { this.backend.log('warn', `Remove shortcut ${name}: ${e}`); }
        }
        this.active.clear();
    }

    dispose() { this.disposed = true; this.clear(); this.overrides?.restore(); this.warnings.clear(); }
}
