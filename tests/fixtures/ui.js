export class Signals {
    constructor() { this.next = 0; this.handlers = new Map(); }
    connect(name, fn) { const id = ++this.next; this.handlers.set(id, {name, fn}); return id; }
    disconnect(id) { this.handlers.delete(id); }
    emit(name, ...args) {
        for (const h of [...this.handlers.values()]) if (h.name === name) h.fn(this, ...args);
    }
}
