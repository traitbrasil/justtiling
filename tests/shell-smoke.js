// Isolated integration: real GLib, GSettings(memory), Meta typelib and Mtk;
// fake Shell globals/windows. NEVER import this into a real GNOME Shell.
import GLib from 'gi://GLib';
import Meta from 'gi://Meta?version=51';
import Gio from 'gi://Gio';

const root = ARGV[0];
const english = GLib.getenv('LANGUAGE') === 'en';
const {widgets: borderWidgets} = await import(`${root}/tests/fixtures/st.js`);
const packageFixture = await import(`${root}/tests/fixtures/packageLookup.js`);
const {tracker} = await import(`${root}/tests/fixtures/shell.js`);
const Main = await import(`${root}/tests/fixtures/main.js`);
const {default: JustTiling} = await import(`${root}/extension.js`);
function assert(value, message) { if (!value) throw new Error(message); }
function wait(ms) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve(); return GLib.SOURCE_REMOVE;
    }));
}
class Signals {
    constructor() { this.next = 0; this.handlers = new Map(); }
    connect(name, fn) { const id = ++this.next; this.handlers.set(id, {name, fn}); return id; }
    disconnect(id) { this.handlers.delete(id); }
    emit(name, ...args) {
        for (const h of [...this.handlers.values()]) if (h.name === name) h.fn(this, ...args);
    }
}
const workspace = {get_work_area_for_monitor: () => ({x: 0, y: 32, width: 1600, height: 900})};
const otherWorkspace = {get_work_area_for_monitor: () => ({x: 0, y: 32, width: 1600, height: 900})};
let activeWorkspace = workspace;
const workspaceList = [workspace, otherWorkspace];
const manager = new Signals();
Object.assign(manager, {get_active_workspace: () => activeWorkspace,
    get_n_workspaces: () => workspaceList.length, get_workspace_by_index: i => workspaceList[i]});
const display = new Signals();
let monitors = 1;
const windows = [];
Object.assign(display, {list_all_windows: () => windows,
    get_n_monitors: () => monitors, focus_window: null});
let pointer = {x: 0, y: 0}, pointerReads = 0;
globalThis.global = {stage: {width: 1600, height: 932}, display, workspace_manager: manager, get_current_time: () => 1234,
    get_pointer: () => { pointerReads++; return [pointer.x, pointer.y, 0]; }};

class WindowActor extends Signals {
    constructor() { super(); this.children = new Set(); this.childScale = 1; }
    get_child_transform() { return {get_value: () => this.childScale}; }
    add_child(child) { child.parent = this; this.children.add(child); }
    destroy() {
        this.emit('destroy');
        for (const child of [...this.children]) child.destroy();
        this.handlers.clear();
    }
}
class Window extends Signals {
    constructor(id, minimum = 0) {
        super();
        this.id = id; this.minimum = minimum;
        this.mapped = true; this.minimized = false; this.flags = 0;
        this.frame = {x: 50, y: 90, width: 700, height: 500};
        this.above = false; this.moves = 0;
        this.workspace = workspace;
        this.actor = new WindowActor();
    }
    activate(time) { this.activatedAt = time; display.focus_window = this; display.emit('notify::focus-window'); }
    get_pid() { return this.pid ?? 0; }
    get_stable_sequence() { return this.id; }
    get_frame_rect() { return this.frame; }
    get_min_size() { return [this.minimum > 0, this.minimum, 100]; }
    get_max_size() { return [false, 0, 0]; }
    client_rect_to_frame_rect(r) { return r; }
    get_buffer_rect() { return {...this.frame, x: this.frame.x - 10, y: this.frame.y - 15}; }
    get_compositor_private() { return this.actor; }
    get_wm_class() { return 'local.test.App'; }
    get_wm_class_instance() { return 'local.test.App'; }
    get_gtk_application_id() { return null; }
    get_sandboxed_app_id() { return null; }
    get_window_type() { return Meta.WindowType.NORMAL; }
    get_transient_for() { return null; }
    is_override_redirect() { return false; }
    is_skip_taskbar() { return false; }
    is_on_all_workspaces() { return false; }
    get_workspace() { return this.workspace; }
    get_monitor() { return 0; }
    is_fullscreen() { return false; }
    get_maximize_flags() { return this.flags; }
    allows_move() { return true; }
    allows_resize() { return this.flags !== Meta.MaximizeFlags.BOTH; }
    is_above() { return this.above; }
    unmaximize() { this.flags = 0; }
    set_maximize_flags(flags) { this.flags = flags; }
    make_above() { this.above = true; this.emit('notify::above'); }
    unmake_above() { this.above = false; this.emit('notify::above'); }
    move_resize_frame(userOp, x, y, width, height) {
        assert(userOp === false, 'Programmatic move must not be a user operation');
        this.moves++;
        this.frame = {x, y, width, height};
        this.emit('size-changed'); this.emit('position-changed');
    }
}

const nativeKeys = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.keybindings'});
nativeKeys.set_strv('unmaximize', ['<Super>Down', '<Alt>F5']);
const w1 = new Window(1);
windows.push(w1);
const migrationSettings = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.justtiling'});
migrationSettings.set_string('new-window-side', 'right');
assert(migrationSettings.get_boolean('preserve-focused-window'), 'Focus preservation defaults on');
migrationSettings.set_boolean('preserve-focused-window', false);
migrationSettings.set_strv('toggle-tiling', ['<Super><Control><Alt>t']);
migrationSettings.set_strv('toggle-floating', ['<Super><Control><Alt>f']);
let ext = new JustTiling();
ext.enable();
await wait(500);
assert(Main.wm.bindings.get('toggle-tiling').settings.get_strv('toggle-tiling')[0] === '<Super>t', 'Default tiling shortcut must be Super+T');
assert(Main.wm.bindings.get('toggle-floating').settings.get_strv('toggle-floating')[0] === '<Super>o', 'Default floating shortcut must be Super+O');
assert(Main.panel.indicators.size === 1, 'Panel menu must be attached');
assert(w1.frame.width === 1570, 'Adapter must tile first window');
const firstMoves = w1.moves;
const w2 = new Window(2, 3000);
windows.push(w2); display.emit('window-created', w2);
await wait(500);
assert(w2.above && w2.moves === 0, 'Rejected window must float without resizing');
assert(w1.moves === firstMoves, 'Preflight rejection must not reflow existing tile');
const w3 = new Window(3);
windows.push(w3); display.emit('window-created', w3);
await wait(500);
assert(w1.frame.width < 1570 && w3.frame.width < 1570, 'Creation signal must add a tile');
w3.emit('unmanaging'); windows.splice(windows.indexOf(w3), 1);
await wait(200);
assert(w3.handlers.size === 0, 'Destroyed window signals must be disconnected');
assert(w1.frame.width === 1570, 'Closing must recover space');
assert(Main.wm.bindings.size === 8, 'All eight keybindings should be registered');
assert(JSON.stringify(nativeKeys.get_strv('unmaximize')) === JSON.stringify(['<Alt>F5']),
    'Override must remove only conflicting arrow and preserve other accelerators');
ext.disable(); ext.disable();
assert(Main.panel.indicators.size === 0, 'Disable leaked panel menu');
assert(Main.wm.bindings.size === 0, 'Disable leaked keybindings');
assert(JSON.stringify(nativeKeys.get_strv('unmaximize')) === JSON.stringify(['<Super>Down', '<Alt>F5']),
    'Disable did not restore original native shortcut');
assert(w1.frame.width === 700 && w1.frame.x === 50, 'Disable must restore original geometry');
assert(!w2.above, 'Disable must restore floating layer');
assert(w1.handlers.size === 0 && w2.handlers.size === 0, 'Window signals leaked');
assert(display.handlers.size === 0 && manager.handlers.size === 0, 'Global signals leaked');
assert(Main.layoutManager.handlers.size === 0 && Main.extensionManager.handlers.size === 0, 'Shell signals leaked');
const moves = w1.moves;
await wait(500);
assert(w1.moves === moves, 'Callback moved window after disable');

for (const uuid of ['o-tiling@test', 'justtiling@dudu.local']) {
    Main.extensionManager.extensions.set(uuid, {state: 1});
    ext = new JustTiling();
    let rejected = false;
    try { ext.enable(); } catch (_) { rejected = true; }
    assert(rejected, 'Active competing or legacy tiler must block startup');
    ext.disable();
    Main.extensionManager.extensions.clear();
}
assert(display.handlers.size === 0, 'Partial-enable failure leaked observers');

ext = new JustTiling(); ext.enable(); await wait(500);
monitors = 2; Main.layoutManager.emit('monitors-changed'); await wait(200);
assert(w1.frame.width === 700, 'Second monitor must restore geometry');
assert(Main.notices.length === 1, 'Suspension must notify once');
monitors = 1; Main.layoutManager.emit('monitors-changed'); await wait(500);
assert(w1.frame.width === 700, 'Suspended controller must not auto-resume');
ext.disable();
assert(display.handlers.size === 0 && w1.handlers.size === 0, 'Final cleanup leaked observers');

// MVP integration: native settings notifications, shortcut callbacks and workspace signals.
const settings = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.justtiling'});
const w4 = new Window(4);
w4.workspace = otherWorkspace; windows.push(w4);
ext = new JustTiling(); ext.enable(); await wait(500);
const firstFrame = {...w1.frame};
const firstMovesBeforeSwitch = w1.moves;
activeWorkspace = otherWorkspace; manager.emit('active-workspace-changed'); await wait(500);
assert(w4.frame.width === 1570, 'New workspace must have its own layout');
assert(w1.moves === firstMovesBeforeSwitch && w1.frame.width === firstFrame.width,
    'Workspace switch must not restore/reflow the old workspace');
assert(!w2.above, 'Float in inactive workspace must release above layer');
activeWorkspace = workspace; manager.emit('active-workspace-changed'); await wait(500);
assert(w1.moves === firstMovesBeforeSwitch, 'Returning must preserve existing geometry');

settings.set_strv('floating-apps', ['wm-class:local.test.App']); await wait(500);
assert(w1.frame.width === 700 && w1.above, 'Live app exception must restore and float');
display.focus_window = w1; display.emit('notify::focus-window');
Main.wm.press('toggle-floating'); await wait(500);
assert(w1.frame.width === 1570 && !w1.above, 'Individual shortcut must override app floating default');
assert(settings.get_strv('floating-apps')[0] === 'wm-class:local.test.App', 'Window override changed app defaults');

Main.wm.press('toggle-tiling'); await wait(100);
assert(!settings.get_boolean('tiling-enabled'), 'Toggle must persist off state');
assert(w1.frame.width === 700 && !w2.above, 'Soft off must restore geometry and floating layer');
const stoppedMoves = w1.moves;
const manualFrame = {x: 120, y: 100, width: 850, height: 550};
w1.frame = {...manualFrame}; w1.emit('size-changed'); await wait(500);
assert(w1.moves === stoppedMoves, 'Soft off still moved windows');
ext.disable(); ext.enable(); await wait(400);
assert(w1.moves === stoppedMoves, 'Reload must preserve tiling-enabled=false');
Main.wm.press('toggle-tiling'); await wait(500);
assert(settings.get_boolean('tiling-enabled'), 'Toggle should turn tiling on');
assert(w1.above && w1.frame.width === 850, 'Persistent app exception should survive reload');
settings.set_strv('floating-apps', []); await wait(500);
assert(w1.frame.width === 1570, 'Removing app exception should reconsider that window');

settings.set_strv('toggle-floating', ['<Super><Control><Alt>g']); await wait(100);
assert(Main.wm.bindings.get('toggle-floating').settings.get_strv('toggle-floating')[0] === '<Super><Control><Alt>g',
    'Shortcut must refresh after settings change');
const systemBindings = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.keybindings'});
systemBindings.set_strv('maximize', ['<Super>t']); await wait(200);
assert(!Main.wm.bindings.has('toggle-tiling'), 'New system shortcut conflict must unregister our binding');
assert(systemBindings.get_strv('maximize')[0] === '<Super>t', 'System binding was modified');
systemBindings.reset('maximize'); await wait(200);
assert(Main.wm.bindings.has('toggle-tiling'), 'Binding should recover once conflict is removed');

// Panel menu actions use the opening window even if popup activation closes first.
display.focus_window = w1; display.emit('notify::focus-window');
const button = Main.panel.indicators.get('just@trait.com.br');
const preferencesItem = button.menu.items.find(item => item.label.text === (english ? 'Preferences…' : 'Preferências…'));
assert(preferencesItem, 'Session language applies to menu preferences');
preferencesItem.emit('activate');
assert(ext.preferencesOpened === 1, 'Panel must call the extension preferences launcher');
const floatingItem = button.menu.items.find(item => item.label.text.startsWith(english ? 'Toggle the active' : 'Alternar'));
const appRuleItem = button.menu.items.find(item => item.label.text.startsWith(english ? 'Always float' : 'Sempre'));
const enabledItem = button.menu.items.find(item => item.label.text.startsWith(english ? 'Tile windows' : 'Organizar'));
button.menu.open(); button.menu.close();
display.focus_window = w2;
floatingItem.emit('activate'); await wait(500);
assert(w1.above && w1.frame.width === 850, 'Menu action lost its captured target after closing');
display.focus_window = w1; button.menu.open();
floatingItem.emit('activate'); await wait(500);
assert(w1.frame.width === 1570, 'Menu must reinsert a floating window');
appRuleItem.toggle(); await wait(500);
assert(settings.get_strv('floating-apps').includes('wm-class:local.test.App'), 'Panel must persist app exception');
assert(w1.above && w1.frame.width === 850, 'Explicit app action must override the temporary tiled choice');
appRuleItem.toggle(); await wait(500);
assert(settings.get_strv('floating-apps').length === 0 && w1.frame.width === 1570,
    'Removing app menu rule should reconsider its windows');
enabledItem.toggle(); await wait(100);
assert(!settings.get_boolean('tiling-enabled') && w1.frame.width === 850, 'Panel off did not restore geometry');
enabledItem.toggle(); await wait(500);
assert(settings.get_boolean('tiling-enabled') && w1.frame.width === 1570, 'Panel on did not restart tiling');
monitors = 2; Main.layoutManager.emit('monitors-changed'); await wait(100);
assert(!enabledItem.state, 'Suspended menu must offer explicit restart');
monitors = 1; Main.layoutManager.emit('monitors-changed'); await wait(100);
enabledItem.toggle(); await wait(500);
assert(w1.frame.width === 1570, 'Panel restart failed when enabled setting already was true');
button.menu.close();
display.focus_window = null; display.emit('notify::focus-window');
assert(!floatingItem.sensitive && !appRuleItem.sensitive, 'Panel actions require a valid window');

// Real Meta enum decoding, native grab ownership and live menu preference.
const resizeItem = button.menu.items.find(item => item.label.text === (english
    ? 'Resize splits when releasing a window edge' : 'Ajustar divisões ao soltar a borda'));
assert(resizeItem, 'Session language applies to Shell menu');
assert(resizeItem.state, 'Shared-border resizing should default on');
resizeItem.toggle(); await wait(100);
assert(!settings.get_boolean('resize-splits'), 'Resize menu preference was not persisted');
settings.set_boolean('resize-splits', true); await wait(100);
assert(resizeItem.state, 'Resize menu must reflect external preference changes');
const w5 = new Window(5); windows.push(w5); display.emit('window-created', w5); await wait(500);
const leftWidth = w1.frame.width, rightWidth = w5.frame.width;
const leftMoves = w1.moves, rightMoves = w5.moves;
display.emit('grab-op-begin', w1, Meta.GrabOp.RESIZING_E);
w1.frame = {...w1.frame, width: leftWidth + 100}; w1.emit('size-changed'); await wait(500);
assert(w1.moves === leftMoves && w5.moves === rightMoves, 'Extension fought native drag');
display.emit('grab-op-end', w1, Meta.GrabOp.RESIZING_E); await wait(500);
assert(w1.frame.width === leftWidth + 100 && w5.frame.width === rightWidth - 100 && !w1.above,
    'Shared border did not update both native window frames');
// Keyboard resize enums follow the same settled-frame path.
display.emit('grab-op-begin', w5, Meta.GrabOp.KEYBOARD_RESIZING_W);
w5.frame = {...w5.frame, x: w5.frame.x - 40, width: w5.frame.width + 40};
w5.emit('position-changed'); display.emit('grab-op-end', w5, Meta.GrabOp.KEYBOARD_RESIZING_W);
await wait(500);
assert(w1.frame.width === leftWidth + 60 && w5.frame.width === rightWidth - 60,
    'Keyboard resize enum lost its shared boundary');
// Mouse moves preview compatible destinations; geometry only swaps on release.
const swapItem = button.menu.items.find(item => item.label.text.startsWith(english ? 'Swap windows' : 'Trocar janelas'));
assert(swapItem.state, 'Drag swap should default on');
const beforeSwap1 = {...w1.frame}, beforeSwap5 = {...w5.frame};
pointer = {x: beforeSwap5.x + beforeSwap5.width / 2, y: beforeSwap5.y + 100};
const swapMoves1 = w1.moves, swapMoves5 = w5.moves, reads = pointerReads;
display.emit('grab-op-begin', w1, Meta.GrabOp.MOVING);
w1.frame = {...w1.frame, x: w1.frame.x + 100, y: w1.frame.y + 100};
w1.emit('position-changed'); await wait(500);
assert(w1.moves === swapMoves1 && w5.moves === swapMoves5 && pointerReads > reads,
    'Preview may sample the pointer but must not move windows during a native drag');
const previews = () => [...borderWidgets].filter(widget => widget.name === 'justtiling-swap-preview');
assert(previews().length === 1 && previews()[0].parent === w5.actor,
    'Valid swap target must carry the preview');
assert(previews()[0].opacity > 0 && previews()[0].opacity < 255 &&
    previews()[0].style.includes('-st-accent-color') && !previews()[0].reactive && !previews()[0].can_focus,
    'Preview must be translucent, accent-colored and non-interactive');
assert(previews()[0].width === w5.frame.width && previews()[0].height === w5.frame.height,
    'Preview must cover the receiving frame');
pointer = {x: 1, y: 1}; await wait(80);
assert(previews().length === 0, 'Leaving compatible tiles must remove the preview');
pointer = {x: beforeSwap5.x + beforeSwap5.width / 2, y: beforeSwap5.y + 100}; await wait(80);
assert(previews().length === 1, 'Pointer motion alone must restore the destination preview');
Main.overview.visible = true; Main.overview.emit('showing');
assert(previews().length === 0 && ext._preview.timer === null, 'Overview must remove preview and timer');
Main.overview.visible = false; Main.overview.emit('hidden');
assert(previews().length === 1, 'Leaving overview can restore an ongoing valid drag preview');
Main.sessionMode.isLocked = true; Main.sessionMode.emit('updated');
assert(previews().length === 0 && ext._preview.timer === null, 'Lock must remove preview and timer');
Main.sessionMode.isLocked = false; Main.sessionMode.emit('updated');
const releaseReads = pointerReads;
display.emit('grab-op-end', w1, Meta.GrabOp.MOVING); await wait(500);
assert(JSON.stringify(w1.frame) === JSON.stringify(beforeSwap5) &&
    JSON.stringify(w5.frame) === JSON.stringify(beforeSwap1) && !w1.above && !w5.above,
    'Native MOVING enum did not exchange the tiles');
assert(pointerReads === releaseReads + 1, 'Drop must use a fresh pointer sample');
assert(previews().length === 0 && ext._preview.timer === null, 'Drop must remove preview and timer');
const stoppedPreviewReads = pointerReads; await wait(80);
assert(pointerReads === stoppedPreviewReads, 'Preview polling must stop immediately after drop');
// Native actor scale and shadows must not offset the target overlay.
const targetBuffer = w5.get_buffer_rect;
w5.get_buffer_rect = () => ({...w5.frame, x: w5.frame.x - 10, y: w5.frame.y - 15});
w5.actor.childScale = 2;
const previewCancelFrame = {...w1.frame};
display.emit('grab-op-begin', w1, Meta.GrabOp.MOVING);
w1.frame = {...w1.frame, x: w1.frame.x + 100, y: w1.frame.y + 100};
pointer = {x: w5.frame.x + w5.frame.width / 2, y: w5.frame.y + 100};
w1.emit('position-changed');
assert(previews().length === 1 && previews()[0].x === 5 && previews()[0].y === 7.5 &&
    previews()[0].scale_x === 0.5, 'Preview must compensate native buffer and child scale');
const previewTargetActor = w5.actor;
w5.actor = null; previewTargetActor.destroy();
assert(previews().length === 0, 'Destroying the target actor must destroy its overlay');
w5.actor = new WindowActor(); w5.emit('shown');
assert(previews().length === 1, 'A recreated target actor must get a fresh valid preview');
w1.frame = previewCancelFrame;
display.emit('grab-op-end', w1, Meta.GrabOp.MOVING);
assert(previews().length === 0 && ext._preview.timer === null, 'Cancelled drag must remove preview');
w5.get_buffer_rect = targetBuffer; w5.actor.childScale = 1;
await wait(100);
// An Escape-like return to the original frame must not swap with the pointer target.
const cancelFrame = {...w1.frame};
display.emit('grab-op-begin', w1, Meta.GrabOp.MOVING_UNCONSTRAINED);
pointer = {x: w5.frame.x + 100, y: w5.frame.y + 100};
display.emit('grab-op-end', w1, Meta.GrabOp.MOVING_UNCONSTRAINED); await wait(200);
assert(JSON.stringify(w1.frame) === JSON.stringify(cancelFrame), 'Cancelled move swapped the windows');
swapItem.toggle(); await wait(100);
assert(!settings.get_boolean('drag-swap'), 'Drag swap menu did not persist preference');
display.emit('grab-op-begin', w5, Meta.GrabOp.MOVING);
const floated = {...w5.frame, x: 100, y: 110}; w5.frame = floated; w5.emit('position-changed');
display.emit('grab-op-end', w5, Meta.GrabOp.MOVING); await wait(500);
assert(w5.above && JSON.stringify(w5.frame) === JSON.stringify(floated),
    'Disabling drag swaps should preserve the original floating behavior');
settings.set_boolean('drag-swap', true); await wait(100);
assert(swapItem.state, 'Drag swap menu did not reflect external preference change');
w5.emit('unmanaging'); windows.splice(windows.indexOf(w5), 1); await wait(200);
assert(w5.handlers.size === 0 && w1.frame.width === 1570, 'Resized window closure leaked ownership');

// Focus cycling runs through the native binding without changing geometry.
const focusPeer = new Window(21); windows.push(focusPeer); display.emit('window-created', focusPeer); await wait(500);
display.focus_window = w1; display.emit('notify::focus-window');
const focusMoves = w1.moves + focusPeer.moves, focusTree = ext._controller.tree;
Main.wm.press('cycle-focus');
assert(display.focus_window === focusPeer && focusPeer.activatedAt === 1234, 'Super+F should activate next tiled window');
Main.wm.press('cycle-focus');
assert(display.focus_window === w1 && w1.moves + focusPeer.moves === focusMoves && ext._controller.tree === focusTree,
    'Focus cycling should wrap without geometry changes');
settings.set_strv('cycle-focus', ['<Super><Control><Alt>c']);
assert(Main.wm.bindings.get('cycle-focus').settings.get_strv('cycle-focus')[0] === '<Super><Control><Alt>c', 'Focus shortcut should refresh');
settings.set_strv('cycle-focus', []);
assert(!Main.wm.bindings.has('cycle-focus'), 'Focus shortcut should be disableable');
settings.reset('cycle-focus');
// Number selection captures input without moving anything until a valid choice.
const numbered = () => [...borderWidgets].filter(widget => widget.name === 'justtiling-numbered-swap');
const key = symbol => ({get_key_code: () => symbol, get_key_symbol: () => symbol, get_state: () => 0});
const numberedTree = ext._controller.tree;
Main.wm.press('swap-select');
assert(Main.modalCount === 1 && numbered().length === 1, 'Numbered swap must grab keyboard and label the other tile');
assert(w1.actor.children.size === 1 && numbered()[0].parent === focusPeer.actor,
    'Only other tiled windows get numbered overlays');
assert(ext._controller.tree === numberedTree && w1.moves + focusPeer.moves === focusMoves, 'Entering selection moved windows');
ext._numberedSwap.key(key(65307));
assert(Main.modalCount === 0 && numbered().length === 0 && ext._controller.tree === numberedTree, 'Escape must cancel cleanly');
Main.wm.press('swap-select'); Main.wm.press('swap-select');
assert(Main.modalCount === 0 && ext._controller.tree === numberedTree, 'Repeating shortcut must cancel');
Main.setFailGrab(true); Main.wm.press('swap-select'); Main.setFailGrab(false);
assert(Main.modalCount === 0 && numbered().length === 0, 'Failed keyboard grab must remove all UI');
Main.wm.press('swap-select');
ext._numberedSwap.key(key(57));
assert(Main.modalCount === 1 && ext._controller.tree === numberedTree, 'Invalid number must not swap');
ext._numberedSwap.key(key(49)); await wait(100);
assert(Main.modalCount === 0 && numbered().length === 0 && ext._controller.tree !== numberedTree &&
    display.focus_window === w1, 'Number 1 must swap and keep the source focused');
Main.wm.press('swap-select'); Main.overview.visible = true; Main.overview.emit('showing');
assert(Main.modalCount === 0 && numbered().length === 0, 'Overview must cancel numbered selection');
Main.overview.visible = false;
Main.wm.press('swap-select'); settings.set_int('inner-gap', 16); await wait(100);
assert(Main.modalCount === 0 && numbered().length === 0, 'Preference changes must cancel numbered selection');
settings.set_int('inner-gap', 15); await wait(100);
Main.wm.press('swap-select'); ext._numberedSwap.cancel();
assert(Main.modalCount === 0 && numbered().length === 0, 'Destroy must release keyboard and remove overlays');
focusPeer.emit('unmanaging'); windows.splice(windows.indexOf(focusPeer), 1); await wait(200);

// Directional shortcuts operate through the native binding callbacks and keep the active window.
display.focus_window = w1; display.emit('notify::focus-window');
const swapPeer = new Window(9); windows.push(swapPeer); display.emit('window-created', swapPeer); await wait(500);
const initialX = w1.frame.x;
Main.wm.press('swap-right'); await wait(100);
assert(w1.frame.x > swapPeer.frame.x && display.focus_window === w1, 'Super+Right did not exchange tiles with focus retained');
Main.wm.press('swap-left'); await wait(100);
assert(w1.frame.x === initialX, 'Super+Left did not reverse the swap');
settings.set_strv('swap-right', ['<Super><Alt>k']); await wait(100);
assert(Main.wm.bindings.get('swap-right').settings.get_strv('swap-right')[0] === '<Super><Alt>k',
    'Directional shortcut customization did not refresh');
settings.reset('swap-right');
swapPeer.emit('unmanaging'); windows.splice(windows.indexOf(swapPeer), 1); await wait(100);
settings.set_boolean('tiling-enabled', false);
assert(!Main.wm.bindings.has('swap-left') && nativeKeys.get_strv('unmaximize').includes('<Super>Down'),
    'Soft off must return native arrows');
settings.set_boolean('tiling-enabled', true); await wait(500);
assert(Main.wm.bindings.has('swap-left') && !nativeKeys.get_strv('unmaximize').includes('<Super>Down'),
    'Soft on must reclaim directional shortcuts');

// The new-window-side preference changes future insertion without reflowing existing windows.
settings.reset('new-window-side');
assert(settings.get_string('new-window-side') === 'left', 'Insertion must default left');
const movesBeforeSide = w1.moves;
settings.set_string('new-window-side', 'left'); await wait(100);
assert(w1.moves === movesBeforeSide, 'Changing insertion side reflowed the existing layout');
display.focus_window = w1; display.emit('notify::focus-window');
const w7 = new Window(7); windows.push(w7);
display.focus_window = w7; display.emit('window-created', w7); display.emit('notify::focus-window');
await wait(500);
assert(w7.frame.x < w1.frame.x, 'New window should be left of the previously active tile');
w7.emit('unmanaging'); windows.splice(windows.indexOf(w7), 1); await wait(200);
settings.set_string('new-window-side', 'right'); await wait(100);
display.focus_window = w1; display.emit('notify::focus-window');
const w8 = new Window(8); windows.push(w8); display.emit('window-created', w8); await wait(500);
assert(w8.frame.x > w1.frame.x, 'Switching back should insert the next window right');
w8.emit('unmanaging'); windows.splice(windows.indexOf(w8), 1); await wait(200);

// Live setting changes apply only to later insertions. A new window may take
// focus before reconciliation, but the previously tiled focus stays protected.
const stableTree = ext._controller.tree, stableMoves = w1.moves;
settings.reset('preserve-focused-window'); await wait(100);
assert(ext._controller.preserveFocusedWindow && ext._controller.tree === stableTree && w1.moves === stableMoves,
    'Enabling focus preservation must not reflow existing windows');
display.focus_window = w1; display.emit('notify::focus-window');
const peer = new Window(10); windows.push(peer); display.emit('window-created', peer); await wait(500);
display.focus_window = w1; display.emit('notify::focus-window');
const focusFrame = {...w1.frame};
const newcomer = new Window(11); windows.push(newcomer);
display.focus_window = newcomer; display.emit('window-created', newcomer); display.emit('notify::focus-window');
await wait(500);
assert(JSON.stringify(w1.frame) === JSON.stringify(focusFrame), 'New window must preserve previous focused tile size');
assert(ext._controller.records.get(11).state === 'tiled', 'Newcomer should fit among other tiles');
newcomer.emit('unmanaging'); windows.splice(windows.indexOf(newcomer), 1); await wait(200);
peer.emit('unmanaging'); windows.splice(windows.indexOf(peer), 1); await wait(200);

// Existing class-based rules upgrade to the installed application identity.
// Child windows with distinct classes/processes and untracked same-process
// windows inherit the rule; unrelated clients with PID 0 remain independent.
const priorRules = settings.get_strv('floating-apps');
const app = {get_id: () => 'org.test.OpenLog.desktop', is_window_backed: () => false};
const mainApp = new Window(12); mainApp.app = app; mainApp.pid = 100;
mainApp.get_wm_class = () => 'OpenLogMain';
const secondary = new Window(13); secondary.app = app; secondary.pid = 101;
secondary.get_wm_class = () => 'OpenLogEditor';
const worker = new Window(14); worker.pid = 100; worker.get_wm_class = () => 'Utility';
const unrelated = new Window(15); unrelated.get_wm_class = () => 'Utility';
settings.set_strv('floating-apps', ['wm-class:OpenLogMain']);
for (const win of [mainApp, secondary, worker, unrelated]) {
    windows.push(win); display.emit('window-created', win);
}
await wait(500);
assert(settings.get_strv('floating-apps')[0] === 'app-id:org.test.OpenLog.desktop',
    'Legacy exception should migrate to installed application identity');
for (const win of [mainApp, secondary, worker])
    assert(ext._controller.records.get(win.id).reason === 'app-exception', 'Every application window must float');
assert(ext._controller.records.get(15).state === 'tiled', 'Unrelated application must still tile');
mainApp.emit('unmanaging'); windows.splice(windows.indexOf(mainApp), 1); await wait(200);
assert(ext._controller.records.get(13).reason === 'app-exception' &&
    ext._controller.records.get(14).reason === 'app-exception', 'Children must stay floating after main closes');
// Removing the rule applies to all surviving windows and is not learned back.
settings.set_strv('floating-apps', []); await wait(500);
assert(ext._controller.records.get(13).state === 'tiled' && ext._controller.records.get(14).state === 'tiled',
    'Removing application rule should reconsider all its normal windows');
// Tracker metadata may arrive after mapping. Its signal must refresh identity.
settings.set_strv('floating-apps', ['app-id:org.test.Late.desktop']);
unrelated.app = {get_id: () => 'org.test.Late.desktop', is_window_backed: () => false};
tracker.emit(); await wait(200);
assert(ext._controller.records.get(15).reason === 'app-exception', 'Late tracker identity should apply application rule');
for (const win of [secondary, worker, unrelated]) {
    win.emit('unmanaging'); windows.splice(windows.indexOf(win), 1);
}
settings.set_strv('floating-apps', priorRules); await wait(200);

// Reproduce the real capture: independent helper, NORMAL, no app ID or
// transient parent, 360x72, min 1x1, and its desktop process is not running.
const beforePackageRules = settings.get_strv('floating-apps');
settings.set_strv('floating-apps', ['wm-class:org.openlogi.openlogi']);
packageFixture.aliases.set('openlogi.desktop', ['wm-class:org.openlogi.openlogi']);
packageFixture.executables.set(300, '/usr/bin/openlogi-overlay');
let releasePackage;
packageFixture.applications.set('/usr/bin/openlogi-overlay', new Promise(resolve => { releasePackage = resolve; }));
const osd = new Window(17); osd.pid = 300;
osd.get_wm_class = () => 'openlogi-lock-key-osd';
osd.get_min_size = () => [true, 1, 1];
osd.frame = {x: 1740, y: 520, width: 360, height: 72};
windows.push(osd); display.emit('window-created', osd);
await wait(250);
assert(osd.moves === 0 && ext._controller.records.get(17).state === 'pending',
    'Unidentified helper must not enter tiling while package lookup is pending');
releasePackage('openlogi.desktop'); await wait(200);
assert(osd.moves === 0 && osd.frame.width === 360 && osd.frame.height === 72 &&
    ext._controller.records.get(17).reason === 'app-exception', 'Independent package helper must inherit application exception');
// Both legacy default rules and canonical application IDs work without the main window.
settings.set_strv('floating-apps', ['app-id:openlogi.desktop']);
// All normal windows from this helper inherit it, regardless of their class.
const anotherOSD = new Window(18); anotherOSD.pid = 300;
anotherOSD.get_wm_class = () => 'arbitrary-helper-class';
windows.push(anotherOSD); display.emit('window-created', anotherOSD); await wait(200);
assert(anotherOSD.moves === 0 && ext._controller.records.get(18).reason === 'app-exception',
    'Package association must apply to every helper window');
assert(packageFixture.calls.filter(path => path === '/usr/bin/openlogi-overlay').length === 1,
    'Helper executable must be queried only once');
settings.set_strv('floating-apps', []); await wait(500);
assert(ext._controller.records.get(18).state === 'tiled', 'Removing the app exception should also release package helpers');
for (const win of [osd, anotherOSD]) { win.emit('unmanaging'); windows.splice(windows.indexOf(win), 1); }
settings.set_strv('floating-apps', beforePackageRules); await wait(200);

// Real memory GSettings persistence: manual swaps save app-level preferences;
// toggles/forgetting only affect later insertions, not the existing geometry.
const desktopWindow = new Window(20);
desktopWindow.get_window_type = () => Meta.WindowType.DESKTOP;
windows.push(desktopWindow); display.emit('window-created', desktopWindow); await wait(200);
const originalWmClass = w1.get_wm_class;
w1.get_wm_class = () => 'learning.example';
w1.app = {get_id: () => 'org.test.Learning.desktop', is_window_backed: () => false};
tracker.emit();
assert(settings.get_boolean('learn-layouts') && JSON.parse(settings.get_string('learned-layouts')).apps &&
    Object.keys(JSON.parse(settings.get_string('learned-layouts')).apps).length === 0, 'Fresh profile starts with learning enabled and no presets');
const learningPeer = new Window(19);
learningPeer.get_wm_class = () => 'learning.peer';
learningPeer.app = {get_id: () => 'org.test.Peer.desktop', is_window_backed: () => false};
windows.push(learningPeer); display.emit('window-created', learningPeer); await wait(500);
display.focus_window = w1; display.emit('notify::focus-window');
Main.wm.press(w1.frame.x < learningPeer.frame.x ? 'swap-right' : 'swap-left'); await wait(200);
let learnedApps = JSON.parse(settings.get_string('learned-layouts')).apps;
assert(learnedApps['app-id:org.test.Learning.desktop'] && learnedApps['app-id:org.test.Peer.desktop'],
    'Native shortcut callback must persist learned layouts in own settings');
const stableLearningTree = ext._controller.tree;
settings.set_boolean('learn-layouts', false);
assert(!ext._controller.learnLayouts && ext._controller.tree === stableLearningTree, 'Disabling learning must not reflow');
settings.set_string('learned-layouts', '{"version":1,"apps":{}}');
assert(Object.keys(ext._controller.learnedLayouts).length === 0 && ext._controller.tree === stableLearningTree,
    'Forgetting must clear controller cache without rearranging windows');
settings.reset('learn-layouts');
learningPeer.emit('unmanaging'); windows.splice(windows.indexOf(learningPeer), 1); await wait(200);
w1.get_wm_class = originalWmClass; delete w1.app; tracker.emit();
desktopWindow.emit('unmanaging'); windows.splice(windows.indexOf(desktopWindow), 1);

// Terminal-only capture is opt-in and observes short-lived windows immediately.
const oldLog = ext._adapter.log, captures = [];
ext._adapter.log = (level, message) => { if (message.startsWith('Window capture ')) captures.push(JSON.parse(message.slice(15))); };
settings.set_boolean('debug', true);
const flash = new Window(16); flash.pid = 0;
windows.push(flash); display.emit('window-created', flash);
flash.emit('unmanaging'); windows.splice(windows.indexOf(flash), 1);
assert(captures.some(info => info.id === 16 && info.event === 'created' && info.type === 'NORMAL'),
    'Capture must observe transiently visible normal windows before reconciliation');
assert(captures.every(info => !('title' in info) && !('arguments' in info)), 'Capture should omit titles and arguments');
settings.reset('debug');
assert(!ext._adapter.traceWindows, 'Capture must stop when debug resets');
ext._adapter.log = oldLog;

// Optional focus border attaches to only the focused window, never to chrome.
assert(settings.get_boolean('focus-border'), 'Border must default on');
settings.set_boolean('focus-border', false);
assert(borderWidgets.size === 0, 'Disabling border must remove it');
display.focus_window = w1; display.emit('notify::focus-window');
const borderMoves = w1.moves;
settings.set_boolean('focus-border', true);
assert(borderWidgets.size === 1 && w1.actor.children.size === 1, 'Focused tile should receive exactly one border');
let border = [...borderWidgets][0];
assert(!border.reactive && !border.can_focus && border.style.includes('-st-accent-color'),
    'Border must pass clicks through and use native accent token');
assert(border.x === 10 && border.y === 15 && border.width === w1.frame.width && border.height === w1.frame.height,
    'Border must align with frame rather than client shadow bounds');
assert(w1.moves === borderMoves, 'Enabling border must not move the window');
w1.actor.childScale = 2; w1.actor.emit('notify::child-transform');
assert(border.x === 5 && border.y === 7.5 && border.scale_x === 0.5 && border.width === w1.frame.width,
    'Child geometry scale must not double the border dimensions');
w1.actor.childScale = 1; w1.actor.emit('notify::child-transform');
// Focused floating windows are highlighted too; previous parent loses its child.
display.focus_window = w2; display.emit('notify::focus-window');
assert(borderWidgets.size === 1 && w1.actor.children.size === 0 && w2.actor.children.size === 1,
    'Focus change must move decoration from tile to floating window');
display.focus_window = null; display.emit('notify::focus-window');
assert(borderWidgets.size === 0, 'No focus must remove decoration');
display.focus_window = w1; display.emit('notify::focus-window');
Main.overview.visible = true; Main.overview.emit('showing');
assert(borderWidgets.size === 0, 'Overview must hide focused window border');
Main.overview.visible = false; Main.overview.emit('hidden');
assert(borderWidgets.size === 1, 'Border should return after overview');
Main.sessionMode.isLocked = true; Main.sessionMode.emit('updated');
assert(borderWidgets.size === 0, 'Lock screen must hide the border');
Main.sessionMode.isLocked = false; Main.sessionMode.emit('updated');
assert(borderWidgets.size === 1, 'Unlock should restore only the current border');
w1.minimized = true; w1.emit('notify::minimized');
assert(borderWidgets.size === 0, 'Minimized focused window must not have a border');
w1.minimized = false; w1.emit('notify::minimized'); await wait(500);
assert(borderWidgets.size === 1, 'Unminimized managed window should regain its border');
const fullscreen = w1.is_fullscreen;
w1.is_fullscreen = () => true; w1.emit('notify::fullscreen');
assert(borderWidgets.size === 0, 'Fullscreen must have no border');
w1.is_fullscreen = fullscreen; w1.emit('notify::fullscreen'); await wait(100);
assert(borderWidgets.size === 1, 'Leaving fullscreen must restore border');
settings.set_boolean('focus-border', false);
assert(borderWidgets.size === 0 && w1.actor.handlers.size === 0, 'Turning option off must detach target observers');
settings.set_boolean('focus-border', true);
const deadActor = w1.actor; deadActor.destroy();
assert(borderWidgets.size === 0, 'Native actor destruction must not leak decoration');
w1.actor = new WindowActor(); w1.emit('shown'); await wait(100);
assert(borderWidgets.size === 1, 'Recreated window actor should accept a fresh border');
settings.set_boolean('tiling-enabled', false);
assert(borderWidgets.size === 0, 'Soft off must remove border');
settings.set_boolean('tiling-enabled', true); await wait(500);
assert(borderWidgets.size === 1, 'Soft on should recreate border for managed focus');
ext.disable();
assert(borderWidgets.size === 0 && Main.overview.handlers.size === 0 && Main.sessionMode.handlers.size === 0,
    'Disable leaked border or shell visibility observers');
assert(w1.frame.width === manualFrame.width, 'New management interval must restore its own snapshot');
assert(Main.wm.bindings.size === 0 && display.handlers.size === 0, 'MVP cleanup leaked resources');
assert(w4.handlers.size === 0 && manager.handlers.size === 0, 'MVP workspace cleanup leaked observers');
assert(Main.panel.indicators.size === 0 && button.menu.handlers.size === 0, 'Panel leaked on disable');
assert(floatingItem.handlers.size === 0 && appRuleItem.handlers.size === 0, 'Menu item handlers leaked');

// A direct disable/enable cycle on the same extension instance must reclaim all bindings.
ext.enable(); await wait(500);
assert(Main.wm.bindings.size === 8, 'Reload while enabled lost directional keybindings');
ext.disable();
assert(nativeKeys.get_strv('unmaximize').includes('<Super>Down'), 'Reload cleanup lost native arrows');
Main.panel.fail = true;
ext = new JustTiling();
let panelFailed = false;
try { ext.enable(); } catch (_) { panelFailed = true; }
assert(panelFailed, 'Simulated panel initialization failure was not propagated');
assert(Main.wm.bindings.size === 0 && display.handlers.size === 0 && Main.panel.indicators.size === 0,
    'Partial panel failure leaked extension resources');
Main.panel.fail = false;
ext.disable();
// Cold-start readiness can exceed the bounded polling window. A later
// native geometry event must recover without a shortcut or a Shell reload.
windows.splice(0, windows.length, new Window(90));
const late = windows[0]; late.mapped = false;
display.focus_window = late;
ext = new JustTiling(); ext.enable(); await wait(2300);
assert(late.moves === 0, 'A window still mapping must not be tiled');
late.mapped = true;
late.emit('size-changed'); await wait(600);
assert(late.moves > 0 && late.frame.width === 1570,
    'A late ready window must recover on native geometry without Super+F');
ext.disable();
assert(late.handlers.size === 0 && Main.wm.bindings.size === 0,
    'Late-readiness recovery leaked native observers or shortcuts');
// Disable during an active preview must cancel polling synchronously.
const latePeer = new Window(91); windows.push(latePeer);
ext = new JustTiling(); ext.enable(); await wait(500);
const peerFrame = {...latePeer.frame};
display.emit('grab-op-begin', late, Meta.GrabOp.MOVING);
late.frame = {...late.frame, x: late.frame.x + 100, y: late.frame.y + 100};
pointer = {x: peerFrame.x + peerFrame.width / 2, y: peerFrame.y + 100};
late.emit('position-changed');
assert(previews().length === 1, 'Disable test requires an active swap preview');
const stoppedPreview = ext._preview;
ext.disable();
assert(previews().length === 0 && stoppedPreview.timer === null && stoppedPreview.destroyed,
    'Disable must synchronously remove the preview and polling source');
const previewReadsAfterDisable = pointerReads; await wait(80);
assert(pointerReads === previewReadsAfterDisable && late.actor.handlers.size === 0 &&
    latePeer.actor.handlers.size === 0, 'No pointer polling or target observers may survive disable');
// Disabling during keyboard selection must release its modal grab synchronously.
ext = new JustTiling(); ext.enable(); await wait(500);
display.focus_window = late; display.emit('notify::focus-window');
Main.wm.press('swap-select');
assert(Main.modalCount === 1 && numbered().length === 1, 'Disable test requires active numbered selection');
ext.disable();
assert(Main.modalCount === 0 && numbered().length === 0 && borderWidgets.size === 0 &&
    Main.uiGroup.children.size === 0 && late.actor.handlers.size === 0 && latePeer.actor.handlers.size === 0,
    'Disabling selection must release all modal input, widgets and target observers');
// Match Mutter: allows_resize() is false while fully maximized. A newly
// created window must unmaximize before fixed-size classification can run.
ext = new JustTiling(); ext.enable(); await wait(500);
const openingMaximized = new Window(92);
openingMaximized.flags = Meta.MaximizeFlags.BOTH;
openingMaximized.frame = {...workspace.get_work_area_for_monitor(0)};
let unmaximizeCalls = 0;
openingMaximized.unmaximize = () => { unmaximizeCalls++; openingMaximized.flags = 0; };
assert(!openingMaximized.allows_resize(), 'Fixture must emulate native maximized resize eligibility');
windows.push(openingMaximized); display.emit('window-created', openingMaximized); await wait(800);
assert(ext._controller.records.get(92).state === 'tiled' && openingMaximized.flags === 0 &&
    unmaximizeCalls === 1 && openingMaximized.moves > 0,
    'New maximized windows must normalize and tile without closing or using a shortcut');
display.focus_window = openingMaximized; display.emit('notify::focus-window');
assert(ext._border.widget !== null, 'Focused tiled window needs a border before maximization');
const manuallyMaximizedFrame = {...workspace.get_work_area_for_monitor(0)};
openingMaximized.flags = Meta.MaximizeFlags.BOTH;
openingMaximized.frame = manuallyMaximizedFrame;
openingMaximized.emit('notify::maximized-horizontally');
assert(ext._border.widget === null, 'Maximization notification must remove focus border immediately');
await wait(150);
assert(ext._controller.records.get(92).reason === 'user-maximized' &&
    openingMaximized.flags === Meta.MaximizeFlags.BOTH &&
    JSON.stringify(openingMaximized.frame) === JSON.stringify(manuallyMaximizedFrame) && unmaximizeCalls === 1,
    'Manual maximization must leave the tile and preserve the native maximized window');
assert(ext._border.widget === null, 'Maximized floating window must not receive a focus border');
openingMaximized.flags = 0;
openingMaximized.frame = {x: 90, y: 80, width: 700, height: 500};
openingMaximized.emit('notify::maximized-horizontally'); await wait(400);
assert(ext._controller.records.get(92).state === 'tiled' && !openingMaximized.above && ext._border.widget !== null,
    'Restoring must automatically retile the window and restore its focus border');
// Marking an app always-floating while maximized must suppress automatic return.
openingMaximized.flags = Meta.MaximizeFlags.BOTH;
openingMaximized.frame = {...manuallyMaximizedFrame};
openingMaximized.emit('notify::maximized-horizontally'); await wait(100);
const previousFloatingApps = ext._settings.get_strv('floating-apps');
openingMaximized.get_gtk_application_id = () => 'org.test.RestoreException';
ext._settings.set_strv('floating-apps', [...previousFloatingApps, 'gtk-app-id:org.test.RestoreException']);
openingMaximized.emit('notify::gtk-application-id'); await wait(100);
assert(ext._border.widget === null, 'App-exempt maximized window must have no focus border');
openingMaximized.flags = 0;
openingMaximized.frame = {x: 120, y: 100, width: 750, height: 500};
openingMaximized.emit('notify::maximized-horizontally'); await wait(300);
assert(ext._controller.records.get(92).state === 'floating' && ext._border.widget !== null,
    'Restoring an always-floating app must preserve its floating choice and show its border');
openingMaximized.emit('unmanaging'); windows.splice(windows.indexOf(openingMaximized), 1); await wait(100);
ext._settings.set_strv('floating-apps', previousFloatingApps);
ext.disable();
assert(Main.modalCount === 0 && borderWidgets.size === 0 && display.handlers.size === 0,
    'Maximization test must leave no observers or UI resources');
print('Shell adapter smoke OK: lifecycle, workspaces, settings, shortcut migration, conflicts, native-menu doubles, shared-border resizing, native drag swapping, optional focus border doubles, numbered keyboard swaps, initial/manual maximization, restore-to-grid and cleanup.');
