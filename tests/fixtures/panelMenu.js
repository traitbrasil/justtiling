import {Signals} from './ui.js';
import {Menu} from './popupMenu.js';
export class Button extends Signals {
    constructor() { super(); this.menu = new Menu(); this.children = []; }
    add_child(child) { this.children.push(child); }
    destroy() { this.emit('destroy'); this.menu.destroy(); this.handlers.clear(); }
}
