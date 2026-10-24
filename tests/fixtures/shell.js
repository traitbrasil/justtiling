// SPDX-License-Identifier: GPL-3.0-or-later
const handlers = new Map(); let next = 0;
export const tracker = {
    connect(name, fn) { const id = ++next; handlers.set(id, {name, fn}); return id; },
    disconnect(id) { handlers.delete(id); },
    emit() { for (const {fn} of [...handlers.values()]) fn(this); },
    get_window_app(win) { return win.app ?? null; },
};
export default {ActionMode: {NORMAL: 1}, WindowTracker: {get_default: () => tracker}};
