import {Signals} from './ui.js';
class Icon {
    constructor(params) { Object.assign(this, params); this.opacity = 255; }
}
export const widgets = new Set();
class Widget extends Signals {
    constructor(params) { super(); Object.assign(this, params); widgets.add(this); }
    set_position(x, y) { this.x = x; this.y = y; }
    set_scale(x, y) { this.scale_x = x; this.scale_y = y; }
    set_size(width, height) { this.width = width; this.height = height; }
    show() { this.visible = true; }
    destroy() {
        this.parent?.children.delete(this);
        this.emit('destroy'); this.handlers.clear(); widgets.delete(this);
    }
}
export default {Icon, Widget};
