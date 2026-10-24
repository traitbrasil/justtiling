// Test-only notification double; never contacts the desktop message tray.
import {Signals} from './ui.js';
export const notifications = new Set();
export const created = [];
export const source = {addNotification(notification) { notifications.add(notification); }};
export function getSystemSource() { return source; }
export class Notification extends Signals {
    constructor(params) {
        super(); Object.assign(this, params); this.actions = []; created.push(this);
    }
    addAction(label, callback) {
        const action = {label, activate: callback}; this.actions.push(action); return action;
    }
    clearActions() { this.actions = []; }
    destroy() {
        notifications.delete(this); this.emit('destroy'); this.handlers.clear(); this.clearActions();
    }
}
