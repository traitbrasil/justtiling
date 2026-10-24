import {Signals} from './ui.js';
class Icon {
    constructor(params) { Object.assign(this, params); this.opacity = 255; }
}
export const widgets = new Set();
class Widget extends Signals {
    constructor(params) { super(); Object.assign(this, params); widgets.add(this); this.children = new Set(); }
    add_child(child) { child.parent = this; this.children.add(child); }
    set_position(x, y) { this.x = x; this.y = y; }
    set_scale(x, y) { this.scale_x = x; this.scale_y = y; }
    set_size(width, height) { this.width = width; this.height = height; }
    show() { this.visible = true; }
    destroy() {
        for (const child of [...this.children]) child.destroy();
        this.parent?.children.delete(this);
        this.emit('destroy'); this.handlers.clear(); widgets.delete(this);
    }
}
class Label extends Widget {}
export default {Icon, Widget, Label};
