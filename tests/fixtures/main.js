// Test-only Shell double. This file is never included in the extension ZIP.
export const layoutManager = {
    next: 0, handlers: new Map(),
    connect(name, fn) { const id = ++this.next; this.handlers.set(id, {name, fn}); return id; },
    disconnect(id) { this.handlers.delete(id); },
    emit(name, ...args) {
        for (const h of [...this.handlers.values()]) if (h.name === name) h.fn(this, ...args);
    },
};
export const extensionManager = {
    ...layoutManager, handlers: new Map(), extensions: new Map(),
    getUuids() { return [...this.extensions.keys()]; },
    lookup(id) { return this.extensions.get(id); },
};
export const overview = {...layoutManager, handlers: new Map(), visible: false};
export const sessionMode = {...layoutManager, handlers: new Map(), isLocked: false, hasWindows: true};
export const notices = [];
export function notify(title, message) { notices.push({title, message}); }
export const panel = {
    indicators: new Map(),
    addToStatusArea(uuid, button) {
        if (this.fail) throw new Error('Simulated panel attachment failure');
        if (this.indicators.has(uuid)) throw new Error('Duplicate panel indicator');
        this.indicators.set(uuid, button);
        button.connect('destroy', () => this.indicators.delete(uuid));
    },
};
export const wm = {
    bindings: new Map(),
    addKeybinding(name, settings, flags, modes, handler) {
        this.bindings.set(name, {settings, flags, modes, handler});
        return this.bindings.size + 100;
    },
    removeKeybinding(name) { return this.bindings.delete(name); },
    press(name) { this.bindings.get(name)?.handler(); },
};

export let actionMode = 1;
export let modalCount = 0;
export const uiGroup = {set_child_above_sibling(child, sibling) { if (!this.children.has(child) || !this.children.has(sibling)) throw Error('Missing UI child'); }, children: new Set(), add_child(child) { child.parent = this; this.children.add(child); }};
export let failGrab = false;
export function setFailGrab(value) { failGrab = value; }
export function pushModal(actor, params) {
    modalCount++; actionMode = params.actionMode;
    return {is_revoked: () => failGrab, connect: () => 1, disconnect() {}};
}
export function popModal() { modalCount--; actionMode = 1; }
