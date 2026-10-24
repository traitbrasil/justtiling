// SPDX-License-Identifier: GPL-3.0-or-later
export class Connections {
    constructor() { this.items = []; }
    add(object, signal, callback) {
        const id = object.connect(signal, callback);
        this.items.push([object, id]);
        return id;
    }
    clear() {
        for (const [object, id] of this.items.splice(0)) {
            try { object.disconnect(id); } catch (e) { console.warn(`[justtiling] disconnect: ${e}`); }
        }
    }
}
