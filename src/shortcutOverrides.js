// SPDX-License-Identifier: GPL-3.0-or-later
import {canonicalAccelerator} from './keybindings.js';

export const SYSTEM_SCHEMAS = ['org.gnome.desktop.wm.keybindings', 'org.gnome.shell.keybindings',
    'org.gnome.mutter.keybindings', 'org.gnome.mutter.wayland.keybindings'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');

// Journal is persisted in our schema BEFORE writing a system key. Restore only values still owned.
export class ShortcutOverrides {
    constructor(backend, settings) {
        this.backend = backend; this.settings = settings; this.blocked = new Set();
        const entries = JSON.parse(settings.get_string('system-shortcut-backup'));
        if (!Array.isArray(entries) || entries.some(e => !SYSTEM_SCHEMAS.includes(e.schema) ||
            typeof e.key !== 'string' || !strings(e.before) || !strings(e.after) ||
            !(e.userValue === null || strings(e.userValue)))) throw new Error('Invalid shortcut recovery journal');
        this.entries = entries;
    }
    save() {
        if (!this.settings.set_string('system-shortcut-backup', JSON.stringify(this.entries)))
            throw new Error('Could not save shortcut recovery journal');
        this.backend.flushShortcutJournal?.();
    }
    sync(wanted) {
        const sources = this.backend.shortcutSources();
        const keys = new Map(sources.map(s => [`${s.schema}:${s.key}`, s]));
        for (const e of this.entries) keys.set(`${e.schema}:${e.key}`, e);
        for (const [identity, source] of keys) {
            let entry = this.entries.find(e => `${e.schema}:${e.key}` === identity);
            const current = this.backend.readSystemShortcut(source.schema, source.key);
            if (!current) continue;
            if (entry && !same(current.values, entry.after)) {
                this.entries = this.entries.filter(e => e !== entry); this.save();
                this.blocked.add(identity); continue; // A later user edit owns this key now.
            }
            if (this.blocked.has(identity)) continue;
            const before = entry?.before ?? current.values;
            const after = before.filter(value => !wanted.has(canonicalAccelerator(value)));
            if (!entry && same(before, after)) continue;
            if (entry && same(entry.after, after)) continue;
            const oldEntries = [...this.entries];
            const previous = entry;
            if (same(before, after)) {
                // Keep journal until successful restoration, so a failed write is recoverable.
                if (!this.backend.writeSystemShortcut(source.schema, source.key, entry.userValue)) continue;
                this.entries = this.entries.filter(e => e !== entry); this.save();
                continue;
            }
            entry = {schema: source.schema, key: source.key, before, after,
                userValue: previous ? previous.userValue : current.userValue};
            this.entries = this.entries.filter(e => e !== previous);
            this.entries.push(entry); this.save();
            if (!same(current.values, after) && !this.backend.writeSystemShortcut(source.schema, source.key, after)) {
                this.entries = oldEntries; this.save();
            }
        }
    }
    restore() {
        for (const entry of [...this.entries]) {
            const current = this.backend.readSystemShortcut(entry.schema, entry.key);
            if (!current) continue;
            if (same(current.values, entry.after) &&
                !this.backend.writeSystemShortcut(entry.schema, entry.key, entry.userValue)) continue;
            this.entries = this.entries.filter(e => e !== entry); this.save();
        }
    }
}
