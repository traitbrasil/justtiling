import {Signals} from './ui.js';
export class PopupMenuItem extends Signals {
    constructor(text = '', params = {}) {
        super(); this.label = {text, clutter_text: {line_wrap: false}}; this.sensitive = params.reactive !== false;
    }
    setSensitive(value) { this.sensitive = value; }
    destroy() { this.handlers.clear(); }
}
export class PopupSwitchMenuItem extends PopupMenuItem {
    constructor(text, state) { super(text); this.state = state; }
    setToggleState(value) {
        if (this.state === value) return;
        this.state = value;
        // Deliberately emit for programmatic changes to exercise feedback guards.
        this.emit('toggled', value);
    }
    toggle() { if (this.sensitive) this.setToggleState(!this.state); }
}
export class PopupSeparatorMenuItem extends PopupMenuItem {}
export class Menu extends Signals {
    constructor() { super(); this.isOpen = false; this.items = []; }
    addMenuItem(item) { this.items.push(item); }
    open() { this.isOpen = true; this.emit('open-state-changed', true); }
    close() { this.isOpen = false; this.emit('open-state-changed', false); }
    removeAll() { for (const item of this.items) item.destroy(); this.items = []; }
    destroy() { this.removeAll(); this.handlers.clear(); }
}

export class PopupMenuSection extends Menu {
    constructor() { super(); this.actor = {visible: true}; }
}
