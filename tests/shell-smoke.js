import {layoutBarGeometry, presetFrame} from '../src/layout/presets.js';
// Isolated integration: real GLib, GSettings(memory), Meta typelib and Mtk;
// fake Shell globals/windows. NEVER import this into a real GNOME Shell.
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Gio from 'gi://Gio';

const root = ARGV[0];
const english = GLib.getenv('LANGUAGE') === 'en';
const {widgets: borderWidgets} = await import(`${root}/tests/fixtures/st.js`);
const packageFixture = await import(`${root}/tests/fixtures/packageLookup.js`);
const messageTray = await import(`${root}/tests/fixtures/messageTray.js`);
const {appSystem, tracker} = await import(`${root}/tests/fixtures/shell.js`);
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
const shellwm = new Signals();
let monitors = 1;
const windows = [];
let aboveChanges = 0;
Object.assign(display, {list_all_windows: () => windows,
    get_n_monitors: () => monitors, focus_window: null});
let pointer = {x: 0, y: 0}, pointerReads = 0;
const monitorManager = {
    get_monitors: () => Array.from({length: monitors}, (_, i) => ({get_connector: () => `TEST-${i}`})),
    get_monitor_for_connector: connector => {
        const index = Number(connector.replace('TEST-', ''));
        return Number.isInteger(index) && index >= 0 && index < monitors ? index : -1;
    },
};
globalThis.global = {backend: {get_monitor_manager: () => monitorManager}, window_manager: shellwm, stage: {width: 1600, height: 932}, display, workspace_manager: manager, get_current_time: () => 1234,
    get_pointer: () => { pointerReads++; return [pointer.x, pointer.y, 0]; }};

class WindowActor extends Signals {
    constructor() { super(); this.children = new Set(); this.childScale = 1; this.effects = new Map(); this.width = 720; this.height = 530; }
    add_effect_with_name(name, effect) { this.effects.set(name, effect); }
    remove_effect(effect) { for (const [key, current] of this.effects) if (current === effect) this.effects.delete(key); }
    get_child_transform() { return {get_value: () => this.childScale}; }
    add_child(child) { child.parent = this; this.children.add(child); this.emit('child-added', child); }
    set_child_above_sibling(child, sibling) {
        assert(sibling === null && this.children.has(child), 'Border stacking must stay inside its own native parent');
        this.children.delete(child); this.children.add(child);
    }
    destroy() {
        this.emit('destroy');
        for (const child of [...this.children]) child.destroy();
        this.effects.clear(); this.handlers.clear();
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
    get_client_type() { return this.clientType ?? Meta.WindowClientType.WAYLAND; }
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
    get_gtk_unique_bus_name() { return null; }
    get_gtk_application_object_path() { return null; }
    get_gtk_window_object_path() { return null; }
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
    make_above() { aboveChanges++; this.above = true; this.emit('notify::above'); }
    unmake_above() { aboveChanges++; this.above = false; this.emit('notify::above'); }
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
assert(Main.wm.bindings.get('toggle-floating').settings.get_strv('toggle-floating')[0] === '<Super>g', 'Default floating shortcut must be Super+G');
assert(Main.panel.indicators.size === 1, 'Panel menu must be attached');
assert(w1.frame.width === 1570, 'Adapter must tile first window');
assert(migrationSettings.get_boolean('round-window-corners') && w1.actor.effects.has('justtiling-rounded-corners'),
    'New installations must apply rounded corners by default');
migrationSettings.set_boolean('round-window-corners', false);
const firstMoves = w1.moves;
const w2 = new Window(2, 3000);
windows.push(w2); display.emit('window-created', w2);
await wait(500);
assert(!w2.above && w2.moves === 0, 'Rejected window must float without resizing');
assert(w1.moves === firstMoves, 'Preflight rejection must not reflow existing tile');
const w3 = new Window(3);
windows.push(w3); display.emit('window-created', w3);
await wait(500);
assert(w1.frame.width < 1570 && w3.frame.width < 1570, 'Creation signal must add a tile');
w3.emit('unmanaging'); windows.splice(windows.indexOf(w3), 1);
await wait(200);
assert(w3.handlers.size === 0, 'Destroyed window signals must be disconnected');
assert(w1.frame.width === 1570, 'Closing must recover space');
assert(Main.wm.bindings.size === 9, 'All eight keybindings should be registered');
assert(JSON.stringify(nativeKeys.get_strv('unmaximize')) === JSON.stringify(['<Alt>F5']),
    'Override must remove only conflicting arrow and preserve other accelerators');
ext.disable(); ext.disable();
assert(Main.panel.indicators.size === 0, 'Disable leaked panel menu');
assert(Main.wm.bindings.size === 0, 'Disable leaked keybindings');
assert(JSON.stringify(nativeKeys.get_strv('unmaximize')) === JSON.stringify(['<Super>Down', '<Alt>F5']),
    'Disable did not restore original native shortcut');
assert(w1.frame.width === 700 && w1.frame.x === 50, 'Disable must restore original geometry');
assert(!w2.above, 'Disable must preserve native floating stacking');
assert(w1.handlers.size === 0 && w2.handlers.size === 0, 'Window signals leaked');
assert(display.handlers.size === 0 && manager.handlers.size === 0, 'Global signals leaked');
assert(Main.layoutManager.handlers.size === 0 && Main.extensionManager.handlers.size === 0, 'Shell signals leaked');
// Upgrade the former Super+O default using real memory-backed schema values.
const mediaKeys = new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.media-keys'});
const rotationKeys = mediaKeys.get_strv('rotate-video-lock-static');
migrationSettings.set_strv('toggle-floating', ['<Super>o']);
migrationSettings.set_int('preferences-version', 2);
ext = new JustTiling(); ext.enable(); await wait(100);
assert(ext._settings.get_strv('toggle-floating')[0] === '<Super>g' && Main.wm.bindings.has('toggle-floating'),
    'Existing Super+O default must migrate to a registered Super+G binding');
display.focus_window = w1; display.emit('notify::focus-window');
Main.wm.press('toggle-floating'); await wait(100);
assert(ext._controller.records.get(1).state === 'floating', 'New floating shortcut must execute the menu action');
Main.wm.press('toggle-floating'); await wait(500);
assert(ext._controller.records.get(1).state === 'tiled', 'New floating shortcut must also return the window to tiling');
assert(ext._adapter.shortcutSources().some(source => source.schema ===
    'org.gnome.settings-daemon.plugins.media-keys' && source.key === 'rotate-video-lock-static'),
    'Runtime conflict detection must include GNOME media shortcuts');
assert(JSON.stringify(mediaKeys.get_strv('rotate-video-lock-static')) === JSON.stringify(rotationKeys),
    'Choosing Super+G must preserve the GNOME rotation lock bindings');
ext.disable();
const moves = w1.moves;
await wait(500);
assert(w1.moves === moves, 'Callback moved window after disable');

for (const uuid of ['o-tiling@test', 'justtiling@dudu.local', 'just@trait.com.br']) {
    const name = uuid === 'o-tiling@test' ? 'Ubuntu Tiling Assistant' : '<b>Example Tiler</b>';
    Main.extensionManager.extensions.set(uuid, {state: 1, metadata: {name}});
    const beforeMoves = w1.moves, beforeCreated = messageTray.created.length;
    ext = new JustTiling(); ext.enable();
    assert(ext._controller.suspended && !Main.wm.bindings.has('swap-select') && w1.moves === beforeMoves,
        'Conflicting tiler must pause without failing extension activation or moving windows');
    assert(Main.panel.indicators.has(ext.uuid) && ext._indicator.manager.visible && ext._indicator.conflict.visible,
        'Paused extension must keep its panel warning and manager action available');
    const rows = ext._indicator.conflictRows;
    assert(ext._indicator.conflictList.actor.visible && rows.length === 1 &&
        rows[0].label.text === `${name}\n${uuid}` && rows[0].label.clutter_text.line_wrap &&
        rows[0].label.clutter_text.ellipsize === 0 && rows[0].label.clutter_text.line_wrap_mode === 2,
        'Panel must list literal names and UUIDs with wrapping and no ellipsis');
    assert(ext._indicator.conflict.label.text === (english ? 'Conflicting extensions' : 'Extensões conflitantes'),
        'Panel must use a short translated heading above separate conflict rows');
    const warning = ext._conflictNotice.notification;
    assert(warning.body.startsWith(name) && warning.useBodyMarkup === false && warning.actions.length === 1 &&
        warning.actions[0].label === (english ? 'Open Extension Manager' : 'Abrir gerenciador de extensões'),
        'Notification must show literal extension names and a translated manager button');
    ext._syncEnabled(); ext._syncEnabled();
    assert(messageTray.created.length === beforeCreated + 1, 'Repeated attempts must not spam conflict notifications');
    let launches = 0;
    appSystem.apps.set('org.gnome.Extensions.desktop', {activate() { launches++; }});
    warning.actions[0].activate();
    assert(launches === 1 && ext._controller.suspended, 'Notification action must open manager without resuming');
    appSystem.apps.clear();
    appSystem.apps.set('com.mattjakeman.ExtensionManager.desktop', {activate() { launches++; }});
    ext._indicator.manager.emit('activate');
    assert(launches === 2, 'Panel action must support the alternative Extension Manager');
    appSystem.apps.clear();
    const beforeNotices = Main.notices.length;
    ext._indicator.manager.emit('activate');
    assert(Main.notices.length === beforeNotices + 1 && ext._controller.suspended,
        'A missing manager must produce useful feedback without changing tiling');
    Main.notices.length = beforeNotices;
    assert(Main.extensionManager.extensions.get(uuid).state === 1,
        'Opening the manager must not disable or change another extension');
    warning.destroy(); ext._syncEnabled();
    assert(ext._conflictNotice.notification === null && ext._indicator.manager.visible &&
        messageTray.created.length === beforeCreated + 1, 'Dismissed notifications must not respawn; keep panel action');
    const secondUuid = 'forge@example';
    const longName = 'A long extension name '.repeat(6).trim();
    Main.extensionManager.extensions.set(secondUuid, {state: 1, metadata: {name: longName}});
    Main.extensionManager.emit('extension-state-changed');
    const listed = ext._indicator.conflictRows.map(row => row.label.text);
    assert(listed.length === 2 && listed.includes(`${name}\n${uuid}`) &&
        listed.includes(`${longName}\n${secondUuid}`),
        'Every active conflict must have its own complete row, including long names');
    ext._conflictNotice.notification.destroy(); ext._indicator.button.menu.open();
    assert(ext._indicator.conflictRows.length === 2 && ext._indicator.conflictList.actor.visible,
        'Conflict names must remain accessible after dismissing the notification');
    ext._indicator.button.menu.close();
    Main.extensionManager.extensions.delete(secondUuid);
    Main.extensionManager.extensions.delete(uuid);
    Main.extensionManager.emit('extension-state-changed');
    assert(!ext._indicator.conflictList.actor.visible && ext._indicator.conflictRows.length === 0,
        'Resolving all conflicts must clear the list');
    assert(ext._controller.suspended && ext._indicator.resume.visible && !ext._indicator.manager.visible &&
        w1.moves === beforeMoves, 'Resolving conflicts must wait for explicit resume');
    const resolved = ext._conflictNotice.notification;
    assert(resolved.actions[0].label === (english ? 'Resume automatic tiling' : 'Retomar organização automática'),
        'Resolved notification must offer an explicit translated resume action');
    Main.extensionManager.extensions.set(uuid, {state: 2, metadata: {name}});
    Main.extensionManager.emit('extension-state-changed');
    assert(ext._controller.suspended && !ext._conflictNotice.resolved && ext._indicator.manager.visible,
        'A newly activating conflict must replace the resolved prompt without resuming');
    Main.extensionManager.extensions.delete(uuid); Main.extensionManager.emit('extension-state-changed');
    ext._conflictNotice.notification.actions[0].activate(); await wait(250);
    assert(!ext._controller.suspended && ext._controller.running && !ext._indicator.conflict.visible &&
        messageTray.notifications.size === 0, 'Explicit resume must start tiling and clear the warning');
    ext.disable();
    assert(messageTray.notifications.size === 0 && warning.actions.length === 0 && resolved.actions.length === 0,
        'Disabling must remove notifications and their action callbacks');
    Main.extensionManager.extensions.clear();
}
assert(display.handlers.size === 0 && shellwm.handlers.size === 0, 'Partial-enable failure leaked observers');

const noticesBeforeMonitor = Main.notices.length;
ext = new JustTiling(); ext.enable(); await wait(500);
monitors = 2; Main.layoutManager.emit('monitors-changed'); await wait(200);
assert(w1.frame.width === 1570 && !ext._controller.suspended, 'Second monitor must keep the existing grid active');
assert(Main.notices.length === noticesBeforeMonitor, 'Connecting a monitor must not pause tiling or notify');
monitors = 1; Main.layoutManager.emit('monitors-changed'); await wait(500);
assert(w1.frame.width === 1570, 'Removing a monitor must keep tiling active');
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
assert(!w2.above, 'Inactive workspace must preserve native stacking');
activeWorkspace = workspace; manager.emit('active-workspace-changed'); await wait(500);
assert(w1.moves === firstMovesBeforeSwitch, 'Returning must preserve existing geometry');

settings.set_strv('floating-apps', ['wm-class:local.test.App']); await wait(500);
assert(w1.frame.width === 700 && !w1.above, 'Live app exception must restore and float');
display.focus_window = w1; display.emit('notify::focus-window');
Main.wm.press('toggle-floating'); await wait(500);
assert(w1.frame.width === 1570 && !w1.above, 'Individual shortcut must override app floating default');
assert(settings.get_strv('floating-apps')[0] === 'wm-class:local.test.App', 'Window override changed app defaults');

Main.wm.press('toggle-tiling'); await wait(100);
assert(!settings.get_boolean('tiling-enabled'), 'Toggle must persist off state');
assert(w1.frame.width === 700 && !w2.above, 'Soft off must restore geometry without changing native stacking');
const stoppedMoves = w1.moves;
const manualFrame = {x: 120, y: 100, width: 850, height: 550};
w1.frame = {...manualFrame}; w1.emit('size-changed'); await wait(500);
assert(w1.moves === stoppedMoves, 'Soft off still moved windows');
ext.disable(); ext.enable(); await wait(400);
assert(w1.moves === stoppedMoves, 'Reload must preserve tiling-enabled=false');
Main.wm.press('toggle-tiling'); await wait(500);
assert(settings.get_boolean('tiling-enabled'), 'Toggle should turn tiling on');
assert(!w1.above && w1.frame.width === 850, 'Persistent app exception should survive reload');
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
const button = Main.panel.indicators.get('justtiling@trait.com.br');
assert(button.visible && !settings.get_boolean('hide-panel-icon'), 'Panel icon must default visible');
const movesBeforeHiding = w1.moves, bindingsBeforeHiding = Main.wm.bindings.size;
button.menu.open();
settings.set_boolean('hide-panel-icon', true);
assert(!button.visible && !button.container.visible && !button.menu.isOpen, 'Hiding the panel icon must close the menu immediately');
assert(ext._controller.running && Main.wm.bindings.size === bindingsBeforeHiding && w1.moves === movesBeforeHiding,
    'Hiding the icon must not stop tiling, unregister shortcuts or reflow windows');
settings.set_boolean('hide-panel-icon', false);
assert(button.visible && button.container.visible && Main.panel.indicators.size === 1, 'Showing the icon must reuse its existing indicator');
const preferencesItem = button.menu.items.find(item => item.label?.text === (english ? 'Preferences…' : 'Preferências…'));
assert(preferencesItem, 'Session language applies to menu preferences');
preferencesItem.emit('activate');
assert(ext.preferencesOpened === 1, 'Panel must call the extension preferences launcher');
const floatingItem = button.menu.items.find(item => item.label?.text.startsWith(english ? 'Toggle the active' : 'Alternar'));
const appRuleItem = button.menu.items.find(item => item.label?.text.startsWith(english ? 'Always float' : 'Sempre'));
const enabledItem = button.menu.items.find(item => item.label?.text.startsWith(english ? 'Tile windows' : 'Organizar'));
const pinItem = button.menu.items.find(item => item.label?.text === (english ? "Pin this application's position and size" : 'Fixar posição e tamanho deste aplicativo'));
assert(pinItem && settings.get_strv('toggle-pin')[0] === '<Super>y', 'Pin menu and default binding must exist');
button.menu.open(); button.menu.close();
display.focus_window = w2;
pinItem.toggle(); await wait(100);
assert(Object.keys(JSON.parse(settings.get_string('pinned-layouts')).apps).length === 1,
    'Pin menu must save the window captured when opening the popup');
assert(Main.notices.at(-1).message === (english ? 'Application pinned. Preferred position and size saved.' : 'Aplicativo fixado. Posição e tamanho preferidos salvos.'),
    'Pin confirmation must follow the session language');
display.focus_window = w1; display.emit('notify::focus-window');
Main.wm.press('toggle-pin'); await wait(100);
assert(Object.keys(JSON.parse(settings.get_string('pinned-layouts')).apps).length === 0,
    'Pin shortcut must unpin the active application');
assert(Main.notices.at(-1).message === (english ? 'Application unpinned.' : 'Aplicativo desafixado.'),
    'Unpin shortcut must confirm the resulting state');
settings.set_strv('toggle-pin', ['<Super><Shift>y']); await wait(50);
assert(Main.wm.bindings.get('toggle-pin').settings.get_strv('toggle-pin')[0] === '<Super><Shift>y',
    'Changing the pin shortcut must refresh its native registration');
const beforePinNotices = Main.notices.length;
Main.wm.press('toggle-pin');
assert(Main.notices.length === beforePinNotices + 1 && Object.keys(JSON.parse(settings.get_string('pinned-layouts')).apps).length === 1,
    'A customized pin binding must also confirm successful pinning exactly once');
Main.wm.press('toggle-pin');
assert(Main.notices.length === beforePinNotices + 2 && Object.keys(JSON.parse(settings.get_string('pinned-layouts')).apps).length === 0,
    'A customized binding must also confirm unpinning exactly once');
settings.reset('toggle-pin'); await wait(50);
button.menu.open(); button.menu.close();
display.focus_window = w2;
floatingItem.emit('activate'); await wait(500);
assert(!w1.above && w1.frame.width === 850, 'Menu action lost its captured target after closing');
display.focus_window = w1; button.menu.open();
floatingItem.emit('activate'); await wait(500);
assert(w1.frame.width === 1570, 'Menu must reinsert a floating window');
appRuleItem.toggle(); await wait(500);
assert(settings.get_strv('floating-apps').includes('wm-class:local.test.App'), 'Panel must persist app exception');
assert(!w1.above && w1.frame.width === 850, 'Explicit app action must override the temporary tiled choice');
appRuleItem.toggle(); await wait(500);
assert(settings.get_strv('floating-apps').length === 0 && w1.frame.width === 1570,
    'Removing app menu rule should reconsider its windows');
enabledItem.toggle(); await wait(100);
assert(!settings.get_boolean('tiling-enabled') && w1.frame.width === 850, 'Panel off did not restore geometry');
enabledItem.toggle(); await wait(500);
assert(settings.get_boolean('tiling-enabled') && w1.frame.width === 1570, 'Panel on did not restart tiling');
monitors = 2; Main.layoutManager.emit('monitors-changed'); await wait(100);
assert(enabledItem.state, 'The panel toggle must stay enabled with multiple monitors');
monitors = 1; Main.layoutManager.emit('monitors-changed'); await wait(100);
await wait(500);
assert(w1.frame.width === 1570, 'Monitor removal must preserve the active grid');
button.menu.close();
display.focus_window = null; display.emit('notify::focus-window');
assert(!floatingItem.sensitive && !appRuleItem.sensitive, 'Panel actions require a valid window');

// Real Meta enum decoding and live Preferences settings remain supported.
assert(!button.menu.items.some(item => item.label?.text === (english
    ? 'Resize splits when releasing a window edge' : 'Ajustar divisões ao soltar a borda')),
    'Split resizing belongs only in Preferences');
assert(!button.menu.items.some(item => item.label?.text === (english
    ? 'Swap windows by dragging and dropping' : 'Trocar janelas ao arrastar e soltar')),
    'Drag swapping belongs only in Preferences');
const {PopupSeparatorMenuItem} = await import(`${root}/tests/fixtures/popupMenu.js`);
const floatingIndex = button.menu.items.indexOf(floatingItem);
assert(button.menu.items[floatingIndex - 1] instanceof PopupSeparatorMenuItem &&
    button.menu.items[floatingIndex + 1] instanceof PopupSeparatorMenuItem,
    'The temporary floating action must have separators above and below');
settings.set_boolean('resize-splits', false); await wait(100);
assert(!ext._controller.resizeSplits, 'Preferences must still control split resizing');
settings.set_boolean('resize-splits', true); await wait(100);
assert(ext._controller.resizeSplits, 'Preferences must still restore split resizing');
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
assert(settings.get_boolean('drag-swap'), 'Drag swap should default on');
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
const palettes = () => [...borderWidgets].filter(widget => widget.name === 'justtiling-layout-bar');
const layoutPreviews = () => [...borderWidgets].filter(widget => widget.name === 'justtiling-layout-preview');
assert(palettes().length === 1 && !palettes()[0].reactive, 'Dragging must reveal a non-reactive preset palette');
const paletteZone = layoutBarGeometry(ext._adapter.area()).zones[0];
pointer = {x: paletteZone.hit.x + 3, y: paletteZone.hit.y + 3}; await wait(80);
assert(previews().length === 0 && layoutPreviews().length === 1 &&
    Object.keys(JSON.parse(settings.get_string('pinned-layouts')).apps).length === 0,
    'Hover must replace the swap overlay with a destination preview without saving a pin');
settings.set_boolean('layout-assistant', false);
assert(palettes().length === 0 && layoutPreviews().length === 0, 'The optional palette must hide immediately');
settings.set_boolean('layout-assistant', true);
pointer = {x: beforeSwap5.x + beforeSwap5.width / 2, y: beforeSwap5.y + 100}; await wait(80);
assert(palettes().length === 1 && previews().length === 1, 'Leaving the bar must retain ordinary swap behavior');
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
settings.set_boolean('layout-assistant', false);
settings.set_boolean('drag-swap', false); await wait(100);
assert(!ext._controller.dragSwap, 'Preferences must still disable drag swapping');
display.emit('grab-op-begin', w5, Meta.GrabOp.MOVING);
const floated = {...w5.frame, x: 100, y: 110}; w5.frame = floated; w5.emit('position-changed');
display.emit('grab-op-end', w5, Meta.GrabOp.MOVING); await wait(500);
assert(!w5.above && JSON.stringify(w5.frame) === JSON.stringify(floated),
    'Disabling both drag features should preserve the original floating behavior');
settings.set_boolean('drag-swap', true); await wait(100);
assert(ext._controller.dragSwap, 'Preferences must still restore drag swapping');
settings.set_boolean('layout-assistant', true);
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
// focus before reconciliation, but unsaved areas must still balance.
const stableTree = ext._controller.tree, stableMoves = w1.moves;
settings.reset('preserve-focused-window'); await wait(100);
assert(ext._controller.preserveFocusedWindow && ext._controller.tree === stableTree && w1.moves === stableMoves,
    'Enabling focus preservation must not reflow existing windows');
display.focus_window = w1; display.emit('notify::focus-window');
const peer = new Window(10); windows.push(peer); display.emit('window-created', peer); await wait(500);
display.focus_window = w1; display.emit('notify::focus-window');
const newcomer = new Window(11); windows.push(newcomer);
display.focus_window = newcomer; display.emit('window-created', newcomer); display.emit('notify::focus-window');
await wait(500);
const balancedAreas = [w1, peer, newcomer].map(win => win.frame.width * win.frame.height);
assert(Math.max(...balancedAreas) / Math.min(...balancedAreas) < 1.1, 'Opening a third window must balance unsaved areas');
assert(ext._controller.records.get(11).state === 'tiled', 'Newcomer should fit among other tiles');
newcomer.emit('unmanaging'); windows.splice(windows.indexOf(newcomer), 1); await wait(200);
peer.emit('unmanaging'); windows.splice(windows.indexOf(peer), 1); await wait(200);

// Legacy class rules stay intact while verified ownership shares them with helpers.
// Child windows with distinct classes/processes and untracked same-process
// windows inherit the rule; unrelated clients with PID 0 remain independent.
packageFixture.executables.set(100, '/usr/bin/test-openlog-main');
packageFixture.executables.set(101, '/usr/bin/test-openlog-editor');
packageFixture.applications.set('/usr/bin/test-openlog-main', 'org.test.OpenLog.desktop');
packageFixture.applications.set('/usr/bin/test-openlog-editor', 'org.test.OpenLog.desktop');
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
assert(settings.get_strv('floating-apps')[0] === 'wm-class:OpenLogMain',
    'Runtime metadata must never rewrite a saved legacy exception');
for (const win of [mainApp, secondary, worker])
    assert(ext._controller.records.get(win.id).reason === 'app-exception', 'Every application window must float');
assert(ext._controller.records.get(15).state === 'tiled', 'Unrelated application must still tile');
mainApp.emit('unmanaging'); windows.splice(windows.indexOf(mainApp), 1); await wait(200);
assert(ext._controller.records.get(13).reason === 'app-exception' &&
    ext._controller.records.get(14).reason === 'app-exception', 'Children must stay floating after main closes');
const laterWorker = new Window(16); laterWorker.pid = 100; laterWorker.get_wm_class = () => 'LaterUtility';
windows.push(laterWorker); display.emit('window-created', laterWorker); await wait(200);
assert(ext._controller.records.get(16).reason === 'app-exception', 'New verified helpers must inherit a surviving rule after the main closes');
// Removing the rule applies to all surviving windows and is not learned back.
settings.set_strv('floating-apps', []); await wait(500);
assert(ext._controller.records.get(13).state === 'tiled' && ext._controller.records.get(14).state === 'tiled' && ext._controller.records.get(16).state === 'tiled',
    'Removing application rule should reconsider all its normal windows');
// Tracker metadata may arrive after mapping. Its signal must refresh identity.
settings.set_strv('floating-apps', ['app-id:org.test.Late.desktop']);
unrelated.app = {get_id: () => 'org.test.Late.desktop', is_window_backed: () => false};
tracker.emit(); await wait(200);
assert(ext._controller.records.get(15).reason === 'app-exception', 'Late tracker identity should apply application rule');
for (const win of [secondary, worker, laterWorker, unrelated]) {
    win.emit('unmanaging'); windows.splice(windows.indexOf(win), 1);
}
settings.set_strv('floating-apps', priorRules); await wait(200);

// An independent Wayland helper without a static alias: NORMAL, no app ID
// or transient parent, 360x72, min 1x1, and no running main application.
const beforePackageRules = settings.get_strv('floating-apps');
settings.set_strv('floating-apps', ['wm-class:org.openlogi.openlogi', 'wm-class:local.test.App']);
await wait(200);
display.focus_window = w1; display.emit('notify::focus-window');
assert(ext._controller.records.get(1).state === 'floating' && !w1.above,
    'Focused app exception must remain on the normal native layer before helper mapping');
packageFixture.aliases.set('openlogi.desktop', ['wm-class:org.openlogi.openlogi']);
packageFixture.executables.set(300, '/usr/bin/openlogi-overlay');
let releasePackage;
packageFixture.applications.set('/usr/bin/openlogi-overlay', new Promise(resolve => { releasePackage = resolve; }));
const osd = new Window(17); osd.pid = 300;
osd.get_wm_class = () => 'unidentified-package-helper';
osd.get_min_size = () => [true, 1, 1];
osd.frame = {x: 1740, y: 520, width: 360, height: 72};
windows.push(osd); display.emit('window-created', osd);
await wait(250);
assert(osd.moves === 0 && ext._controller.records.get(17).state === 'pending',
    'Unidentified helper must not enter tiling while package lookup is pending');
releasePackage('openlogi.desktop'); await wait(200);
assert(osd.moves === 0 && osd.frame.width === 360 && osd.frame.height === 72 &&
    ext._controller.records.get(17).reason === 'app-exception', 'Independent package helper must inherit application exception');
assert(!osd.above && !w1.above && osd.activatedAt === undefined && aboveChanges === 0,
    'Mapping an OSD over a floating exception must not impose topmost flags or activate the helper');
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

// OpenLogi's audited self-only OSD alias also preserves Caps Lock under
// XWayland, without trusting that client's declared PID or querying /proc.
settings.set_strv('floating-apps', ['app-id:openlogi.desktop']);
const x11OSD = new Window(703); x11OSD.pid = 9999; x11OSD.clientType = Meta.WindowClientType.X11;
x11OSD.get_wm_class = () => 'openlogi-lock-key-osd';
x11OSD.frame = {x: 600, y: 400, width: 360, height: 72};
x11OSD.get_min_size = () => [true, 1, 1];
windows.push(x11OSD); display.emit('window-created', x11OSD); await wait(500);
assert(ext._controller.records.get(703).reason === 'app-exception' && x11OSD.moves === 0 &&
    !x11OSD.above && x11OSD.activatedAt === undefined, 'XWayland Caps Lock OSD must stay native floating without stacking/focus changes');
x11OSD.emit('unmanaging'); windows.splice(windows.indexOf(x11OSD), 1);
settings.set_strv('floating-apps', beforePackageRules); await wait(100);

// Security regressions: child metadata and declared X11 PIDs cannot alter a
// parent's rule classification; observed metadata cannot rewrite preferences.
const securityRules = settings.get_strv('floating-apps');
settings.set_strv('floating-apps', ['wm-class:UntrustedChild']);
const securityParent = new Window(701); securityParent.pid = 701;
securityParent.get_wm_class = () => 'SecurityParent';
securityParent.app = {get_id: () => 'security-parent.desktop', is_window_backed: () => false};
const securityChild = new Window(702); securityChild.pid = 701;
securityChild.clientType = Meta.WindowClientType.X11;
securityChild.get_wm_class = () => 'UntrustedChild';
securityChild.get_transient_for = () => securityParent;
securityChild.app = {get_id: () => 'security-parent.desktop', is_window_backed: () => false};
for (const win of [securityParent, securityChild]) { windows.push(win); display.emit('window-created', win); }
await wait(500);
assert(ext._controller.records.get(701).state === 'tiled', `Spoofed child must never float the parent: ${JSON.stringify(ext._controller.records.get(701))}`);
assert(!ext._adapter.applicationSnapshot().get(701).applicationIdentities.includes('wm-class:UntrustedChild'),
    'Untrusted child/PID/appId must not propagate to parent');
assert(settings.get_strv('floating-apps')[0] === 'wm-class:UntrustedChild', 'Observed app association must not persist a rule migration');
for (let i = 0; i < 400; i++) {
    securityParent.get_wm_class = () => `changing-${i}`;
    ext._adapter.identitySnapshot = null;
    const snapshot = ext._adapter.applicationSnapshot();
    assert(snapshot.get(701).applicationIdentities.length <= 32, 'Current identity set must be bounded');
    assert(ext._adapter.windows.get(701).retainedRules.length <= 32, 'Rule continuity must be bounded');
    assert(!snapshot.get(701).applicationIdentities.includes(`wm-class:changing-${i - 1}`),
        'Old mutable metadata must not accumulate');
}
for (const win of [securityParent, securityChild]) { win.emit('unmanaging'); windows.splice(windows.indexOf(win), 1); }
settings.set_strv('floating-apps', securityRules); await wait(100);

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

// Optional rounded corners decorate every application window independently of focus/tiling.
const roundedName = 'justtiling-rounded-corners';
assert(!settings.get_boolean('round-window-corners') && ext._corners.windows.size === 0,
    'Explicitly disabling rounded corners must release native actor observers');
const roundFloat = new Window(98), roundOther = new Window(99), roundPopup = new Window(100);
roundFloat.get_wm_class = () => 'round.floating';
roundOther.workspace = otherWorkspace;
roundPopup.get_window_type = () => Meta.WindowType.NOTIFICATION;
const roundRules = settings.get_strv('floating-apps');
settings.set_strv('floating-apps', [...roundRules, 'wm-class:round.floating']);
for (const win of [roundFloat, roundOther, roundPopup]) { windows.push(win); display.emit('window-created', win); }
await wait(100);
const framesBeforeRounding = JSON.stringify(windows.map(win => win.frame));
const movesBeforeRounding = windows.reduce((sum, win) => sum + win.moves, 0);
const foreignEffect = {};
roundFloat.actor.add_effect_with_name('other-extension-effect', foreignEffect);
settings.set_boolean('round-window-corners', true);
assert(w1.actor.effects.has(roundedName) && roundFloat.actor.effects.has(roundedName) &&
    roundOther.actor.effects.has(roundedName) && !roundPopup.actor.effects.has(roundedName),
    'Rounding must cover tiled, always-floating and inactive workspace apps, but never notifications');
assert(ext._controller.records.get(98).state === 'floating' &&
    JSON.stringify(windows.map(win => win.frame)) === framesBeforeRounding &&
    windows.reduce((sum, win) => sum + win.moves, 0) === movesBeforeRounding,
    'Turning on a visual effect must not change geometry, tiling state or native focus');
display.focus_window = roundFloat; display.emit('notify::focus-window');
const radiusMoves = roundFloat.moves;
const roundScale = roundFloat.actor.effects.get(roundedName).geometry.scale;
settings.set_int('corner-radius', 16);
assert(roundFloat.actor.effects.get(roundedName).geometry.radius === 16 * roundScale &&
    ext._border.widget.style.includes('border-radius: 16px'),
    'Radius changes must immediately update both existing shaders and the focus border');
assert(roundFloat.moves === radiusMoves, 'Changing visual radius must not reflow or move windows');
settings.set_int('corner-radius', 0);
assert(ext._corners.windows.size === 0 && !roundFloat.actor.effects.has(roundedName) &&
    ext._border.widget.style.includes('border-radius: 0px'),
    'Zero radius must remove shaders while allowing a square focus border');
settings.set_int('corner-radius', 32);
assert(roundFloat.actor.effects.get(roundedName).geometry.radius === 32 * roundScale &&
    ext._border.widget.style.includes('border-radius: 32px'), 'Increasing radius must restore matching visual effects');
settings.reset('corner-radius');
const thicknessBounds = JSON.stringify(roundFloat.actor.effects.get(roundedName).geometry.bounds);
for (const width of [1, 2, 7, 8]) {
    settings.set_int('focus-border-width', width);
    assert(ext._border.widget.style.includes(`border: ${width}px solid`) &&
        roundFloat.actor.effects.get(roundedName).geometry.focusBorderWidth === width * roundScale,
        'Thickness must update both the decoration and its native margin probes immediately');
    assert(roundFloat.moves === radiusMoves &&
        JSON.stringify(roundFloat.actor.effects.get(roundedName).geometry.bounds) === thicknessBounds,
        'Thicker borders must draw inward without moving or resizing windows');
}
Main.overview.visible = true; Main.overview.emit('showing');
assert(ext._border.widget === null && roundFloat.actor.effects.get(roundedName).geometry.focusBorderWidth === 0,
    'Overview must remove the focus decoration from the shadow probe policy');
Main.overview.visible = false; Main.overview.emit('hidden');
assert(roundFloat.actor.effects.get(roundedName).geometry.focusBorderWidth === 8 * roundScale,
    'Leaving overview must restore the visible thickness policy');
display.focus_window = w1; display.emit('notify::focus-window');
assert(roundFloat.actor.effects.get(roundedName).geometry.focusBorderWidth === 0,
    'Unfocused windows must not use the focus border thickness of other windows');
settings.reset('focus-border-width');
settings.set_boolean('focus-border', false);
display.focus_window = roundFloat; display.emit('notify::focus-window');
assert(w1.actor.effects.has(roundedName) && roundFloat.actor.effects.has(roundedName),
    'Rounding must remain on unfocused windows and work without the focus border');
roundFloat.flags = Meta.MaximizeFlags.BOTH; roundFloat.emit('notify::maximized-horizontally');
assert(!roundFloat.actor.effects.has(roundedName), 'Maximizing must detach the shader, not only hide it');
roundFloat.flags = 0; roundFloat.emit('notify::maximized-horizontally');
assert(roundFloat.actor.effects.has(roundedName), 'Restoring must reapply rounded corners');
roundFloat.is_fullscreen = () => true; roundFloat.emit('notify::fullscreen');
assert(!roundFloat.actor.effects.has(roundedName), 'Fullscreen must remove rounded corners');
roundFloat.is_fullscreen = () => false; roundFloat.emit('notify::fullscreen');
roundFloat.minimized = true; roundFloat.emit('notify::minimized');
assert(!roundFloat.actor.effects.has(roundedName), 'Minimized apps must not keep active shaders');
roundFloat.minimized = false; roundFloat.emit('notify::minimized');
roundFloat.frame.width = 600; roundFloat.actor.width = 600; roundFloat.actor.emit('notify::allocation');
assert(roundFloat.actor.effects.get(roundedName).geometry.bounds[2] === 600,
    'Actor allocation must update frame bounds without a focus change');
Main.sessionMode.isLocked = true; Main.sessionMode.emit('updated');
assert(ext._corners.windows.size === 0 && !roundFloat.actor.effects.has(roundedName),
    'Locking the session must detach all effects and their observers');
Main.sessionMode.isLocked = false; Main.sessionMode.emit('updated');
assert(roundFloat.actor.effects.has(roundedName), 'Unlock must restore only eligible application effects');
roundOther.emit('unmanaging'); windows.splice(windows.indexOf(roundOther), 1);
assert(!ext._corners.windows.has(99) && !roundOther.actor.effects.has(roundedName),
    'Closing a window must detach its effect and release the native actor');
const roundActor = roundFloat.actor; roundActor.destroy();
ext._corners.sync();
assert(!ext._corners.windows.has(98), 'A dying actor must not be reattached before native unmanaging');
roundFloat.actor = null;
assert(!ext._corners.windows.has(98), 'Native actor destruction must release the rounding entry');
roundFloat.actor = new WindowActor(); roundFloat.mapped = false; shellwm.emit('map', roundFloat.actor);
assert(!roundFloat.actor.effects.has(roundedName), 'Early map must wait for a mapped application');
roundFloat.mapped = true; roundFloat.actor.emit('first-frame');
assert(roundFloat.actor.effects.has(roundedName), 'First frame must round a late actor without focus changes');
settings.set_boolean('tiling-enabled', false);
assert(roundFloat.actor.effects.has(roundedName) && w1.actor.effects.has(roundedName),
    'Rounding must be independent of the automatic tiling switch');
const replacementForeign = {};
roundFloat.actor.add_effect_with_name('other-extension-effect', replacementForeign);
settings.set_boolean('round-window-corners', false);
assert(ext._corners.windows.size === 0 && !roundFloat.actor.effects.has(roundedName) &&
    roundFloat.actor.effects.get('other-extension-effect') === replacementForeign,
    'Turning rounding off must synchronously remove only our own effects and observers');
roundFloat.actor.remove_effect(replacementForeign);
for (const win of [roundFloat, roundPopup]) { win.emit('unmanaging'); windows.splice(windows.indexOf(win), 1); }
settings.set_strv('floating-apps', roundRules);
settings.set_boolean('focus-border', true);
settings.set_boolean('tiling-enabled', true); await wait(500);
display.focus_window = w1; display.emit('notify::focus-window');

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
// Opening an exempt app can focus it before its actor is mapped or paint-ready.
const openingFloat = new Window(97);
openingFloat.get_wm_class = () => 'opening.float';
const beforeOpeningRules = settings.get_strv('floating-apps');
settings.set_strv('floating-apps', [...beforeOpeningRules, 'wm-class:opening.float']);
openingFloat.actor = null;
windows.push(openingFloat); display.emit('window-created', openingFloat);
display.focus_window = openingFloat; display.emit('notify::focus-window');
assert(ext._border.widget === null, 'Early focus without an actor must not draw a border');
openingFloat.actor = new WindowActor(); openingFloat.actor.childScale = 0;
shellwm.emit('map', openingFloat.actor);
assert(ext._border.widget === null && openingFloat.actor.handlers.size > 0,
    'Opening at zero scale must keep actor observers while waiting to draw');
openingFloat.actor.childScale = 1; openingFloat.actor.emit('notify::child-transform');
assert(ext._border.widget && ext._border.actor === openingFloat.actor && display.focus_window === openingFloat,
    'Opening transform completion must show border without another focus notification');
const lateSurface = {destroy() { openingFloat.actor.children.delete(this); }};
openingFloat.actor.add_child(lateSurface);
assert([...openingFloat.actor.children].at(-1) === ext._border.widget,
    'A late client surface must not cover the opening focus border');
await wait(100);
assert(ext._controller.records.get(97).state === 'floating' && openingFloat.moves === 0,
    'Opening border recovery must respect floating exceptions and native geometry');
openingFloat.mapped = false; openingFloat.actor.emit('notify::mapped');
assert(ext._border.widget === null && openingFloat.actor.handlers.size > 0,
    'Mapping delay must keep observers without a premature border');
openingFloat.mapped = true; openingFloat.actor.emit('first-frame');
assert(ext._border.widget && openingFloat.moves === 0,
    'First frame must recover the focused border without moving or activating the window');
openingFloat.frame.width = 0; openingFloat.actor.emit('notify::allocation');
assert(ext._border.widget === null, 'An unallocated frame must wait without drawing');
openingFloat.frame.width = 700; openingFloat.actor.emit('notify::allocation');
assert(ext._border.widget, 'Allocation becoming ready must restore the border without a focus change');
openingFloat.actor.childScale = 0; openingFloat.actor.emit('notify::child-transform');
display.focus_window = w1; display.emit('notify::focus-window');
assert(openingFloat.actor.handlers.size === 0 && ext._border.actor === w1.actor,
    'Changing focus while waiting must disconnect the old target');
openingFloat.actor.childScale = 1; openingFloat.actor.emit('first-frame');
assert(ext._border.actor === w1.actor, 'Late frames must never return the border to an unfocused app');
display.focus_window = openingFloat; display.emit('notify::focus-window');
openingFloat.actor.childScale = 0; openingFloat.actor.emit('notify::child-transform');
settings.set_boolean('focus-border', false);
assert(openingFloat.actor.handlers.size === 0 && ext._border.widget === null,
    'Disabling the border while waiting must release pending actor observers');
settings.set_boolean('focus-border', true);
openingFloat.emit('unmanaging'); windows.splice(windows.indexOf(openingFloat), 1);
assert(openingFloat.actor.handlers.size === 0 && ext._border.widget === null,
    'Closing before animation completion must release pending actor observers');
settings.set_strv('floating-apps', beforeOpeningRules);
display.focus_window = w1; display.emit('notify::focus-window');

// A parentless Nautilus portal chooser shares the main window's application identity.
const filesMain = new Window(120), filesChooser = new Window(121);
for (const win of [filesMain, filesChooser]) {
    win.get_gtk_application_id = () => 'org.gnome.Nautilus';
    win.get_gtk_unique_bus_name = () => ':1.13';
    win.get_gtk_application_object_path = () => '/org/gnome/Nautilus';
}
filesMain.get_gtk_window_object_path = () => '/org/gnome/Nautilus/window/1';
for (const win of [filesMain, filesChooser]) {
    windows.push(win); display.emit('window-created', win);
}
await wait(600);
assert(ext._controller.records.get(120).state === 'tiled' && filesMain.moves > 0,
    'Main Files window must tile with the same app identity as its chooser');
assert(ext._controller.records.get(121).reason === 'auxiliary-window' && filesChooser.moves === 0,
    'Unparented chooser must never move or consume a grid slot');
display.focus_window = filesChooser; display.emit('notify::focus-window');
button.menu.open();
assert(!appRuleItem.sensitive && !floatingItem.sensitive && ext._border.actor === filesChooser.actor,
    'Chooser must retain focus decoration without allowing an accidental whole-app exception');
button.menu.close();
for (const win of [filesChooser, filesMain]) {
    win.emit('unmanaging'); windows.splice(windows.indexOf(win), 1);
}
display.focus_window = w1; display.emit('notify::focus-window');

// Preferences and modal dialogs receive a border without entering the grid.
const preferencesDialog = new Window(96);
preferencesDialog.get_window_type = () => Meta.WindowType.DIALOG;
preferencesDialog.get_transient_for = () => w1;
preferencesDialog.is_skip_taskbar = () => true;
windows.push(preferencesDialog); display.emit('window-created', preferencesDialog);
display.focus_window = preferencesDialog; display.emit('notify::focus-window');
assert(ext._border.actor === preferencesDialog.actor && !ext._controller.records.has(96),
    'Focused preferences dialog must receive its border before tiling classification');
await wait(100);
assert(ext._controller.records.get(96).state === 'excluded' && preferencesDialog.moves === 0 &&
    ext._border.actor === preferencesDialog.actor, 'Excluded dialogs must remain untouched and highlighted');
preferencesDialog.flags = Meta.MaximizeFlags.BOTH;
preferencesDialog.emit('notify::maximized-horizontally');
assert(ext._border.widget === null, 'Maximized preferences must have no focus border');
preferencesDialog.flags = 0; preferencesDialog.emit('notify::maximized-horizontally');
assert(ext._border.actor === preferencesDialog.actor, 'Restored preferences must regain their border');
for (const type of [Meta.WindowType.MODAL_DIALOG, Meta.WindowType.UTILITY, Meta.WindowType.NORMAL]) {
    preferencesDialog.get_window_type = () => type; preferencesDialog.emit('notify::window-type');
    assert(ext._border.actor === preferencesDialog.actor, 'Focused application windows must qualify independently');
}
for (const type of [Meta.WindowType.MENU, Meta.WindowType.POPUP_MENU, Meta.WindowType.TOOLTIP,
    Meta.WindowType.NOTIFICATION, Meta.WindowType.DESKTOP, Meta.WindowType.DOCK]) {
    preferencesDialog.get_window_type = () => type; preferencesDialog.emit('notify::window-type');
    assert(ext._border.widget === null, 'System chrome, menus and notifications must not be decorated');
}
preferencesDialog.get_window_type = () => Meta.WindowType.DIALOG;
preferencesDialog.mapped = false; preferencesDialog.emit('notify::mapped');
assert(ext._border.widget === null, 'Unmapped application window must not receive a border');
preferencesDialog.mapped = true; preferencesDialog.emit('notify::mapped');
assert(ext._border.actor === preferencesDialog.actor, 'Mapped dialog should regain the border');
settings.set_boolean('tiling-enabled', false);
assert(ext._border.actor === preferencesDialog.actor, 'Pausing tiling must preserve a dialog focus border');
settings.set_boolean('focus-border', false);
assert(ext._border.widget === null, 'Focus border preference must work while tiling is off');
settings.set_boolean('focus-border', true);
assert(ext._border.actor === preferencesDialog.actor, 'Focus border must work when tiling is off');
preferencesDialog.emit('unmanaging'); windows.splice(windows.indexOf(preferencesDialog), 1);
assert(ext._border.widget === null && preferencesDialog.actor.handlers.size === 0,
    'Closing an unmanaged focused dialog must detach its border and target observers');
display.focus_window = w1; display.emit('notify::focus-window');
assert(borderWidgets.size === 1, 'Turning tiling off must preserve the independent focus border');
settings.set_boolean('tiling-enabled', true); await wait(500);
assert(borderWidgets.size === 1, 'Soft on should recreate border for managed focus');
settings.set_boolean('round-window-corners', true);
const roundedAtDisable = [...ext._corners.windows.values()].map(entry => entry.actor);
assert(roundedAtDisable.length > 0, 'Teardown test must begin with active rounding');
ext.disable();
assert(roundedAtDisable.every(actor => !actor.effects.has(roundedName) && actor.handlers.size === 0),
    'Disabling the extension must synchronously remove shaders and all rounding observers');
settings.set_boolean('round-window-corners', false);
assert(borderWidgets.size === 0 && Main.overview.handlers.size === 0 && Main.sessionMode.handlers.size === 0,
    'Disable leaked border or shell visibility observers');
assert(w1.frame.width === manualFrame.width, 'New management interval must restore its own snapshot');
assert(Main.wm.bindings.size === 0 && display.handlers.size === 0 && shellwm.handlers.size === 0, 'MVP cleanup leaked resources');
assert(w4.handlers.size === 0 && manager.handlers.size === 0, 'MVP workspace cleanup leaked observers');
assert(Main.panel.indicators.size === 0 && button.menu.handlers.size === 0, 'Panel leaked on disable');
assert(floatingItem.handlers.size === 0 && appRuleItem.handlers.size === 0, 'Menu item handlers leaked');

// A direct disable/enable cycle must retain visibility preferences and reclaim all bindings.
settings.set_boolean('hide-panel-icon', true);
ext.enable(); await wait(500);
assert(Main.wm.bindings.size === 9, 'Reload while enabled lost directional keybindings');
assert(!ext._indicator.button.visible && !ext._indicator.button.container.visible,
    'Reload must apply the saved hidden state to the indicator and its panel space');
settings.set_boolean('hide-panel-icon', false);
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
// A real native grab/drop signal must persist the preset through the shared pin setting.
windows.splice(0, windows.length, new Window(110));
const paletteWindow = windows[0];
ext = new JustTiling(); ext.enable(); await wait(300);
display.focus_window = paletteWindow; display.emit('notify::focus-window');
display.emit('grab-op-begin', paletteWindow, Meta.GrabOp.MOVING);
assert(ext._controller.drag, 'A sole compatible tile must support preset dragging');
paletteWindow.frame = {...paletteWindow.frame, x: paletteWindow.frame.x + 100}; paletteWindow.emit('position-changed');
const soloFrame = {...ext._controller.drag.frame};
pointer = {x: 5, y: 600}; ext._preview.sync();
display.emit('grab-op-end', paletteWindow, Meta.GrabOp.MOVING); await wait(100);
assert(ext._controller.records.get(110).state === 'tiled' &&
    JSON.stringify(paletteWindow.frame) === JSON.stringify(soloFrame),
    'Releasing a sole full-area tile outside the palette must restore its original grid frame');
assert(palettes().length === 0 && layoutPreviews().length === 0 && ext._preview.timer === null,
    'Cancelled preset drags must clean up palette, preview and pointer timer');
display.emit('grab-op-begin', paletteWindow, Meta.GrabOp.MOVING);
paletteWindow.frame = {...paletteWindow.frame, x: paletteWindow.frame.x + 100}; paletteWindow.emit('position-changed');
const dropZone = layoutBarGeometry(ext._adapter.area()).zones[0];
pointer = {x: dropZone.hit.x + 3, y: dropZone.hit.y + 3}; ext._preview.sync();
assert(palettes().length === 1 && layoutPreviews().length === 1, 'Preset drop must have a live destination preview');
const presetExpected = presetFrame(dropZone.region, ext._adapter.area(), ext._controller.gaps);
display.emit('grab-op-end', paletteWindow, Meta.GrabOp.MOVING); await wait(100);
assert(Object.keys(JSON.parse(ext._settings.get_string('pinned-layouts')).apps).length === 1 &&
    JSON.stringify(paletteWindow.frame) === JSON.stringify(presetExpected), 'Native drop must persist and apply the selected pin');
assert(palettes().length === 0 && layoutPreviews().length === 0 && ext._preview.timer === null,
    'Ending the drag must remove all preset chrome and stop pointer sampling');
ext._settings.set_string('pinned-layouts', '{"version":1,"apps":{}}');
ext.disable();
assert(Main.uiGroup.children.size === 0 && borderWidgets.size === 0, 'Palette teardown must leave no UI resources');
// A previous UUID activated later must suspend the new extension as well.
ext = new JustTiling(); ext.enable(); await wait(300);
Main.extensionManager.extensions.set('just@trait.com.br', {state: 1});
Main.extensionManager.emit('extension-state-changed');
assert(ext._controller.suspended && !Main.wm.bindings.has('swap-select'),
    'Activating the previous UUID must suspend tiling and release its shortcuts');
ext.disable(); Main.extensionManager.extensions.clear();

// Existing preferences belong to the stable schema/path, not the extension UUID.
// Seed an old installation's customized settings, then load the new extension.
const legacyPreferences = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.justtiling'});
legacyPreferences.set_int('inner-gap', 23); legacyPreferences.set_int('outer-gap', 17);
legacyPreferences.set_boolean('tiling-enabled', false);
legacyPreferences.set_boolean('focus-border', false);
legacyPreferences.set_boolean('learn-layouts', false);
legacyPreferences.set_strv('floating-apps', ['gtk-app-id:org.test.Persistent']);
legacyPreferences.set_strv('cycle-focus', ['<Super><Alt>q']);
legacyPreferences.set_string('learned-layouts', JSON.stringify({version: 1, apps: {
    'app-id:example.desktop': {x: 0, y: 0, width: 0.5, height: 1},
}}));
legacyPreferences.set_int('preferences-version', 4);
const preferenceKeys = legacyPreferences.settings_schema.list_keys();
const previousValues = new Map(preferenceKeys.map(key => [key, legacyPreferences.get_value(key).print(true)]));
Main.extensionManager.extensions.set('o-tiling@test', {state: 1, metadata: {name: 'Other Tiler'}});
ext = new JustTiling(); ext.enable();
assert(messageTray.notifications.size === 0 && !ext._indicator.manager.visible && !ext._controller.suspended,
    'An explicitly disabled tiling preference must not prompt about conflicts');
assert(ext.uuid === 'justtiling@trait.com.br' && Main.panel.indicators.has(ext.uuid) &&
    !Main.panel.indicators.has('just@trait.com.br'), 'New UUID must own the panel entry');
for (const key of preferenceKeys)
    assert(ext._settings.get_value(key).print(true) === previousValues.get(key),
        `UUID migration must preserve preference: ${key}`);
assert(!ext._controller.running && ext._controller.gaps.inner === 23 && ext._controller.gaps.outer === 17 &&
    ext._controller.floatingApps.includes('gtk-app-id:org.test.Persistent') &&
    ext._controller.learnedLayouts['app-id:example.desktop'], 'New UUID must load existing user preferences');
ext.disable();
for (const key of preferenceKeys)
    assert(legacyPreferences.get_value(key).print(true) === previousValues.get(key),
        `Disabling the new UUID must preserve preference: ${key}`);
assert(Main.panel.indicators.size === 0 && display.handlers.size === 0 && Main.modalCount === 0,
    'UUID migration must clean up its UI and observers');
Main.extensionManager.extensions.clear();
assert(messageTray.notifications.size === 0, 'Disabling must leave no conflict notifications');
assert(aboveChanges === 0, 'Extension must never impose or clear native always-on-top flags');
print('Shell adapter smoke OK: lifecycle, workspaces, settings, shortcut migration, conflicts, native-menu doubles, shared-border resizing, native drag swapping, optional focus border doubles, numbered keyboard swaps, initial/manual maximization, restore-to-grid, UUID migration and cleanup.');
