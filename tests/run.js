import {safeLogText} from '../src/logging.js';
import {Monitors} from '../src/monitors.js';
import {PRESETS, presetFrame, layoutBarGeometry, layoutHit, insideBar} from '../src/layout/presets.js';
import {balancedLayout, insertBalanced} from '../src/layout/balance.js';
import {pinnedLayout, withoutReservations} from '../src/pinning.js';
import {NumberChoice} from '../src/numberChoice.js';
// SPDX-License-Identifier: GPL-3.0-or-later
import {ids, insert, remove, sameRect, solve} from '../src/layout/tree.js';
import {ShortcutOverrides} from '../src/shortcutOverrides.js';
import {beginDrag, finishDrag, directionalNeighbor, swapTiles} from '../src/layout/drag.js';
import {beginResize, finishResize, sameSpecs} from '../src/layout/resize.js';
import {describeGrab} from '../src/grab.js';
import {PackageIdentity, packageOwner, desktopFiles} from '../src/packageIdentity.js';
import {applyLearning, readLearning, writeLearning, normalizedFrame, learningIdentity, uniqueLearningKey} from '../src/learning.js';
import {processLineage} from '../src/processInfo.js';
import {Controller} from '../src/controller.js';
import {appIdentities, applicationIdentities, boundedIdentities, constraints, exclusion, focusBorderEligible, matchesApp, setAppException} from '../src/rules.js';
import {clampRect, frameLimits} from '../src/geometry.js';
import {Connections} from '../src/resources.js';
import {canonicalAccelerator, Keybindings} from '../src/keybindings.js';
import {cornerGeometry, cornerRadius, framebufferMapping, cornerPaintVolume} from '../src/cornerGeometry.js';
import {migrateShortcuts} from '../src/settings.js';

import {format, N_} from '../src/strings.js';

let passed = 0;
function assert(value, message = 'Assertion failed') {
    if (!value) throw new Error(message);
}
function equal(a, b) { assert(JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
function test(name, fn) {
    try { fn(); passed++; print(`ok ${passed} - ${name}`); }
    catch (e) { printerr(`FAIL - ${name}\n${e.stack ?? e}`); throw e; }
}

test('translated messages substitute values literally and preserve escaped percentages', () => {
    equal(format('Position: %s%% · %s', 50, '$& <Example>'), 'Position: 50% · $& <Example>');
    equal(N_('English message'), 'English message');
});

const AREA = {x: 0, y: 32, width: 1600, height: 900};
const GAPS = {inner: 8, outer: 8};
const spec = (extra = {}) => ({minWidth: 240, minHeight: 160,
    maxWidth: Infinity, maxHeight: Infinity, ...extra});

function checkPlan(tree, area, specs, gaps = GAPS) {
    const plan = solve(tree, area, specs, gaps);
    assert(plan, 'Layout must fit');
    const entries = [...plan.frames];
    equal(entries.length, ids(tree).length);
    for (const [id, r] of entries) {
        const s = specs.get(id);
        assert(r.width >= s.minWidth && r.height >= s.minHeight);
        assert(r.width <= s.maxWidth && r.height <= s.maxHeight);
        assert(r.x >= area.x && r.y >= area.y);
        assert(r.x + r.width <= area.x + area.width && r.y + r.height <= area.y + area.height);
        for (const [otherId, other] of entries) {
            if (otherId === id) continue;
            assert(r.x + r.width <= other.x || other.x + other.width <= r.x ||
                r.y + r.height <= other.y || other.y + other.height <= r.y, 'No overlap');
        }
    }
    return plan;
}

test('package ownership requires one exact owner and rejects diversions, glob matches and ambiguity', () => {
    equal(packageOwner('openlogi: /usr/bin/openlogi-overlay\n', '/usr/bin/openlogi-overlay'), 'openlogi');
    equal(packageOwner('tool:amd64: /usr/bin/helper\n', '/usr/bin/helper'), 'tool:amd64');
    equal(packageOwner('tool: /usr/bin/other', '/usr/bin/helper'), null);
    equal(packageOwner('one: /usr/bin/helper\ntwo: /usr/bin/helper', '/usr/bin/helper'), null);
    equal(packageOwner('local diversion from: /usr/bin/helper', '/usr/bin/helper'), null);
    equal(desktopFiles('/usr/share/applications/tool.desktop\n/usr/share/doc/readme.desktop\n/usr/share/applications/sub/hidden.desktop\n/usr/share/applications/tool.desktop'),
        ['/usr/share/applications/tool.desktop']);
});
test('process capture follows helper ancestry without reading arguments and tolerates exited processes', () => {
    const status = new Map([[30, 'Name: overlay\nPPid: 20\n'], [20, 'Name: agent\nPPid: 10\n'], [10, 'PPid: 1\n']]);
    equal(processLineage(30, id => status.get(id), id => `/usr/bin/app-${id}`), [
        {pid: 30, parent: 20, executable: '/usr/bin/app-30'},
        {pid: 20, parent: 10, executable: '/usr/bin/app-20'},
        {pid: 10, parent: 1, executable: '/usr/bin/app-10'}]);
    equal(processLineage(0, () => { throw Error(); }, () => { throw Error(); }), []);
    equal(processLineage(99, () => { throw Error(); }, () => { throw Error(); }),
        [{pid: 99, parent: 0, executable: null}]);
    equal(processLineage(10, () => 'PPid: 10', () => null).length, 1);
    equal(processLineage(100, id => `PPid: ${id + 1}`, () => null).length, 12);
});

test('one window fills usable area, without fullscreen', () => {
    const specs = new Map([[1, spec()]]);
    const tree = insert(null, 1, specs, AREA, {inner: 0, outer: 0});
    equal(solve(tree, AREA, specs, {inner: 0, outer: 0}).frames.get(1), AREA);
});
test('insert 1–5; close first, middle, last and only window', () => {
    const specs = new Map();
    let tree = null;
    for (let i = 1; i <= 5; i++) {
        specs.set(i, spec());
        tree = insert(tree, i, specs, AREA, GAPS);
        assert(tree);
        checkPlan(tree, AREA, specs);
    }
    for (const id of [1, 3, 5, 2, 4]) {
        tree = remove(tree, id);
        specs.delete(id);
        checkPlan(tree, AREA, specs);
    }
    equal(tree, null);
});
test('removal promotes sibling and preserves unaffected branches', () => {
    const tree = {axis: 'x', ratio: 0.5, a: {id: 1},
        b: {axis: 'y', ratio: 0.5, a: {id: 2}, b: {id: 3}}};
    assert(remove(tree, 1) === tree.b);
    equal(remove(tree, 2), {axis: 'x', ratio: 0.5, a: {id: 1}, b: {id: 3}});
});
test('incompatible insertion does not mutate original tree', () => {
    const specs = new Map([[1, spec()], [2, spec({minWidth: 2000})]]);
    const tree = {id: 1};
    const before = JSON.stringify(tree);
    equal(insert(tree, 2, specs, AREA, GAPS), null);
    equal(JSON.stringify(tree), before);
});
test('minimum constraints adjust split ratio; alternate axis can fit', () => {
    const specs = new Map([[1, spec({minWidth: 1000})], [2, spec({minWidth: 500})]]);
    const tree = insert({id: 1}, 2, specs, AREA, GAPS);
    equal(tree.axis, 'x');
    checkPlan(tree, AREA, specs);
    specs.set(2, spec({minWidth: 1100}));
    const stacked = insert({id: 1}, 2, specs, AREA, GAPS);
    equal(stacked.axis, 'y');
    checkPlan(stacked, AREA, specs);
});
test('maximum sizes cap frames and center them, rather than rejecting all bounded windows', () => {
    const specs = new Map([[1, spec({maxWidth: 500, maxHeight: 300})]]);
    const {frames} = checkPlan({id: 1}, AREA, specs);
    equal(frames.get(1), {x: 550, y: 332, width: 500, height: 300});
});
test('odd dimensions, portrait, negative origins and no gaps', () => {
    const area = {x: -901, y: -37, width: 901, height: 1801};
    const specs = new Map([[1, spec()], [2, spec()]]);
    const tree = insert({id: 1}, 2, specs, area, {inner: 3, outer: 5});
    equal(tree.axis, 'y');
    const {cells} = checkPlan(tree, area, specs, {inner: 3, outer: 5});
    equal(cells.get(1).height + cells.get(2).height + 3 + 10, area.height);
});
test('invalid area, impossible gaps and inconsistent limits fail closed', () => {
    const specs = new Map([[1, spec({maxWidth: 100})]]);
    equal(solve({id: 1}, AREA, specs), null);
    equal(solve(null, {...AREA, width: NaN}, specs), null);
    equal(solve(null, AREA, specs, {inner: -1, outer: 0}), null);
    equal(solve(null, AREA, specs, {inner: 0, outer: 2000}), null);
});
test('seeded insert/remove sequences preserve fit, uniqueness and determinism', () => {
    function run() {
        let seed = 5678;
        let tree = null;
        let nextId = 0;
        const specs = new Map();
        const history = [];
        const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
        for (let i = 0; i < 600; i++) {
            if (random() < 0.65) {
                const id = ++nextId;
                specs.set(id, spec({minWidth: 240 + Math.floor(random() * 200)}));
                const next = insert(tree, id, specs, AREA, GAPS);
                if (next) tree = next;
                else specs.delete(id);
            } else if (tree) {
                const leaves = ids(tree);
                const id = leaves[Math.floor(random() * leaves.length)];
                tree = remove(tree, id);
                specs.delete(id);
            }
            checkPlan(tree, AREA, specs);
            equal(new Set(ids(tree)).size, ids(tree).length);
            history.push(JSON.stringify(tree));
        }
        return history;
    }
    equal(run(), run());
});

class FakeClock {
    constructor() { this.time = 0; this.next = 0; this.jobs = new Map(); }
    now() { return this.time; }
    after(delay, fn) { const id = ++this.next; this.jobs.set(id, {at: this.time + delay, fn}); return id; }
    cancel(id) { this.jobs.delete(id); }
    run(duration = 10000) {
        const end = this.time + duration;
        let count = 0;
        while (this.jobs.size) {
            const [id, task] = [...this.jobs].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
            if (task.at > end) break;
            assert(++count < 2000, 'Scheduler must become idle');
            this.jobs.delete(id);
            this.time = task.at;
            task.fn();
        }
        this.time = end;
    }
}

class FakeAdapter {
    constructor(clock) {
        this.clock = clock;
        this.windows = new Map();
        this.moves = [];
        this.restores = [];
        this.aboveCalls = [];
        this.messages = [];
        this.monitors = 1;
        this.active = true;
        this.exists = true;
        this.workarea = {...AREA};
    }
    add(id, extra = {}) {
        this.windows.set(id, {alive: true, ready: true, normal: true, transient: false,
            overrideRedirect: false, skipTaskbar: false, sticky: false, inScope: true,
            fullscreen: false, minimized: false, maximized: false, movable: true,
            resizable: true, above: false, rect: {x: 50, y: 80, width: 700, height: 500},
            flags: 0, ...extra});
    }
    list() { return [...this.windows.keys()]; }
    read(id) { const d = this.windows.get(id); return d ? {...d, rect: {...d.rect}} : null; }
    pointer() { return this.point; }
    monitorCount() { return this.monitors; }
    targetActive() { return this.active; }
    targetExists() { return this.exists; }
    area() { return this.workarea; }
    capture(id) { const d = this.read(id); return {rect: {...d.rect}, flags: d.flags}; }
    move(id, rect) {
        const win = this.windows.get(id);
        this.moves.push({id, rect});
        if (win.throws) throw new Error('simulated native resize failure');
        if (win.refuse) return;
        const apply = () => {
            if (!this.windows.has(id)) return;
            win.rect = {...rect};
            this.event?.({kind: 'geometry', id});
        };
        if (win.delay) this.clock.after(win.delay, apply);
        else apply();
    }
    unmaximize(id) {
        const d = this.windows.get(id);
        d.maximized = false;
        d.flags = 0;
        d.rect = d.normalRect ?? {x: 70, y: 90, width: 800, height: 600};
        this.event?.({kind: 'changed', id});
    }
    restore(id, snapshot) {
        this.restores.push(id);
        const d = this.windows.get(id);
        d.rect = {...snapshot.rect};
        d.maximized = Boolean(snapshot.flags);
        d.flags = snapshot.flags;
    }
    above(id, value) {
        this.aboveCalls.push({id, value});
        this.windows.get(id).above = value;
        this.event?.({kind: 'above', id});
    }
    log(level, message) { this.messages.push({level, message}); }
    notice(message) { this.messages.push({level: 'notice', message}); }
}

function setup(windows = [[1, {}]]) {
    const clock = new FakeClock();
    const adapter = new FakeAdapter(clock);
    for (const [id, extra] of windows) adapter.add(id, extra);
    const controller = new Controller(adapter, clock);
    adapter.event = e => controller.event(e);
    controller.start();
    clock.run();
    assert(!adapter.messages.some(m => m.level === 'error'), `No controller error: ${JSON.stringify(adapter.messages)}`);
    return {clock, adapter, controller};
}

function monitorSetup(entries = [[1, 0], [2, 1]]) {
    const clock = new FakeClock(), adapter = new FakeAdapter(clock);
    adapter.monitors = 2;
    adapter.focus = 1; adapter.workspace = 'main'; adapter.primaryOnly = false;
    adapter.areas = [AREA, {x: -1200, y: -100, width: 1200, height: 1600}];
    adapter.monitorArea = index => adapter.areas[index];
    adapter.focusedId = () => adapter.focus;
    adapter.focusWindow = id => { adapter.focus = id; };
    adapter.activeWorkspace = () => adapter.workspace;
    adapter.workspaces = () => ['main', 'other'];
    adapter.workspacesOnlyOnPrimary = () => adapter.primaryOnly;
    adapter.primaryMonitor = () => 0;
    adapter.connectors = ['DP-1', 'HDMI-1'];
    adapter.monitorIdentity = index => ({index, connector: adapter.connectors[index]});
    adapter.preferredMonitor = saved => saved.connector ? Math.max(0, adapter.connectors.slice(0, adapter.monitors).indexOf(saved.connector)) :
        (saved.index < adapter.monitors ? saved.index : 0);
    adapter.moveToMonitor = (id, index) => {
        adapter.windows.get(id).monitor = index;
        adapter.event?.({kind: 'changed', id});
    };
    const read = adapter.read.bind(adapter);
    adapter.read = id => {
        const data = read(id);
        return data && {...data, inScope: data.domain === adapter.workspace};
    };
    for (const [id, monitor, extra] of entries)
        adapter.add(id, {monitor, domain: 'main', appId: `app${id}.desktop`, ...extra});
    const controller = new Monitors(adapter, clock);
    adapter.event = event => controller.event(event);
    controller.start(); clock.run();
    return {controller, adapter, clock};
}
test('multiple monitors tile independently with different origins and portrait geometry', () => {
    const {controller: c, adapter: a, clock} = monitorSetup([[1, 0], [2, 0], [3, 1], [4, 1]]);
    equal(c.workers.size, 2); assert(!c.suspended);
    for (const [id, data] of a.windows) {
        const area = a.areas[data.monitor], rect = data.rect;
        assert(rect.x >= area.x && rect.y >= area.y && rect.x + rect.width <= area.x + area.width &&
            rect.y + rect.height <= area.y + area.height, `Window ${id} outside its monitor`);
        equal(c.records.get(id).state, 'tiled');
    }
    const other = {...a.read(3).rect}; a.windows.delete(2); c.event({kind: 'closed', id: 2}); clock.run();
    equal(a.read(3).rect, other); equal(a.read(1).rect.width, AREA.width - 16);
    c.stop(); equal(clock.jobs.size, 0);
});
test('monitor connection and removal preserve explicit floating choices and resume automatically', () => {
    const {controller: c, adapter: a, clock} = monitorSetup();
    c.toggleWindow(2); clock.run();
    a.windows.get(2).monitor = 0; a.monitors = 1; c.event({kind: 'topology'}); clock.run();
    assert(!c.suspended && c.running && c.workers.size === 1);
    equal(c.records.get(2).override, 'floating'); equal(c.records.get(2).state, 'floating');
    a.monitors = 2; c.event({kind: 'topology'}); clock.run();
    equal(c.workers.size, 2); assert(!c.suspended); c.stop(); equal(clock.jobs.size, 0);
});
test('cross-monitor moves transfer ownership and reflow both grids without old snapshot restoration', () => {
    const {controller: c, adapter: a, clock} = monitorSetup([[1, 0], [2, 0], [3, 1]]);
    a.windows.get(2).monitor = 1; a.windows.get(2).rect.x = -900;
    c.event({kind: 'changed', id: 2}); clock.run();
    assert(!c.workers.get(0).records.has(2) && c.workers.get(1).records.has(2));
    equal(c.records.get(2).state, 'tiled'); equal(a.read(1).rect.width, AREA.width - 16);
    assert(!a.restores.includes(2)); c.stop();
});
test('cross-monitor native dragging waits for release before tiling on the destination', () => {
    const {controller: c, adapter: a, clock} = monitorSetup();
    c.layoutAssistant = true;
    c.event({kind: 'grab-begin', id: 1, grab: {kind: 'move', pointer: true}}); assert(c.drag);
    a.windows.get(1).monitor = 1; a.windows.get(1).rect.x = -900;
    const moves = a.moves.length;
    c.event({kind: 'changed', id: 1}); clock.run(); equal(a.moves.length, moves);
    assert(!c.workers.get(1).records.has(1));
    c.event({kind: 'grab-end', id: 1}); clock.run();
    equal(c.records.get(1).state, 'tiled'); assert(!c.drag && a.read(1).rect.x < 0);
    c.stop();
});
test('fullscreen pauses only its monitor while other monitors keep organizing', () => {
    const {controller: c, adapter: a, clock} = monitorSetup();
    a.windows.get(1).fullscreen = true; c.event({kind: 'changed', id: 1}); clock.run();
    const full = {...a.read(1).rect};
    a.add(3, {monitor: 1, domain: 'main', appId: 'app3.desktop'});
    c.event({kind: 'changed', id: 3}); clock.run();
    equal(c.records.get(3).state, 'tiled'); equal(a.read(1).rect, full); assert(!c.suspended); c.stop();
});
test('secondary monitors stay tiled across primary-only workspace changes', () => {
    const {controller: c, adapter: a, clock} = monitorSetup([[1, 0], [2, 1, {sticky: true}]]);
    a.primaryOnly = true; c.event({kind: 'workspace'}); clock.run();
    equal(c.records.get(2).state, 'tiled'); const frame = {...a.read(2).rect};
    a.workspace = 'other'; c.event({kind: 'workspace'}); clock.run();
    equal(c.records.get(2).state, 'tiled'); equal(a.read(2).rect, frame);
    assert(c.workers.get(0).trees.has('main') && c.workers.get(1).trees.size === 1); c.stop();
});
test('focus cycling and numbered swaps stay on the focused monitor', () => {
    const {controller: c, adapter: a, clock} = monitorSetup([[1, 0], [2, 0], [3, 1], [4, 1]]);
    a.focus = 3; const other = {...a.read(1).rect};
    c.cycleFocus(); equal(a.focus, 4); c.cycleFocus(); equal(a.focus, 3);
    const context = c.numberedSwapContext(); equal(context.targets, [4]);
    assert(c.selectNumberedSwap(context, 1)); clock.run(); equal(a.read(1).rect, other); c.stop();
});
test('pins share application preferences while duplicate monitor instances do not overwrite learning', () => {
    const {controller: c, adapter: a, clock} = monitorSetup([[1, 0], [2, 0], [3, 1, {appId: 'app1.desktop'}]]);
    c.togglePin(1); clock.run(); assert(c.pinnedLayouts['app-id:app1.desktop']);
    equal(c.workers.get(1).pinnedLayouts, c.pinnedLayouts);
    equal(c.workers.get(0).learningWindows().size, 3);
    c.gaps = {inner: 15, outer: 15}; c.schedule(0); clock.run();
    equal(c.workers.get(1).gaps.inner, 15); c.stop(); equal(clock.jobs.size, 0);
});
test('multi-monitor scoping uses workspace identity rather than the primary-only adapter flag', () => {
    const {controller: c, adapter: a, clock} = monitorSetup();
    const read = a.read; a.read = id => { const data = read(id); return data && {...data, inScope: data.monitor === 0}; };
    c.event({kind: 'changed'}); clock.run(); equal(c.records.get(2).state, 'tiled'); c.stop();
});
test('temporary zero-monitor topology parks explicit floating choices until displays return', () => {
    const {controller: c, adapter: a, clock} = monitorSetup();
    c.toggleWindow(1); clock.run();
    a.monitors = 0; c.event({kind: 'topology'}); clock.run();
    equal(c.workers.size, 0); assert(c.parked.has(1) && c.running && !c.suspended);
    a.monitors = 2; c.event({kind: 'topology'}); clock.run();
    equal(c.records.get(1).override, 'floating'); equal(c.records.get(2).state, 'tiled');
    c.stop(); equal(clock.jobs.size, 0);
});
test('automatic space fallbacks are reconsidered after moving to a larger monitor', () => {
    const {controller: c, adapter: a, clock} = monitorSetup();
    const owner = c.workers.get(0); owner.float(owner.records.get(1), 'insufficient-space');
    a.windows.get(1).monitor = 1; c.event({kind: 'changed', id: 1}); clock.run();
    equal(c.records.get(1).state, 'tiled'); c.stop();
});
test('layout palette pins on the secondary monitor using its own work area', () => {
    const {controller: c, adapter: a, clock} = monitorSetup();
    c.layoutAssistant = true; a.focus = 2;
    const first = {...a.read(1).rect};
    c.event({kind: 'grab-begin', id: 2, grab: {kind: 'move', pointer: true}}); assert(c.drag);
    equal(c.drag.area, a.areas[1]); a.windows.get(2).rect.x += 100;
    c.assistantVisible = c.assistantReady = true;
    const zone = layoutBarGeometry(a.areas[1]).zones[0];
    assert(c.presetFits(zone.region) && c.presetPlan(zone.region));
    a.point = {x: zone.hit.x + 2, y: zone.hit.y + 2};
    c.event({kind: 'grab-end', id: 2}); clock.run();
    equal(a.read(2).rect, presetFrame(zone.region, a.areas[1], c.gaps));
    equal(a.read(1).rect, first); assert(c.pinnedLayouts['app-id:app2.desktop']);
    equal(c.pinnedLayouts['app-id:app2.desktop'].monitor, {index: 1, connector: 'HDMI-1'}); c.stop();
});
test('pinned monitor survives serialization and sends reopened windows to the secondary grid', () => {
    const {controller: c, adapter: a, clock} = monitorSetup();
    c.togglePin(2); clock.run();
    const saved = readLearning(writeLearning(c.pinnedLayouts));
    equal(saved['app-id:app2.desktop'].monitor, {index: 1, connector: 'HDMI-1'});
    a.windows.delete(2); c.event({kind: 'closed', id: 2}); clock.run();
    c.pinnedLayouts = saved;
    a.add(3, {monitor: 0, domain: 'main', appId: 'app2.desktop'});
    c.event({kind: 'changed', id: 3}); clock.run();
    equal(a.read(3).monitor, 1); equal(c.owner(3).adapter.index, 1);
    equal(c.records.get(3).state, 'tiled');
    // A later manual move must not be undone by the opening preference.
    a.moveToMonitor(3, 0); clock.run(); equal(a.read(3).monitor, 0);
    c.stop();
    c.pinnedLayouts = saved; c.start(); clock.run(); equal(a.read(3).monitor, 1);
    c.stop();
});
test('missing pinned monitor falls back without overwriting its saved destination', () => {
    const {controller: c, adapter: a, clock} = monitorSetup();
    c.togglePin(2); clock.run(); const saved = writeLearning(c.pinnedLayouts);
    a.windows.delete(2); c.event({kind: 'closed', id: 2}); a.monitors = 1;
    c.event({kind: 'topology'}); clock.run();
    a.add(3, {monitor: 0, domain: 'main', appId: 'app2.desktop'});
    c.event({kind: 'changed', id: 3}); clock.run(); equal(a.read(3).monitor, 0);
    equal(writeLearning(c.pinnedLayouts), saved);
    a.windows.delete(3); c.event({kind: 'closed', id: 3});
    a.monitors = 2; c.event({kind: 'topology'}); clock.run();
    a.add(4, {monitor: 0, domain: 'main', appId: 'app2.desktop'});
    c.event({kind: 'changed', id: 4}); clock.run(); equal(a.read(4).monitor, 1); c.stop();
});
test('disconnecting a pinned monitor releases its reserved region on the primary grid', () => {
    const {controller: c, adapter: a, clock} = monitorSetup([[1, 0], [2, 1], [3, 1]]);
    c.learnLayouts = false; c.preserveFocusedWindow = false;
    c.togglePin(2); clock.run();
    const key = 'app-id:app2.desktop';
    c.pinnedLayouts = {...c.pinnedLayouts, [key]: {...c.pinnedLayouts[key], x: 0, y: 0, width: 0.25, height: 1}};
    c.schedule(0); clock.run(); const saved = writeLearning(c.pinnedLayouts);
    assert(c.workers.get(1).pinGoals().has(2));
    for (const id of [2, 3]) a.windows.get(id).monitor = 0;
    a.monitors = 1; c.event({kind: 'topology'}); clock.run();
    equal(c.workers.get(0).pinGoals().size, 0);
    const areas = [1, 2, 3].map(id => a.read(id).rect.width * a.read(id).rect.height);
    assert(Math.max(...areas) / Math.min(...areas) < 1.06, 'Fallback must balance ordinary windows');
    equal(writeLearning(c.pinnedLayouts), saved);
    // Reconnection does not pull an already-open window across monitors.
    a.monitors = 2; c.event({kind: 'topology'}); clock.run(); equal(a.read(2).monitor, 0);
    a.moveToMonitor(2, 1); clock.run(); assert(c.workers.get(1).pinGoals().has(2));
    equal(writeLearning(c.pinnedLayouts), saved); c.stop();
});
test('saved pin is inactive on another connected monitor and active after connector reordering', () => {
    const {controller: c, adapter: a, clock} = monitorSetup();
    c.togglePin(2); clock.run(); const saved = writeLearning(c.pinnedLayouts);
    a.moveToMonitor(2, 0); clock.run(); equal(c.workers.get(0).pinGoals().size, 0);
    a.connectors.reverse(); c.event({kind: 'topology'}); clock.run();
    assert(c.workers.get(0).pinGoals().has(2)); equal(writeLearning(c.pinnedLayouts), saved); c.stop();
});
test('reopened fallback window has no active pin while its preferred monitor is missing', () => {
    const {controller: c, adapter: a, clock} = monitorSetup();
    c.togglePin(2); clock.run(); const saved = writeLearning(c.pinnedLayouts);
    a.windows.delete(2); c.event({kind: 'closed', id: 2}); a.monitors = 1;
    c.event({kind: 'topology'}); clock.run();
    a.add(3, {monitor: 0, domain: 'main', appId: 'app2.desktop'});
    c.event({kind: 'changed', id: 3}); clock.run();
    equal(c.records.get(3).state, 'tiled'); equal(c.workers.get(0).pinGoals().size, 0);
    equal(writeLearning(c.pinnedLayouts), saved); c.stop();
});
test('pinned connector wins over monitor enumeration changes', () => {
    const {controller: c, adapter: a, clock} = monitorSetup();
    c.togglePin(2); clock.run();
    a.windows.delete(2); c.event({kind: 'closed', id: 2});
    a.connectors.reverse();
    a.add(3, {monitor: 1, domain: 'main', appId: 'app2.desktop'});
    c.event({kind: 'changed', id: 3}); clock.run(); equal(a.read(3).monitor, 0); c.stop();
});
test('old pins remain compatible and never infer an arbitrary monitor', () => {
    const {controller: c, adapter: a, clock} = monitorSetup();
    c.pinnedLayouts = readLearning('{"version":1,"apps":{"app-id:old.desktop":{"x":0,"y":0,"width":1,"height":1}}}');
    a.add(3, {monitor: 1, domain: 'main', appId: 'old.desktop'});
    c.event({kind: 'changed', id: 3}); clock.run(); equal(a.read(3).monitor, 1); c.stop();
});
test('pinned opening waits for readiness and leaves file dialogs and app exceptions alone', () => {
    const {controller: c, adapter: a, clock} = monitorSetup();
    c.togglePin(2); clock.run();
    a.add(3, {monitor: 0, domain: 'main', appId: 'app2.desktop', ready: false});
    c.event({kind: 'changed', id: 3}); clock.run(); equal(a.read(3).monitor, 0);
    a.windows.get(3).ready = true; c.event({kind: 'changed', id: 3}); clock.run(); equal(a.read(3).monitor, 1);
    c.floatingApps = ['app-id:app2.desktop'];
    a.add(4, {monitor: 0, domain: 'main', appId: 'app2.desktop'});
    a.add(5, {monitor: 0, domain: 'main', appId: 'app2.desktop', transient: true});
    c.event({kind: 'changed', id: 4}); clock.run(); equal(a.read(4).monitor, 0); equal(a.read(5).monitor, 0); c.stop();
});
test('new maximized pinned windows reach their saved monitor before joining its grid', () => {
    const {controller: c, adapter: a, clock} = monitorSetup();
    c.togglePin(2); clock.run();
    a.add(3, {monitor: 0, domain: 'main', appId: 'app2.desktop', maximized: true, resizable: false});
    c.event({kind: 'changed', id: 3}); clock.run(); equal(a.read(3).monitor, 1); c.stop();
});
test('invalid monitor metadata is discarded without losing valid pinned geometry', () => {
    for (const monitor of [{index: -1}, {index: 100}, {index: '1'}]) {
        const result = readLearning(writeLearning({'app-id:a': {x: 0, y: 0, width: 1, height: 1, monitor}}));
        assert(result['app-id:a']); assert(!result['app-id:a'].monitor);
    }
});
test('controller tiles automatically and recovers space after closure', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
    equal(ids(c.tree), [1, 2]);
    a.windows.delete(2);
    c.event({kind: 'closed', id: 2});
    clock.run();
    equal(ids(c.tree), [1]);
    equal(a.read(1).rect.width, AREA.width - 16);
    c.stop();
    equal(clock.jobs.size, 0);
});
test('preflight rejection preserves existing tile and creates only per-window floating', () => {
    const {clock, adapter: a, controller: c} = setup();
    const frame = a.read(1).rect;
    const moves = a.moves.length;
    a.add(2, {minWidth: 3000});
    a.add(3, {inScope: false});
    c.event({kind: 'changed', id: 2});
    clock.run();
    equal(a.moves.length, moves);
    equal(a.read(1).rect, frame);
    equal(c.records.get(2).reason, 'insufficient-space');
    assert(!a.read(2).above);
    equal(c.records.get(3).state, 'excluded');
    // More space must not spontaneously reinsert a temporary floating window.
    a.windows.get(2).minWidth = 0;
    c.event({kind: 'changed', id: 2});
    clock.run();
    equal(c.records.get(2).state, 'floating');
    c.stop();
    assert(!a.read(2).above);
    equal(a.restores.includes(2), false);
});
test('floating app exceptions never impose always-on-top or activate helper windows', () => {
    for (const appId of ['floating-one.desktop', 'floating-two.desktop']) {
        const {clock, adapter: a, controller: c} = setup([[1, {appId}], [2, {}]]);
        c.floatingApps = [`app-id:${appId}`, 'app-id:helper.desktop']; c.schedule(0); clock.run();
        equal(c.records.get(1).reason, 'app-exception');
        a.focusedId = () => 1;
        let activations = 0; a.focusWindow = () => activations++;
        const original = {...a.read(1).rect};
        a.add(3, {appId: 'helper.desktop', wmClass: 'arbitrary-osd', rect: {x: 100, y: 100, width: 360, height: 72}});
        c.event({kind: 'changed', id: 3}); clock.run();
        equal(c.records.get(3).reason, 'app-exception'); equal(a.read(1).rect, original);
        assert(!a.read(1).above && !a.read(3).above);
        equal(a.aboveCalls.length, 0); equal(activations, 0);
        c.event({kind: 'geometry', id: 1}); c.event({kind: 'focus', id: 1}); clock.run();
        c.stop(); equal(a.aboveCalls.length, 0);
    }
});
test('explicit user always-on-top choices survive floating rules, fullscreen and disable', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {appId: 'float.desktop', above: true}], [2, {}]]);
    c.floatingApps = ['app-id:float.desktop']; c.schedule(0); clock.run();
    assert(a.read(1).above);
    a.windows.get(2).fullscreen = true; c.event({kind: 'changed', id: 2}); clock.run();
    assert(a.read(1).above); equal(a.aboveCalls.length, 0);
    c.stop(); assert(a.read(1).above); equal(a.aboveCalls.length, 0);
});
test('focus highlighting accepts excluded application windows without tiling or identity readiness', () => {
    const base = {alive: true, mapped: true, appWindow: true, inScope: true};
    assert(focusBorderEligible(base));
    assert(focusBorderEligible({...base, normal: false, transient: true, ready: false,
        resizable: false, skipTaskbar: true, state: 'excluded'}));
    assert(focusBorderEligible({...base, state: 'pending', identityPending: true}));
    assert(focusBorderEligible({...base, state: 'floating', appId: 'any.desktop'}));
});
test('focus highlighting excludes maximized, hidden and system windows', () => {
    const base = {alive: true, mapped: true, appWindow: true, inScope: true};
    for (const flags of [{maximized: true}, {fullscreen: true}, {minimized: true}, {overrideRedirect: true},
        {mapped: false}, {alive: false}, {inScope: false}, {appWindow: false}])
        assert(!focusBorderEligible({...base, ...flags}));
    assert(!focusBorderEligible(null));
});
test('dialogs, transients and special windows never get moved or raised', () => {
    const {adapter: a, controller: c} = setup([[1, {normal: false}], [2, {transient: true}],
        [3, {overrideRedirect: true}], [4, {skipTaskbar: true}], [5, {sticky: true}]]);
    equal(a.moves.length, 0);
    assert([...a.windows.values()].every(d => !d.above));
    c.stop();
});
const chooserMetadata = {gtkAppId: 'org.gnome.Nautilus', gtkApplicationPath: '/org/gnome/Nautilus',
    gtkBusName: ':1.13', gtkWindowPath: null};
test('unparented Nautilus portal selectors stay untouched while main Files windows tile', () => {
    const {adapter: a, controller: c} = setup([[1, {...chooserMetadata,
        gtkWindowPath: '/org/gnome/Nautilus/window/1'}], [2, chooserMetadata]]);
    equal(c.records.get(1).state, 'tiled');
    equal(c.records.get(2).reason, 'auxiliary-window');
    equal(a.moves.filter(move => move.id === 2).length, 0);
    equal(a.read(2).rect, {x: 50, y: 80, width: 700, height: 500});
    c.toggleWindow(2);
    equal(c.records.get(2).state, 'excluded');
    c.stop();
});
test('missing GTK metadata and non-Nautilus windows do not imply a file selector', () => {
    const base = {alive: true, normal: true, inScope: true, movable: true, resizable: true};
    for (const changes of [{gtkAppId: 'org.other.App'}, {gtkApplicationPath: null},
        {gtkBusName: null}, {gtkBusName: 'org.gnome.Nautilus'}, {gtkWindowPath: undefined},
        {gtkWindowPath: '/org/gnome/Nautilus/window/2'}])
        equal(exclusion({...base, ...chooserMetadata, ...changes}), null);
    equal(exclusion({...base, gtkWindowPath: null}), null);
});
test('Nautilus application exceptions still explicitly float its main windows', () => {
    const {controller: c, clock} = setup([[1, {...chooserMetadata, appId: 'org.gnome.Nautilus.desktop',
        gtkWindowPath: '/org/gnome/Nautilus/window/1'}]]);
    c.floatingApps = ['app-id:org.gnome.Nautilus.desktop']; c.schedule(0); clock.run();
    equal(c.records.get(1).state, 'floating');
    c.stop();
});
test('fixed-size normal window floats without changing native stacking or size', () => {
    const {adapter: a, controller: c} = setup([[1, {resizable: false}]]);
    equal(c.records.get(1).reason, 'fixed-size');
    equal(a.moves.length, 0);
    assert(!a.read(1).above);
    c.stop();
    assert(!a.read(1).above);
});
test('unresponsive resize has at most two corrections then restores and floats', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {refuse: true}]]);
    equal(a.moves.length, 3);
    equal(c.records.get(1).reason, 'resize-not-converged');
    equal(a.read(1).rect, {x: 50, y: 80, width: 700, height: 500});
    assert(!a.read(1).above);
    equal(clock.jobs.size, 0);
    c.stop();
});
test('delayed accepted resize converges without retry loops', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {delay: 150}]]);
    equal(c.records.get(1).state, 'tiled');
    equal(a.moves.length, 1);
    equal(clock.jobs.size, 0);
    c.stop();
});
test('native resize exception falls back and other tiles continue', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {throws: true}], [2, {}]]);
    equal(c.records.get(1).reason, 'resize-error');
    equal(ids(c.tree), [2]);
    equal(clock.jobs.size, 0);
    c.stop();
});
test('initial maximization is normalized and normal geometry/flags restore on stop', () => {
    const normalRect = {x: 100, y: 100, width: 800, height: 500};
    const {adapter: a, controller: c} = setup([[1, {maximized: true, flags: 3, normalRect}]]);
    equal(c.records.get(1).state, 'tiled');
    c.stop();
    equal(a.read(1).rect, normalRect);
    equal(a.read(1).flags, 3);
});
test('opening maximized windows normalize before native resize eligibility is checked', () => {
    for (const flags of [1, 2, 3]) {
        const clock = new FakeClock(), a = new FakeAdapter(clock);
        a.add(1, {maximized: true, flags});
        const read = a.read.bind(a);
        a.read = id => { const d = read(id); return d ? {...d, resizable: d.resizable && !d.maximized} : null; };
        const c = new Controller(a, clock); c.start(); clock.run();
        equal(c.records.get(1).state, 'tiled'); assert(!a.read(1).maximized);
        equal(ids(c.tree), [1]); equal(clock.jobs.size, 0); c.stop();
        equal(a.read(1).flags, flags);
    }
});
test('late-ready maximized windows recover without becoming permanent fixed-size exceptions', () => {
    const clock = new FakeClock(), a = new FakeAdapter(clock);
    a.add(1, {ready: false, maximized: true, resizable: false, flags: 3});
    const unmaximize = a.unmaximize.bind(a);
    a.unmaximize = id => { unmaximize(id); a.windows.get(id).resizable = true; };
    const c = new Controller(a, clock); c.start(); clock.run();
    equal(c.records.get(1).reason, 'not-ready'); equal(clock.jobs.size, 0);
    a.windows.get(1).ready = true; c.event({kind: 'geometry', id: 1}); clock.run();
    equal(c.records.get(1).state, 'tiled'); assert(!a.read(1).maximized); c.stop();
});
test('opening maximized windows wait through fullscreen pauses before normalizing', () => {
    const clock = new FakeClock(), a = new FakeAdapter(clock);
    a.add(1, {maximized: true, resizable: false, flags: 3}); a.add(2, {fullscreen: true});
    const unmaximize = a.unmaximize.bind(a);
    let attempts = 0;
    a.unmaximize = id => { attempts++; unmaximize(id); a.windows.get(id).resizable = true; };
    const c = new Controller(a, clock); c.start(); clock.run();
    equal(attempts, 0); equal(c.records.get(1).state, 'pending'); equal(clock.jobs.size, 0);
    a.windows.get(2).fullscreen = false; c.event({kind: 'changed', id: 2}); clock.run();
    equal(c.records.get(1).state, 'tiled'); equal(attempts, 1); c.stop();
});
test('asynchronous unmaximizing during opening waits for native eligibility and converges', () => {
    const clock = new FakeClock(), a = new FakeAdapter(clock);
    a.add(1, {maximized: true, flags: 3, resizable: false});
    let attempts = 0;
    a.unmaximize = id => {
        attempts++;
        clock.after(250, () => {
            Object.assign(a.windows.get(id), {maximized: false, flags: 0});
            c.event({kind: 'changed', id});
        });
        clock.after(350, () => {
            a.windows.get(id).resizable = true; c.event({kind: 'changed', id});
        });
    };
    const c = new Controller(a, clock); c.start(); clock.run();
    equal(c.records.get(1).state, 'tiled'); equal(attempts, 1); equal(clock.jobs.size, 0); c.stop();
});
test('maximized app exceptions and special windows are never normalized into tiling', () => {
    for (const extra of [{appId: 'float.desktop'}, {transient: true}, {fullscreen: true},
        {skipTaskbar: true}, {normal: false}, {inScope: false}, {minimized: true}]) {
        const clock = new FakeClock(), a = new FakeAdapter(clock);
        a.add(1, {maximized: true, resizable: false, flags: 3, ...extra});
        let attempts = 0; a.unmaximize = () => attempts++;
        const c = new Controller(a, clock); c.floatingApps = ['app-id:float.desktop']; c.start(); clock.run();
        equal(attempts, 0); equal(ids(c.tree), []); assert(a.read(1).maximized); c.stop();
    }
});
test('manual maximization of a settled tile floats without restoring or fighting the user', () => {
    const {adapter: a, controller: c, clock} = setup([[1, {}], [2, {}]]);
    const maximizedRect = {...AREA};
    Object.assign(a.windows.get(1), {maximized: true, resizable: false, flags: 3, rect: maximizedRect});
    let attempts = 0; a.unmaximize = () => attempts++;
    const restored = a.restores.length;
    c.event({kind: 'changed', id: 1}); clock.run();
    equal(c.records.get(1).reason, 'user-maximized'); equal(ids(c.tree), [2]);
    equal(a.read(1).rect, maximizedRect); equal(a.read(1).flags, 3);
    equal(attempts, 0); equal(a.restores.length, restored);
    c.event({kind: 'changed', id: 1}); clock.run(); equal(c.records.get(1).state, 'floating'); c.stop();
});
test('restoring a manually maximized tile automatically rejoins without restoring stale geometry', () => {
    const {adapter: a, controller: c, clock} = setup([[1, {}], [2, {}]]);
    Object.assign(a.windows.get(1), {maximized: true, resizable: false, flags: 3, rect: {...AREA}});
    c.event({kind: 'changed', id: 1}); clock.run();
    equal(c.records.get(1).reason, 'user-maximized');
    const restores = a.restores.length;
    Object.assign(a.windows.get(1), {maximized: false, resizable: true, flags: 0,
        rect: {x: 80, y: 70, width: 700, height: 500}});
    c.event({kind: 'geometry', id: 1}); clock.run();
    equal(c.records.get(1).state, 'tiled'); equal(ids(c.tree).sort(), [1, 2]);
    equal(a.restores.length, restores); assert(!a.read(1).above);
    c.stop(); equal(a.read(1).flags, 0);
});
test('restoring maximization respects app rules, manual floating choices and constraints', () => {
    for (const mode of ['application', 'manual', 'minimum', 'fixed']) {
        const {adapter: a, controller: c, clock} = setup([[1, {appId: 'test.desktop'}], [2, {}]]);
        Object.assign(a.windows.get(1), {maximized: true, resizable: false, flags: 3});
        c.event({kind: 'changed', id: 1}); clock.run();
        if (mode === 'application') c.floatingApps = ['app-id:test.desktop'];
        if (mode === 'manual') c.records.get(1).override = 'floating';
        Object.assign(a.windows.get(1), {maximized: false, flags: 0,
            resizable: mode !== 'fixed', minWidth: mode === 'minimum' ? 9000 : 0});
        c.event({kind: 'changed', id: 1}); clock.run();
        equal(c.records.get(1).state, 'floating'); assert(!ids(c.tree).includes(1));
        if (mode === 'minimum') equal(c.records.get(1).reason, 'insufficient-space');
        equal(clock.jobs.size, 0); c.stop();
    }
});
test('opening normalization rechecks real fixed-size and minimum-size constraints', () => {
    for (const mode of ['fixed', 'minimum']) {
        const clock = new FakeClock(), a = new FakeAdapter(clock);
        a.add(1, {maximized: true, flags: 3, resizable: mode !== 'fixed', minWidth: mode === 'minimum' ? 9000 : 0});
        const c = new Controller(a, clock); c.start(); clock.run();
        equal(c.records.get(1).reason, mode === 'fixed' ? 'fixed-size' : 'insufficient-space');
        equal(c.records.get(1).state, 'floating'); equal(ids(c.tree), []); equal(clock.jobs.size, 0); c.stop();
    }
});
test('readiness is retried for a bounded time and can succeed late', () => {
    const clock = new FakeClock();
    const a = new FakeAdapter(clock);
    a.add(1, {ready: false});
    const c = new Controller(a, clock);
    c.start();
    clock.after(500, () => { a.windows.get(1).ready = true; });
    clock.run();
    equal(c.records.get(1).state, 'tiled');
    c.stop();
    const other = setup([[2, {ready: false}]]);
    equal(other.controller.records.get(2).reason, 'not-ready');
    equal(other.clock.jobs.size, 0);
    other.controller.stop();
});
test('a window that becomes ready after the startup deadline is reconsidered automatically', () => {
    const {adapter: a, controller: c, clock} = setup([[1, {ready: false}]]);
    equal(c.records.get(1).reason, 'not-ready');
    equal(clock.jobs.size, 0);
    a.windows.get(1).ready = true;
    c.event({kind: 'changed', id: 1}); clock.run();
    equal(c.records.get(1).state, 'tiled');
    c.stop();
});
test('late readiness through geometry respects app exceptions and manual floating', () => {
    for (const mode of ['automatic', 'application', 'manual']) {
        const {adapter: a, controller: c, clock} = setup([[1, {ready: false, appId: 'late.desktop'}]]);
        if (mode === 'application') c.floatingApps = ['app-id:late.desktop'];
        a.windows.get(1).ready = true;
        if (mode === 'manual') {
            c.toggleWindow(1); // Explicitly tile, then float before the pending pass.
            c.toggleWindow(1);
        }
        c.event({kind: 'geometry', id: 1}); clock.run();
        equal(c.records.get(1).state, mode === 'automatic' ? 'tiled' : 'floating');
        if (mode === 'application') equal(c.records.get(1).reason, 'app-exception');
        if (mode === 'manual') equal(c.records.get(1).reason, 'user-toggle');
        c.stop();
    }
});
test('late readiness still respects minimum sizes and ordinary floating fallbacks', () => {
    const {adapter: a, controller: c, clock} = setup([[1, {ready: false}]]);
    Object.assign(a.windows.get(1), {ready: true, minWidth: 9000});
    c.event({kind: 'changed', id: 1}); clock.run();
    equal(c.records.get(1).reason, 'insufficient-space');
    a.windows.get(1).minWidth = 100;
    c.event({kind: 'geometry', id: 1}); c.event({kind: 'changed', id: 1}); clock.run();
    equal(c.records.get(1).state, 'floating');
    equal(c.records.get(1).reason, 'insufficient-space');
    c.stop();
});
test('unmaximize timeout does not restart when a mapped window emits another event', () => {
    const clock = new FakeClock();
    const a = new FakeAdapter(clock); a.add(1, {maximized: true, resizable: false, flags: 3});
    let attempts = 0; a.unmaximize = () => { attempts++; };
    const c = new Controller(a, clock); c.start(); clock.run();
    equal(c.records.get(1).reason, 'prepare-timeout'); equal(attempts, 1);
    c.event({kind: 'geometry', id: 1}); c.event({kind: 'changed', id: 1}); clock.run();
    equal(c.records.get(1).reason, 'prepare-timeout'); equal(attempts, 1);
    equal(clock.jobs.size, 0); c.stop();
});
test('features unset before mapping do not create a premature fixed-size exception', () => {
    const clock = new FakeClock();
    const a = new FakeAdapter(clock);
    a.add(1, {ready: false, resizable: false, movable: false});
    const c = new Controller(a, clock);
    c.start();
    clock.after(600, () => Object.assign(a.windows.get(1), {ready: true, resizable: true, movable: true}));
    clock.run();
    equal(c.records.get(1).state, 'tiled');
    c.stop();
});
test('minimize/unminimize captures a fresh normal snapshot for the new management interval', () => {
    const {clock, adapter: a, controller: c} = setup();
    a.windows.get(1).minimized = true;
    c.event({kind: 'changed', id: 1}); clock.run();
    const fresh = {x: 90, y: 80, width: 900, height: 600};
    Object.assign(a.windows.get(1), {minimized: false, rect: fresh});
    c.event({kind: 'changed', id: 1}); clock.run();
    c.stop();
    equal(a.read(1).rect, fresh);
});
test('late minimum change releases newest tile with no endless retries', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
    a.windows.get(2).minWidth = 3000;
    c.event({kind: 'geometry', id: 2});
    clock.run();
    equal(ids(c.tree), [1]);
    equal(c.records.get(2).state, 'floating');
    equal(clock.jobs.size, 0);
    c.stop();
});
test('floating movement causes no tile reflow', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {minWidth: 3000}]]);
    const count = a.moves.length;
    a.windows.get(2).rect.x = 100;
    for (let i = 0; i < 100; i++) c.event({kind: 'geometry', id: 2});
    clock.run();
    equal(a.moves.length, count);
    equal(clock.jobs.size, 0);
    c.stop();
});
test('workspace switch pauses geometry; returning preserves tree and updates area', () => {
    const {clock, adapter: a, controller: c} = setup();
    const tree = JSON.stringify(c.tree);
    const count = a.moves.length;
    a.active = false;
    a.workarea = {...AREA, width: 1200};
    c.event({kind: 'workspace'});
    clock.run();
    equal(a.moves.length, count);
    equal(JSON.stringify(c.tree), tree);
    a.active = true;
    c.event({kind: 'workspace'});
    clock.run();
    equal(a.read(1).rect.width, 1184);
    c.stop();
});
test('window leaving target restores and is never moved back to target', () => {
    const {clock, adapter: a, controller: c} = setup();
    a.windows.get(1).inScope = false;
    c.event({kind: 'changed', id: 1});
    clock.run();
    equal(c.tree, null);
    equal(a.restores, [1]);
    equal(c.records.get(1).state, 'excluded');
    c.stop();
});
test('conflict suspension can use an actionable warning without duplicate generic notices', () => {
    const {adapter: a, controller: c} = setup();
    c.suspend('conflict', false);
    assert(c.suspended); equal(a.messages.filter(message => message.level === 'notice').length, 0);
    c.stop();
});
test('second monitor suspends, restores once and never resumes automatically', () => {
    const {clock, adapter: a, controller: c} = setup();
    a.monitors = 2;
    c.event({kind: 'topology'});
    clock.run();
    assert(c.suspended);
    equal(a.restores, [1]);
    const count = a.moves.length;
    a.monitors = 1;
    c.event({kind: 'topology'});
    clock.run();
    equal(a.moves.length, count);
    c.stop();
    equal(a.restores, [1]);
});
test('starting with multiple monitors never mutates a window', () => {
    const clock = new FakeClock();
    const a = new FakeAdapter(clock);
    a.add(1);
    a.monitors = 2;
    const c = new Controller(a, clock);
    c.start(); clock.run();
    assert(c.suspended);
    equal(a.moves.length, 0);
    equal(a.restores.length, 0);
    c.stop();
});
test('grab yields to user geometry and stop does not undo the manual move', () => {
    const {clock, adapter: a, controller: c} = setup();
    c.event({kind: 'grab-begin', id: 1});
    const manual = {x: 100, y: 80, width: 600, height: 400};
    a.windows.get(1).rect = manual;
    c.event({kind: 'geometry', id: 1});
    clock.run();
    c.stop();
    equal(a.read(1).rect, manual);
    equal(a.restores.length, 0);
});
test('floating windows keep native stacking through fullscreen transitions', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {minWidth: 3000}]]);
    assert(!a.read(2).above);
    a.windows.get(1).fullscreen = true;
    c.event({kind: 'changed', id: 1}); clock.run();
    assert(!a.read(2).above);
    a.windows.get(1).fullscreen = false;
    c.event({kind: 'changed', id: 1}); clock.run();
    assert(!a.read(2).above);
    c.stop();
});
test('manual always-on-top decision is preserved', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {minWidth: 3000}]]);
    a.windows.get(1).above = false;
    c.event({kind: 'above', id: 1});
    c.event({kind: 'changed', id: 1}); clock.run();
    assert(!a.read(1).above);
    c.stop();
    const original = setup([[1, {minWidth: 3000, above: true}]]);
    original.controller.stop();
    assert(original.adapter.read(1).above);
});
test('destroyed window and duplicate close events leave no references', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {refuse: true}], [2, {}]]);
    a.windows.delete(1);
    c.event({kind: 'closed', id: 1});
    c.event({kind: 'closed', id: 1}); clock.run();
    assert(!c.records.has(1));
    equal(ids(c.tree), [2]);
    c.stop();
});
test('20 lifecycle cycles cancel queued work and restore snapshots exactly once', () => {
    for (let i = 0; i < 20; i++) {
        const {clock, adapter: a, controller: c} = setup();
        c.event({kind: 'geometry', id: 1});
        c.stop(); c.stop();
        clock.run();
        equal(clock.jobs.size, 0);
        equal(c.records.size, 0);
        equal(a.restores, [1]);
        equal(a.read(1).rect, {x: 50, y: 80, width: 700, height: 500});
    }
});
test('20 open/close cycles leave one valid tile and idle scheduler', () => {
    const {clock, adapter: a, controller: c} = setup();
    for (let i = 2; i <= 21; i++) {
        a.add(i);
        c.event({kind: 'changed', id: i}); clock.run();
        equal(ids(c.tree).length, 2);
        a.windows.delete(i);
        c.event({kind: 'closed', id: i}); clock.run();
        equal(ids(c.tree), [1]);
        equal(clock.jobs.size, 0);
    }
    c.stop();
});
test('frame limits add decoration once, preserve missing bounds and avoid double scaling', () => {
    const convert = (width, height) => ({width: width + 8, height: height + 32});
    equal(frameLimits([true, 500, 300], [true, 900, 0], convert),
        {minWidth: 508, minHeight: 332, maxWidth: 908, maxHeight: Infinity});
    const absent = frameLimits([false, 0, 0], [false, 0, 0], convert);
    assert(absent.maxWidth === Infinity && absent.maxHeight === Infinity);
});
test('restoration clamps negative/offscreen coordinates to current workarea', () => {
    equal(clampRect({x: -3000, y: 3000, width: 2000, height: 500}, AREA),
        {x: 0, y: 432, width: 1600, height: 500});
});
test('rules are data-driven and usability floor does not ignore maximum size', () => {
    equal(exclusion({alive: false}), 'destroyed');
    const s = constraints({minWidth: 0, minHeight: 0, maxWidth: 200});
    assert(s.minWidth > s.maxWidth);
});
test('connection cleanup disconnects all objects even when one is already gone', () => {
    const calls = [];
    const connections = new Connections();
    for (const id of [1, 2]) connections.add({connect: () => id,
        disconnect: value => calls.push(value)}, 'signal', () => {});
    connections.clear(); connections.clear();
    equal(calls, [1, 2]);
});

function workspaceSetup() {
    const clock = new FakeClock();
    const a = new FakeAdapter(clock);
    const first = {name: 'first'};
    const second = {name: 'second'};
    a.current = first;
    a.domains = [first, second];
    a.activeWorkspace = () => a.current;
    a.workspaces = () => a.domains;
    a.targetExists = () => a.domains.includes(a.current);
    const read = a.read.bind(a);
    a.read = id => {
        const d = read(id);
        return d ? {...d, monitor: 0, inScope: d.domain === a.current} : null;
    };
    a.add(1, {domain: first}); a.add(2, {domain: first}); a.add(3, {domain: second});
    const c = new Controller(a, clock);
    a.event = e => c.event(e);
    c.start(); clock.run();
    const select = domain => { a.current = domain; c.event({kind: 'workspace'}); clock.run(); };
    return {clock, a, c, first, second, select};
}

test('workspace switches preserve independent trees without restoring or shuffling tiles', () => {
    const {a, c, first, second, select} = workspaceSetup();
    const firstTree = c.tree;
    const frame1 = a.read(1).rect;
    const moves1 = a.moves.filter(m => m.id === 1).length;
    select(second);
    equal(ids(c.tree), [3]);
    equal(ids(c.trees.get(first)), [1, 2]);
    equal(a.read(1).rect, frame1);
    equal(a.restores, []);
    select(first);
    assert(c.tree === firstTree, 'Workspace switch must not rebuild its tree');
    equal(a.moves.filter(m => m.id === 1).length, moves1);
    c.stop();
    equal(a.restores.sort(), [1, 2, 3]);
});
test('closing a window on an inactive workspace recovers its space on next activation', () => {
    const {clock, a, c, first, second, select} = workspaceSetup();
    select(second);
    const count = a.moves.length;
    a.windows.delete(1); c.event({kind: 'closed', id: 1}); clock.run();
    equal(a.moves.length, count);
    equal(ids(c.trees.get(first)), [2]);
    select(first);
    equal(a.read(2).rect.width, 1584);
    c.stop();
});
test('workspace transfer removes old ownership before inserting into destination', () => {
    const {clock, a, c, first, second, select} = workspaceSetup();
    a.windows.get(1).domain = second;
    c.event({kind: 'changed', id: 1}); clock.run();
    equal(ids(c.trees.get(first)), [2]);
    equal(a.read(2).rect.width, 1584);
    equal(a.restores, [1]);
    select(second);
    assert(ids(c.tree).includes(1));
    equal([...c.trees.values()].flatMap(ids).filter(id => id === 1).length, 1);
    c.stop();
    equal(a.read(1).rect, {x: 50, y: 80, width: 700, height: 500});
});
test('workspace reorder uses object identity and removal prunes old domain state', () => {
    const {clock, a, c, first, second, select} = workspaceSetup();
    a.domains = [second, first];
    c.event({kind: 'workspace'}); clock.run();
    equal(ids(c.trees.get(first)), [1, 2]);
    select(second);
    a.domains = [second];
    for (const id of [1, 2]) a.windows.get(id).domain = second;
    c.event({kind: 'workspace'}); clock.run();
    assert(!c.trees.has(first));
    equal(ids(c.tree).length, 3);
    c.stop();
});
test('automatic floating exception follows a window between workspaces', () => {
    const {clock, a, c, first, second, select} = workspaceSetup();
    a.add(4, {domain: first, minWidth: 3000});
    c.event({kind: 'changed', id: 4}); clock.run();
    equal(c.records.get(4).state, 'floating');
    Object.assign(a.windows.get(4), {domain: second, minWidth: 0});
    select(second);
    equal(c.records.get(4).state, 'floating');
    assert(!ids(c.tree).includes(4));
    assert(!a.read(4).above);
    c.stop();
});
test('app exceptions use exact namespaced IDs, without titles or cross-namespace matching', () => {
    const d = {wmClass: 'org.example.Editor', wmInstance: '', sandboxId: null,
        gtkAppId: 'org.example.Editor', title: 'org.example.Secret'};
    equal(appIdentities(d), ['wm-class:org.example.Editor', 'gtk-app-id:org.example.Editor']);
    assert(matchesApp(d, ['wm-class:org.example.Editor']));
    assert(!matchesApp(d, ['wm-class:org.example.editor', 'sandbox-id:org.example.Editor']));
});
test('changing app rules releases existing windows and removal can reinsert only app-rule floats', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {wmClass: 'Editor'}], [2, {minWidth: 3000}]]);
    c.floatingApps = ['wm-class:Editor']; c.schedule(0); clock.run();
    equal(c.records.get(1).reason, 'app-exception');
    equal(a.read(1).rect.width, 700);
    c.floatingApps = []; c.schedule(0); clock.run();
    equal(c.records.get(1).state, 'tiled');
    equal(c.records.get(2).reason, 'insufficient-space');
    c.stop();
});
test('floating shortcut restores normal geometry and overrides app default for only one window', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {wmClass: 'Editor'}], [2, {wmClass: 'Editor'}]]);
    c.toggleWindow(1); clock.run();
    equal(c.records.get(1).state, 'floating');
    equal(a.read(1).rect.width, 700);
    assert(!a.read(1).above);
    c.floatingApps = ['wm-class:Editor']; c.schedule(0); clock.run();
    c.toggleWindow(1); clock.run();
    equal(c.records.get(1).state, 'tiled');
    equal(c.records.get(2).reason, 'app-exception');
    equal(c.floatingApps, ['wm-class:Editor']);
    c.stop();
});
test('floating shortcut cannot force invalid constraints or dialogs into the tree', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {minWidth: 3000}], [2, {normal: false}]]);
    c.toggleWindow(1); c.toggleWindow(2); clock.run();
    equal(c.tree, null);
    equal(c.records.get(1).reason, 'insufficient-space');
    equal(c.records.get(2).state, 'excluded');
    assert(a.messages.some(m => m.level === 'notice'));
    c.stop();
});
test('manual floating override survives minimize and unminimize', () => {
    const {clock, adapter: a, controller: c} = setup();
    c.toggleWindow(1); clock.run();
    a.windows.get(1).minimized = true; c.event({kind: 'changed', id: 1}); clock.run();
    a.windows.get(1).minimized = false; c.event({kind: 'changed', id: 1}); clock.run();
    equal(c.records.get(1).state, 'floating');
    equal(c.tree, null);
    c.stop();
});
test('soft off stops all geometry and starts a fresh capture when explicitly enabled', () => {
    const {clock, adapter: a, controller: c} = setup();
    c.stop();
    const count = a.moves.length;
    const frame = {x: 130, y: 140, width: 900, height: 600};
    a.windows.get(1).rect = {...frame};
    c.event({kind: 'geometry', id: 1}); clock.run();
    equal(a.moves.length, count);
    c.start(); clock.run();
    equal(c.records.get(1).state, 'tiled');
    c.stop();
    equal(a.read(1).rect, frame);
});
test('explicit restart after topology suspension discards stale tiled state', () => {
    const {clock, adapter: a, controller: c} = setup();
    a.monitors = 2; c.event({kind: 'topology'}); clock.run();
    a.monitors = 1; c.start(); clock.run();
    assert(!c.suspended);
    equal(ids(c.tree), [1]);
    equal(a.read(1).rect.width, 1584);
    c.stop();
});
test('shortcut normalization recognizes reordered modifiers and Ctrl/Primary aliases', () => {
    equal(canonicalAccelerator('<Super><Control><Alt>T'), canonicalAccelerator('<Alt><Primary><Super>t'));
    equal(canonicalAccelerator(''), null);
    equal(canonicalAccelerator('<Super>'), null);
});
test('shortcut conflicts refuse registration and never modify system settings', () => {
    const active = new Map();
    const notices = [];
    const sources = [{schema: 'system', key: 'existing', accelerators: ['<Super><Control><Alt>t']}];
    const backend = {shortcutSources: () => sources,
        bindShortcut: (name, _settings, action) => { active.set(name, action); return true; },
        unbindShortcut: name => active.delete(name), notice: message => notices.push(message), log: () => {}};
    const values = {'toggle-tiling': ['<Alt><Primary><Super>T'], 'toggle-floating': ['<Super><Alt><Control>f']};
    let calls = 0;
    const keys = new Keybindings(backend, {get_strv: name => values[name]},
        {'toggle-tiling': () => calls++, 'toggle-floating': () => calls++});
    const original = JSON.stringify(sources);
    keys.refresh();
    assert(!active.has('toggle-tiling') && active.has('toggle-floating'));
    active.get('toggle-floating')(); equal(calls, 1);
    keys.refresh(); equal(notices.length, 1);
    values['toggle-tiling'] = ['<Super><Control><Alt>y']; keys.refresh();
    assert(active.has('toggle-tiling'));
    equal(JSON.stringify(sources), original);
    keys.dispose(); equal(active.size, 0);
});
test('duplicate own shortcuts and compositor refusal do not leak bindings', () => {
    const active = new Set();
    const backend = {shortcutSources: () => [], bindShortcut: name => {active.add(name); return true;},
        unbindShortcut: name => active.delete(name), notice: () => {}, log: () => {}};
    const keys = new Keybindings(backend, {get_strv: () => ['<Super>t']}, {one: () => {}, two: () => {}});
    keys.refresh(); equal([...active], ['one']);
    keys.dispose();
    backend.bindShortcut = () => false;
    keys.refresh(); equal(keys.active.size, 0);
    keys.dispose();
});

function migrationSettings(values = {}) {
    const saved = new Map(Object.entries(values));
    const defaults = {'toggle-pin': ['<Super>y'], 'toggle-tiling': ['<Super>t'], 'toggle-floating': ['<Super>g'], 'cycle-focus': ['<Super>f'], 'swap-select': ['<Super>c']};
    return {
        saved, get_int: key => saved.get(key) ?? 0, set_int: (key, value) => saved.set(key, value),
        get_user_value: key => saved.has(key) ? {} : null,
        get_strv: key => saved.get(key) ?? defaults[key] ?? [], set_strv: (key, value) => saved.set(key, value),
    };
}
test('shortcut migration upgrades only known legacy overrides', () => {
    const settings = migrationSettings({'toggle-tiling': ['<Alt><Control><Super>t'],
        'toggle-floating': ['<Super><Control><Alt>f']});
    migrateShortcuts(settings);
    equal(settings.get_strv('toggle-tiling'), ['<Super>t']);
    equal(settings.get_strv('toggle-floating'), ['<Super>g']);
    equal(settings.get_int('preferences-version'), 4);
});
test('shortcut migration preserves customized, empty and multiple accelerators', () => {
    for (const value of [[], ['<Super>g'], ['<Super><Control><Alt>f', '<Super>g']]) {
        const settings = migrationSettings({'toggle-floating': value});
        migrateShortcuts(settings);
        equal(settings.get_strv('toggle-floating'), value);
        assert(!settings.saved.has('toggle-tiling'), 'Schema default need not be written');
    }
});
test('shortcut migration runs once and respects a later explicit legacy combination', () => {
    const settings = migrationSettings();
    migrateShortcuts(settings);
    settings.set_strv('toggle-tiling', ['<Super><Control><Alt>t']);
    migrateShortcuts(settings);
    equal(settings.get_strv('toggle-tiling'), ['<Super><Control><Alt>t']);
});
test('panel app exception selection prefers stable application IDs and avoids duplicates', () => {
    const d = {wmClass: 'Editor', wmInstance: 'Editor-1', gtkAppId: 'org.test.Editor', sandboxId: 'org.test.Sandbox'};
    equal(setAppException([], d, true), ['sandbox-id:org.test.Sandbox']);
    equal(setAppException(['wm-class:Editor'], d, true), ['wm-class:Editor']);
    equal(setAppException(['wm-class:Other', 'wm-class:Editor', 'gtk-app-id:org.test.Editor'], d, false), ['wm-class:Other']);
    equal(setAppException(['wm-class:Other'], {}, true), ['wm-class:Other']);
});
test('explicit app menu action clears only matching tiled overrides', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {wmClass: 'Editor'}], [2, {wmClass: 'Other'}]]);
    c.records.get(1).override = 'tiled'; c.records.get(2).override = 'tiled';
    c.floatingApps = ['wm-class:Editor'];
    c.applyAppRule(a.read(1)); clock.run();
    equal(c.records.get(1).reason, 'app-exception');
    equal(c.records.get(2).state, 'tiled');
    equal(c.records.get(2).override, 'tiled');
    c.stop();
});


const pair = axis => ({axis, ratio: 0.5, a: {id: 1}, b: {id: 2}});
const pairSpecs = () => new Map([[1, spec()], [2, spec()]]);
test('shared east/west and south/north edges resize the same split, preserving anchors', () => {
    for (const [axis, edge, id, delta] of [['x', 'east', 1, 101], ['x', 'west', 2, -101],
        ['y', 'south', 1, 73], ['y', 'north', 2, -73]]) {
        const tree = pair(axis), specs = pairSpecs();
        const initial = solve(tree, AREA, specs, GAPS).frames.get(id);
        const context = beginResize(tree, id, [edge], initial, AREA, specs, GAPS);
        assert(context);
        const frame = {...initial};
        const dim = axis === 'x' ? 'width' : 'height';
        if (id === 1) frame[dim] += delta;
        else { frame[axis] += delta; frame[dim] -= delta; }
        const result = finishResize(context, frame);
        assert(result);
        equal(result.plan.frames.get(id), frame);
        checkPlan(result.tree, AREA, specs);
        equal(tree.ratio, 0.5);
        assert(result.tree.a === tree.a && result.tree.b === tree.b);
    }
});
test('nested corner resize adjusts nearest shared ancestors on both axes', () => {
    const tree = {axis: 'x', ratio: 0.5, a: pair('y'), b: {id: 3}};
    const specs = new Map([[1, spec()], [2, spec()], [3, spec()]]);
    const frame = solve(tree, AREA, specs, GAPS).frames.get(1);
    const context = beginResize(tree, 1, ['east', 'south'], frame, AREA, specs, GAPS);
    assert(context);
    const resized = {...frame, width: frame.width + 110, height: frame.height + 60};
    const result = finishResize(context, resized);
    assert(result);
    equal(result.plan.frames.get(1), resized);
    equal(result.plan.frames.get(2).width, resized.width);
    assert(result.tree.b === tree.b);
    checkPlan(result.tree, AREA, specs);
});
test('nearest same-axis boundary wins and keeps an unrelated branch unchanged', () => {
    const tree = {axis: 'x', ratio: 0.6, a: pair('x'), b: {id: 3}};
    const specs = new Map([[1, spec()], [2, spec()], [3, spec()]]);
    const plan = solve(tree, AREA, specs, GAPS), frame = plan.frames.get(1);
    const context = beginResize(tree, 1, ['east'], frame, AREA, specs, GAPS);
    const result = finishResize(context, {...frame, width: frame.width + 50});
    assert(result);
    equal(result.tree.ratio, tree.ratio);
    equal(result.plan.frames.get(3), plan.frames.get(3));
    checkPlan(result.tree, AREA, specs);
});
test('split resize clamps to both subtree minima, including extreme native sizes', () => {
    for (const width of [1, 99999]) {
        const specs = pairSpecs(), tree = pair('x');
        const frame = solve(tree, AREA, specs, GAPS).frames.get(1);
        const context = beginResize(tree, 1, ['east'], frame, AREA, specs, GAPS);
        const result = finishResize(context, {...frame, width});
        assert(result);
        checkPlan(result.tree, AREA, specs);
        equal(result.plan.frames.get(width === 1 ? 1 : 2).width, 240);
    }
});
test('outer edges, centered capped frames, unsettled geometry and invalid edges decline resizing', () => {
    const tree = pair('x'), specs = pairSpecs();
    const frame = solve(tree, AREA, specs, GAPS).frames.get(1);
    for (const edges of [['west'], ['north'], ['east', 'south'], [], ['east', 'west'], ['bad']])
        equal(beginResize(tree, 1, edges, frame, AREA, specs, GAPS), null);
    equal(beginResize(tree, 1, ['east'], {...frame, width: frame.width - 30}, AREA, specs, GAPS), null);
    specs.set(1, spec({maxWidth: 500}));
    const capped = solve(tree, AREA, specs, GAPS).frames.get(1);
    equal(beginResize(tree, 1, ['east'], capped, AREA, specs, GAPS), null);
});
test('cancelled resize keeps tree identity; native move or snap declines without mutation', () => {
    const specs = pairSpecs(), tree = pair('x');
    const frame = solve(tree, AREA, specs, GAPS).frames.get(1);
    const context = beginResize(tree, 1, ['east'], frame, AREA, specs, GAPS);
    assert(finishResize(context, frame).tree === tree);
    for (const changed of [{x: frame.x + 20}, {height: frame.height - 20}, {width: NaN}, {width: -1}])
        equal(finishResize(context, {...frame, ...changed}), null);
    equal(tree.ratio, 0.5);
});
test('odd split dimensions retain exact pixel sizes over repeated resize round trips', () => {
    const area = {x: -123, y: 37, width: 1601, height: 903}, specs = pairSpecs();
    let tree = pair('x');
    for (let i = 0; i < 200; i++) {
        const frame = solve(tree, area, specs, GAPS).frames.get(1);
        const desired = {...frame, width: 300 + (i * 71) % 900};
        const result = finishResize(beginResize(tree, 1, ['east'], frame, area, specs, GAPS), desired);
        assert(result);
        equal(result.plan.frames.get(1), desired);
        tree = result.tree;
        checkPlan(tree, area, specs);
    }
});
test('grab decoding uses named mouse and keyboard enums; unknown operations yield to native behavior', () => {
    equal(describeGrab(47, {RESIZING_SE: 47}), {kind: 'resize', edges: ['south', 'east']});
    equal(describeGrab(81, {KEYBOARD_RESIZING_W: 81}), {kind: 'resize', edges: ['west']});
    equal(describeGrab(undefined, {}), {kind: 'move', edges: []});
    equal(describeGrab(3, {MOVING: 3}), {kind: 'move', edges: [], pointer: true});
    equal(describeGrab(4, {KEYBOARD_MOVING: 4}), {kind: 'move', edges: []});
    assert(sameSpecs(pairSpecs(), pairSpecs()));
    assert(!sameSpecs(pairSpecs(), new Map([[1, spec()], [2, spec({minWidth: 300})]])));
});

const beginEast = c => c.event({kind: 'grab-begin', id: 1, grab: {kind: 'resize', edges: ['east']}});
const endEast = c => c.event({kind: 'grab-end', id: 1});
test('native drag never triggers geometry corrections; release updates both tiles and persists ratio', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
    const original = a.read(1).rect, moves = a.moves.length;
    beginEast(c); assert(c.resize);
    a.windows.get(1).rect.width += 100;
    c.event({kind: 'geometry', id: 1}); clock.run();
    equal(a.moves.length, moves); equal(clock.jobs.size, 0);
    endEast(c); clock.run();
    equal(a.read(1).rect.width, original.width + 100);
    equal(a.read(2).rect.width, original.width - 100);
    equal(c.records.get(1).state, 'tiled'); assert(!a.read(1).above);
    const ratio = c.tree.ratio;
    c.event({kind: 'changed'}); clock.run(); equal(c.tree.ratio, ratio);
    c.stop(); equal(a.read(1).rect.width, 700); equal(clock.jobs.size, 0);
});
test('new window insertion waits for native resize to finish', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
    beginEast(c); a.add(3); c.event({kind: 'opened', id: 3}); clock.run();
    equal(ids(c.tree), [1, 2]); assert(!c.records.has(3));
    endEast(c); clock.run();
    assert(ids(c.tree).includes(3)); equal(c.records.get(1).state, 'tiled'); c.stop();
});
test('disabled split resize and outer edges use the existing floating fallback', () => {
    for (const mode of ['disabled', 'outer']) {
        const {clock, controller: c} = setup([[1, {}], [2, {}]]);
        c.resizeSplits = mode !== 'disabled';
        c.event({kind: 'grab-begin', id: 1, grab: {kind: 'resize', edges: [mode === 'outer' ? 'west' : 'east']}});
        equal(c.resize, null); equal(c.records.get(1).state, 'floating');
        endEast(c); clock.run(); c.stop();
    }
});
test('area, gaps, rules, hint and preference changes cancel resizing without undoing user geometry', () => {
    for (const change of [a => a.workarea.width -= 100,
        (a, c) => c.gaps = {inner: 12, outer: 8},
        (a, c) => c.floatingApps = ['wm-class:Other'],
        a => a.windows.get(2).minWidth = 400,
        (a, c) => c.resizeSplits = false]) {
        const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
        beginEast(c); a.windows.get(1).rect.width += 70;
        const manual = a.read(1).rect;
        change(a, c); c.event({kind: 'changed'}); clock.run();
        equal(c.resize, null); equal(c.records.get(1).state, 'floating');
        equal(a.read(1).rect, manual);
        endEast(c); clock.run(); c.stop(); equal(a.read(1).rect, manual);
    }
});
test('closing either participant during drag leaves no stale resize or resurrected window', () => {
    for (const id of [1, 2]) {
        const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
        beginEast(c); a.windows.delete(id); c.event({kind: 'closed', id}); clock.run();
        equal(c.resize, null); assert(!ids(c.tree).includes(id));
        assert(!c.records.has(id)); endEast(c); clock.run(); c.stop(); equal(clock.jobs.size, 0);
    }
});
test('disable and topology suspension during native resize preserve grabbed geometry and clean timers', () => {
    for (const suspend of [false, true]) {
        const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
        beginEast(c); a.windows.get(1).rect.width += 90;
        const manual = a.read(1).rect;
        if (suspend) { a.monitors = 2; c.event({kind: 'changed'}); clock.run(); }
        else c.stop();
        equal(c.resize, null); equal(a.read(1).rect, manual);
        equal(a.read(2).rect.width, 700); equal(clock.jobs.size, 0);
        endEast(c); clock.run(); equal(a.read(1).rect, manual); c.stop();
    }
});
test('native snap during shared-border resize falls back to floating instead of fighting it', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
    beginEast(c); a.windows.get(1).rect = {x: 0, y: 0, width: 800, height: 900};
    const snapped = a.read(1).rect;
    endEast(c); clock.run(); equal(c.resize, null);
    equal(c.records.get(1).state, 'floating'); equal(a.read(1).rect, snapped); c.stop();
});
test('workspace change during a drag cancels old split ownership without moving the grabbed window', () => {
    const {clock, a, c, first, second, select} = workspaceSetup();
    beginEast(c); a.windows.get(1).rect.width += 80;
    const manual = a.read(1).rect;
    select(second); equal(c.resize, null); equal(a.read(1).rect, manual);
    equal(ids(c.trees.get(first)), [2]); equal(ids(c.tree), [3]);
    endEast(c); clock.run(); select(first);
    equal(c.records.get(1).state, 'floating'); equal(a.read(1).rect, manual); c.stop();
});
test('native minimum overrun clamps both tiles and a cancelled drag keeps its proportion', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {minWidth: 600}]]);
    const tree = c.tree;
    beginEast(c); endEast(c); clock.run(); assert(c.tree === tree);
    beginEast(c); a.windows.get(1).rect.width = 1500;
    endEast(c); clock.run();
    equal(a.read(2).rect.width, 600); equal(a.read(1).rect.width, 976);
    equal(c.records.get(1).state, 'tiled'); c.stop();
});
test('neighbor refusing its new size after resize gets bounded corrections then floating', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
    beginEast(c); a.windows.get(1).rect.width += 90; a.windows.get(2).refuse = true;
    const moves = a.moves.filter(m => m.id === 2).length;
    endEast(c); clock.run();
    equal(a.moves.filter(m => m.id === 2).length - moves, 3);
    equal(c.records.get(2).reason, 'resize-not-converged');
    equal(c.records.get(1).state, 'tiled'); equal(clock.jobs.size, 0); c.stop();
});


const center = r => ({x: r.x + r.width / 2, y: r.y + r.height / 2});
function dragContext(tree = pair('x'), specs = pairSpecs()) {
    const plan = solve(tree, AREA, specs, GAPS);
    return beginDrag(tree, 1, plan.frames, AREA, specs, GAPS);
}
const translated = frame => ({...frame, x: frame.x + 100, y: frame.y + 100});
const beginMove = c => c.event({kind: 'grab-begin', id: 1, grab: {kind: 'move', pointer: true}});
const endMove = c => c.event({kind: 'grab-end', id: 1});
test('drop exchanges IDs across branches while preserving split ratios and unaffected branches', () => {
    const branch = {axis: 'y', ratio: 0.6, a: {id: 3}, b: {id: 4}};
    const tree = {axis: 'x', ratio: 0.6, a: pair('y'), b: branch};
    const specs = new Map([1, 2, 3, 4].map(id => [id, spec()]));
    const context = dragContext(tree, specs), before = JSON.stringify(tree);
    const result = finishDrag(context, translated(context.frame), center(context.plan.frames.get(3)));
    equal(ids(result.tree), [3, 2, 1, 4]);
    equal(result.tree.ratio, tree.ratio); equal(result.tree.b.ratio, branch.ratio);
    assert(result.tree.a.b === tree.a.b && result.tree.b.b === tree.b.b);
    equal(JSON.stringify(tree), before); checkPlan(result.tree, AREA, specs);
});
test('dropping on own tile, clicking and Escape retain the existing tree', () => {
    const context = dragContext();
    for (const [frame, point] of [[context.frame, {x: -999, y: -999}],
        [{...context.frame, x: context.frame.x + 3}, null],
        [translated(context.frame), center(context.frame)]]) {
        assert(finishDrag(context, frame, point).tree === context.tree);
    }
});
test('drop excludes gaps, outer margins and blank capped-cell space', () => {
    const specs = pairSpecs(); specs.set(2, spec({maxWidth: 400, maxHeight: 300}));
    const context = dragContext(pair('x'), specs);
    const cell = context.plan.cells.get(2);
    for (const point of [{x: -1, y: 100}, {x: 0, y: 32},
        {x: context.frame.x + context.frame.width + 1, y: 100},
        {x: cell.x + 1, y: cell.y + 1}, {x: NaN, y: 50}, null])
        equal(finishDrag(context, translated(context.frame), point), null);
});
test('swap rejects a minimum incompatible with either destination without shifting boundaries', () => {
    for (const reverse of [false, true]) {
        const tree = {...pair('x'), ratio: reverse ? 0.7 : 0.3};
        const specs = pairSpecs(); specs.set(reverse ? 1 : 2, spec({minWidth: 900}));
        const context = dragContext(tree, specs);
        assert(context);
        equal(finishDrag(context, translated(context.frame), center(context.plan.frames.get(2))), null);
    }
});
test('drag requires two settled tiles and rejects native size changes', () => {
    const specs = pairSpecs(), tree = pair('x');
    const plan = solve(tree, AREA, specs, GAPS);
    equal(beginDrag({id: 1}, 1, plan.frames, AREA, specs, GAPS), null);
    const frames = new Map(plan.frames); frames.set(2, {...frames.get(2), x: 100});
    equal(beginDrag(tree, 1, frames, AREA, specs, GAPS), null);
    const context = dragContext();
    for (const changes of [{width: context.frame.width - 20}, {x: Infinity}])
        equal(finishDrag(context, {...translated(context.frame), ...changes}, center(plan.frames.get(2))), null);
});
test('mouse drag freezes geometry until release then exchanges both tiles and restores snapshots on stop', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
    const first = a.read(1).rect, second = a.read(2).rect, before = a.moves.length;
    beginMove(c); assert(c.drag); equal(c.records.get(1).state, 'tiled');
    a.windows.get(1).rect = translated(first); a.point = center(second);
    c.event({kind: 'geometry', id: 1}); clock.run();
    equal(a.moves.length, before); equal(clock.jobs.size, 0);
    endMove(c); clock.run(); equal(c.drag, null);
    equal(ids(c.tree), [2, 1]); equal(a.read(1).rect, second); equal(a.read(2).rect, first);
    assert(!a.read(1).above); c.stop(); equal(a.read(1).rect.width, 700); equal(a.read(2).rect.width, 700);
});
test('drag preview selects only a valid destination without moving windows or learning', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
    const tree = c.tree, moves = a.moves.length, learned = JSON.stringify(c.learnedLayouts);
    const first = a.read(1).rect, second = a.read(2).rect;
    beginMove(c);
    equal(c.previewDrag(center(second)), null); // No movement yet.
    a.windows.get(1).rect = translated(first);
    equal(c.previewDrag(center(second)), 2);
    equal(c.previewDrag(center(first)), null);
    equal(c.previewDrag({x: 1, y: 1}), null);
    equal(c.previewDrag(null), null);
    assert(c.tree === tree); equal(a.moves.length, moves);
    equal(JSON.stringify(c.learnedLayouts), learned); equal(c.learningPending, null);
    equal(clock.jobs.size, 0); c.stop();
    equal(c.previewDrag(center(second)), null);
});
test('drag preview rejects stale context, keyboard movement and disabled swaps', () => {
    for (const mode of ['area', 'gaps', 'rules', 'hints', 'disabled', 'keyboard', 'workspace']) {
        const {adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
        const first = a.read(1).rect, second = a.read(2).rect;
        if (mode === 'keyboard') c.event({kind: 'grab-begin', id: 1, grab: {kind: 'move', pointer: false}});
        else beginMove(c);
        a.windows.get(1).rect = translated(first);
        if (mode === 'area') a.workarea.width -= 20;
        if (mode === 'gaps') c.gaps = {...c.gaps, inner: 25};
        if (mode === 'rules') c.floatingApps = ['app-id:other.desktop'];
        if (mode === 'hints') a.windows.get(2).minWidth = 500;
        if (mode === 'disabled') c.dragSwap = false;
        if (mode === 'workspace') a.activeWorkspace = () => 'other';
        equal(c.previewDrag(center(second)), null); c.stop();
    }
});
test('mouse drop without target or with incompatible target floats only the dragged window', () => {
    for (const incompatible of [false, true]) {
        const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
        if (incompatible) {
            c.tree = {...c.tree, ratio: 0.3}; a.windows.get(2).minWidth = 900;
            c.event({kind: 'changed'}); clock.run();
        }
        beginMove(c); assert(c.drag);
        const manual = translated(a.read(1).rect); a.windows.get(1).rect = manual;
        a.point = incompatible ? center(a.read(2).rect) : {x: 1, y: 33};
        equal(c.previewDrag(a.point), null);
        endMove(c); clock.run(); equal(c.records.get(1).state, 'floating');
        equal(a.read(1).rect, manual); equal(ids(c.tree), [2]);
        c.stop(); equal(a.read(1).rect, manual);
    }
});
test('mouse drag feature off, keyboard move and a single tile keep existing floating behavior', () => {
    for (const mode of ['off', 'keyboard', 'single']) {
        const {clock, controller: c} = setup(mode === 'single' ? [[1, {}]] : [[1, {}], [2, {}]]);
        c.dragSwap = mode !== 'off';
        c.event({kind: 'grab-begin', id: 1, grab: {kind: 'move', pointer: mode !== 'keyboard'}});
        equal(c.drag, null); equal(c.records.get(1).state, 'floating');
        endMove(c); clock.run(); c.stop();
    }
});
test('a new window waits for drop and does not displace the selected swap target', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
    beginMove(c); a.point = center(a.read(2).rect);
    a.windows.get(1).rect = translated(a.read(1).rect); a.add(3);
    c.event({kind: 'changed'}); clock.run(); equal(ids(c.tree), [1, 2]);
    endMove(c); clock.run(); assert(ids(c.tree).includes(3));
    equal(c.records.get(1).state, 'tiled'); equal(c.records.get(2).state, 'tiled'); c.stop();
});
test('rules, hints, gaps, area and drag preference changes invalidate pending drop without undoing movement', () => {
    for (const change of [a => a.workarea.height -= 50,
        (a, c) => c.gaps = {inner: 10, outer: 8},
        (a, c) => c.floatingApps = ['wm-class:Other'],
        a => a.windows.get(2).minWidth = 300, (a, c) => c.dragSwap = false,
        a => a.windows.get(2).maximized = true]) {
        const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
        beginMove(c); const manual = translated(a.read(1).rect); a.windows.get(1).rect = manual;
        change(a, c); c.event({kind: 'changed'}); clock.run(); equal(c.drag, null);
        equal(c.records.get(1).state, 'floating'); equal(a.read(1).rect, manual);
        endMove(c); clock.run(); c.stop(); equal(a.read(1).rect, manual);
    }
});
test('closing drag source or target cannot resurrect either ID', () => {
    for (const id of [1, 2]) {
        const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
        beginMove(c); a.windows.delete(id); c.event({kind: 'closed', id}); clock.run();
        equal(c.drag, null); assert(!c.records.has(id)); assert(!ids(c.tree).includes(id));
        endMove(c); clock.run(); c.stop(); equal(clock.jobs.size, 0);
    }
});
test('workspace switch cancels drop and successful swaps survive workspace round trips', () => {
    for (const cancel of [false, true]) {
        const {clock, a, c, first, second, select} = workspaceSetup();
        beginMove(c); const manual = translated(a.read(1).rect); a.windows.get(1).rect = manual;
        a.point = center(a.read(2).rect);
        if (!cancel) { endMove(c); clock.run(); }
        select(second); equal(c.drag, null); select(first);
        if (cancel) {
            equal(c.records.get(1).state, 'floating'); equal(a.read(1).rect, manual);
            endMove(c); clock.run();
        } else equal(ids(c.tree), [2, 1]);
        c.stop();
    }
});
test('disable or topology suspension during drag leaves no queued drop and preserves native movement', () => {
    for (const suspend of [false, true]) {
        const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
        beginMove(c); const manual = translated(a.read(1).rect); a.windows.get(1).rect = manual;
        if (suspend) { a.monitors = 2; c.event({kind: 'topology'}); clock.run(); }
        else c.stop();
        equal(c.drag, null); equal(clock.jobs.size, 0); equal(a.read(1).rect, manual);
        equal(a.read(2).rect.width, 700); endMove(c); clock.run(); c.stop();
    }
});
test('pointer read failure releases the drag instead of leaving a frozen controller', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
    beginMove(c); a.windows.get(1).rect = translated(a.read(1).rect);
    a.pointer = () => { throw new Error('pointer unavailable'); };
    endMove(c); clock.run(); equal(c.drag, null); equal(c.records.get(1).state, 'floating');
    equal(clock.jobs.size, 0); c.stop();
});
test('failed native resize after swap converges to bounded floating fallback', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
    beginMove(c); a.point = center(a.read(2).rect); a.windows.get(1).rect = translated(a.read(1).rect);
    a.windows.get(2).refuse = true;
    const before = a.moves.filter(m => m.id === 2).length;
    endMove(c); clock.run(); equal(c.records.get(2).reason, 'resize-not-converged');
    equal(a.moves.filter(m => m.id === 2).length - before, 3);
    equal(c.records.get(1).state, 'tiled'); equal(clock.jobs.size, 0); c.stop();
});



test('new windows default right and can insert left of the target without mutating its original tree', () => {
    const specs = pairSpecs(), original = {id: 1};
    const right = insert(original, 2, specs, AREA, GAPS);
    const left = insert(original, 2, specs, AREA, GAPS, 1, 'left');
    equal(ids(right), [1, 2]); equal(ids(left), [2, 1]);
    equal(right.axis, 'x'); equal(left.axis, 'x'); equal(original, {id: 1});
    const frames = checkPlan(left, AREA, specs).frames;
    assert(frames.get(2).x < frames.get(1).x);
    equal(insert(original, 2, specs, AREA, GAPS, 1, 'invalid'), null);
});
test('insertion side reverses vertical ordering while preserving the automatic choice of axis', () => {
    const area = {x: -30, y: 10, width: 700, height: 1300}, specs = pairSpecs();
    for (const side of ['left', 'right']) {
        const tree = insert({id: 1}, 2, specs, area, GAPS, 1, side);
        equal(tree.axis, 'y');
        const frames = checkPlan(tree, area, specs).frames;
        assert(side === 'left' ? frames.get(2).y < frames.get(1).y : frames.get(2).y > frames.get(1).y);
    }
});
test('preferred active tile is split on the chosen side without changing unrelated cells', () => {
    const tree = {axis: 'x', ratio: 0.5, a: {id: 1},
        b: {axis: 'y', ratio: 0.5, a: {id: 2}, b: {id: 3}}};
    const specs = new Map([1, 2, 3, 4].map(id => [id, spec()]));
    const before = solve(tree, AREA, specs, GAPS);
    const next = insert(tree, 4, specs, AREA, GAPS, 2, 'left');
    equal(ids(next), [1, 4, 2, 3]);
    const after = checkPlan(next, AREA, specs);
    equal(after.frames.get(1), before.frames.get(1));
    equal(after.frames.get(3), before.frames.get(3));
    equal(ids(tree), [1, 2, 3]);
});
test('side selection respects minimum/maximum constraints and falls back to another viable leaf', () => {
    const specs = new Map([[1, spec({minWidth: 700, minHeight: 600})], [2, spec({minWidth: 500})],
        [3, spec({minWidth: 600, minHeight: 600, maxWidth: 650})]]);
    const tree = pair('x');
    const next = insert(tree, 3, specs, AREA, GAPS, 1, 'left');
    equal(ids(next), [1, 3, 2]);
    checkPlan(next, AREA, specs);
    for (const side of ['left', 'right']) {
        const invalid = new Map([[1, spec()], [2, spec({minWidth: 2000, minHeight: 2000})]]);
        equal(insert({id: 1}, 2, invalid, AREA, GAPS, 1, side), null);
    }
});
test('controller keeps the active tile as target when newly created window takes focus early', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}], [3, {}]]);
    c.insertionSide = 'left'; c.preserveFocusedWindow = false;
    a.currentFocus = 2; a.focusedId = () => a.currentFocus;
    c.event({kind: 'focus', id: 2});
    a.add(4); a.currentFocus = 4;
    c.event({kind: 'changed'}); c.event({kind: 'focus', id: 4}); clock.run();
    const leaves = ids(c.tree);
    equal(leaves[leaves.indexOf(2) - 1], 4);
    equal(c.records.get(4).state, 'tiled'); c.stop();
});
test('changing insertion side preserves existing geometry and affects only subsequent insertion', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
    const tree = c.tree, moves = a.moves.length;
    c.preserveFocusedWindow = false;
    c.insertionSide = 'left'; c.event({kind: 'changed'}); clock.run();
    assert(c.tree === tree); equal(a.moves.length, moves);
    a.focusedId = () => 2;
    a.add(3); c.event({kind: 'changed'}); clock.run();
    const leaves = ids(c.tree); equal(leaves[leaves.indexOf(2) - 1], 3);
    c.stop();
});
test('left insertion preserves independent workspace trees', () => {
    const {clock, a, c, first, second, select} = workspaceSetup();
    const firstTree = c.tree;
    c.insertionSide = 'left'; select(second);
    a.add(4, {domain: second}); c.event({kind: 'changed'}); clock.run();
    equal(ids(c.tree), [4, 3]);
    select(first); assert(c.tree === firstTree); c.stop();
});


test('focus preservation splits another tile and retains a manually enlarged focused frame on either side', () => {
    for (const side of ['left', 'right']) {
        const tree = {axis: 'x', ratio: 0.7, a: {id: 1}, b: {id: 2}};
        const snapshot = JSON.stringify(tree);
        const specs = new Map([1, 2, 3].map(id => [id, spec()]));
        const before = checkPlan(tree, AREA, specs);
        const next = insert(tree, 3, specs, AREA, GAPS, 1, side, true);
        const after = checkPlan(next, AREA, specs);
        equal(after.frames.get(1), before.frames.get(1));
        assert(after.frames.get(2).height < before.frames.get(2).height);
        equal(ids(next), side === 'left' ? [1, 3, 2] : [1, 2, 3]);
        equal(JSON.stringify(tree), snapshot);
    }
});
test('space exhaustion shrinks focus only as needed and respects other window minima', () => {
    const area = {x: 0, y: 0, width: 1000, height: 600}, gaps = {inner: 0, outer: 0};
    const specs = new Map([1, 2, 3].map(id => [id, spec({minHeight: 400})]));
    const tree = {axis: 'x', ratio: 0.7, a: {id: 1}, b: {id: 2}};
    const next = insert(tree, 3, specs, area, gaps, 1, 'left', true);
    const after = checkPlan(next, area, specs, gaps);
    equal(after.frames.get(1).width, 520);
    equal(after.frames.get(1).height, 600);
    equal(after.frames.get(2).width, 240);
    equal(after.frames.get(3).width, 240);
});
test('a lone focused tile gives the new window its required space rather than halving by default', () => {
    const area = {x: -100, y: 32, width: 1000, height: 600}, gaps = {inner: 0, outer: 0};
    const specs = new Map([[1, spec({minHeight: 400})], [2, spec({minWidth: 300, minHeight: 400})]]);
    const next = insert({id: 1}, 2, specs, area, gaps, 1, 'left', true);
    const frames = checkPlan(next, area, specs, gaps).frames;
    equal(frames.get(1).width, 700); equal(frames.get(2).width, 300);
});
test('preservation protects actual bounded frame size without leaking temporary minima', () => {
    const tree = {axis: 'x', ratio: 0.7, a: {id: 1}, b: {id: 2}};
    const specs = new Map([[1, spec({maxWidth: 600})], [2, spec()], [3, spec()]]);
    const original = JSON.stringify([...specs]);
    const before = checkPlan(tree, AREA, specs).frames.get(1);
    const next = insert(tree, 3, specs, AREA, GAPS, 1, 'right', true);
    const after = checkPlan(next, AREA, specs).frames.get(1);
    equal(after.width, before.width); equal(after.height, before.height);
    equal(JSON.stringify([...specs]), original);
    // Closing the new window still expands the remaining cells normally.
    checkPlan(remove(next, 3), AREA, specs);
});
test('preservation leaves impossible insertion untouched and falls back normally without tiled focus', () => {
    const tree = {id: 1}, snapshot = JSON.stringify(tree);
    const specs = new Map([[1, spec()], [2, spec({minWidth: 2000, minHeight: 2000})]]);
    equal(insert(tree, 2, specs, AREA, GAPS, 1, 'left', true), null);
    equal(JSON.stringify(tree), snapshot);
    specs.set(2, spec());
    equal(insert(tree, 2, specs, AREA, GAPS, 99, 'left', true),
        insert(tree, 2, specs, AREA, GAPS, 99, 'left', false));
});
test('verified package ownership shares exceptions across application processes', () => {
    const windows = new Map([[1, {wmClass: 'OpenLog', verifiedAppId: 'org.openlogi.desktop', ownerPid: 10}],
        [2, {wmClass: 'Editor', verifiedAppId: 'org.openlogi.desktop', ownerPid: 20}],
        [3, {wmClass: 'Other', appId: 'org.openlogi.desktop', pid: 10}]]);
    const related = applicationIdentities(windows);
    assert(related.get(2).includes('wm-class:OpenLog'));
    assert(!related.get(3).includes('wm-class:OpenLog'));
});
test('authenticated peer ownership shares rules without trusting declared PIDs', () => {
    const windows = new Map([[1, {wmClass: 'Main', ownerPid: 10}],
        [2, {wmClass: 'Helper', ownerPid: 10}],
        [3, {wmClass: 'Spoof', pid: 10, appId: 'same.desktop', appGroupId: 'same.desktop'}],
        [4, {wmClass: 'Other', pid: 10, appId: 'same.desktop', appGroupId: 'same.desktop'}]]);
    const related = applicationIdentities(windows);
    assert(related.get(2).includes('wm-class:Main'));
    assert(!related.get(3).includes('wm-class:Main'));
    assert(!related.get(4).includes('wm-class:Spoof'));
});
test('verified transient children inherit directionally and never affect their parent', () => {
    const windows = new Map([[1, {wmClass: 'Main', ownerPid: 10}],
        [2, {wmClass: 'Child', ownerPid: 10, transientFor: 1}],
        [3, {wmClass: 'Spoof', ownerPid: 20, transientFor: 1}]]);
    let related = applicationIdentities(windows);
    assert(related.get(2).includes('wm-class:Main'));
    assert(!related.get(1).includes('wm-class:Child'));
    assert(!related.get(3).includes('wm-class:Main'));
    windows.get(2).transientFor = null; windows.get(2).ownerPid = 20;
    related = applicationIdentities(windows); assert(!related.get(2).includes('wm-class:Main'));
});
test('special windows cannot contribute identities to normal application windows', () => {
    const windows = new Map([[1, {wmClass: 'Main', ownerPid: 10}],
        [2, {wmClass: 'Special', ownerPid: 10, special: true}],
        [3, {wmClass: 'Dialog', ownerPid: 10, normal: false}]]);
    const related = applicationIdentities(windows);
    assert(!related.get(1).includes('wm-class:Special'));
    assert(!related.get(1).includes('wm-class:Dialog'));
});
test('current identity sets and cyclic parents stay bounded', () => {
    const windows = new Map(Array.from({length: 500}, (_, i) => [i + 1,
        {ownerPid: 10, wmClass: `identity-${i}`, transientFor: i === 0 ? 2 : 1}]));
    for (const values of applicationIdentities(windows).values()) assert(values.length <= 32);
    const values = boundedIdentities(Array.from({length: 1000}, (_, i) => `wm-class:${i}${'x'.repeat(480)}`));
    assert(values.length <= 32 && values.reduce((n, s) => n + s.length * 2, 0) <= 8192);
    equal(boundedIdentities(['x'.repeat(513), 'bad\nline', 'bad\u2028line', 'valid', 'valid']), ['valid']);
});
test('OpenLogi Caps Lock keeps its self-only exception even without authenticated ownership', () => {
    const osd = {wmClass: 'openlogi-lock-key-osd', pid: 999};
    assert(matchesApp(osd, ['app-id:openlogi.desktop']));
    assert(matchesApp(osd, ['wm-class:org.openlogi.openlogi']));
    assert(!matchesApp(osd, []));
    const related = applicationIdentities(new Map([[1, osd], [2, {pid: 999, wmClass: 'Other'}]]));
    assert(!related.get(2).includes('app-id:openlogi.desktop'));
});
test('oversized direct window metadata is rejected before identity construction', () => {
    equal(appIdentities({wmClass: 'x'.repeat(2000000), gtkAppId: 'bad\nline'}), []);
    assert(appIdentities({wmClass: 'x'.repeat(503)}).length === 1);
    equal(appIdentities({wmClass: 'x'.repeat(504)}), []);
});
test('diagnostic logs escape line separators and bound output length', () => {
    const value = safeLogText('name\n[justtiling] Window capture {}\r\u2028\u2029');
    assert(!/[\n\r\u2028\u2029]/.test(value)); assert(value.includes('\\u000a'));
    equal(safeLogText('x'.repeat(20000)).length, 8192);
});

test('controller balances unsaved sizes even when a new window grabs focus early', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
    assert(c.preserveFocusedWindow, 'Focus preservation defaults on');
    c.tree = {axis: 'x', ratio: 0.7, a: {id: 1}, b: {id: 2}};
    a.currentFocus = 1; a.focusedId = () => a.currentFocus;
    c.event({kind: 'focus', id: 1}); c.event({kind: 'changed'}); clock.run();
    const before = {...a.read(1).rect};
    a.add(3); a.currentFocus = 3;
    c.event({kind: 'changed'}); c.event({kind: 'focus', id: 3}); clock.run();
    assert(a.read(1).rect.width < before.width); equal(c.records.get(3).state, 'tiled');
    const areas = [1, 2, 3].map(id => a.read(id).rect.width * a.read(id).rect.height);
    assert(Math.max(...areas) / Math.min(...areas) < 1.03, 'Unsaved focus size must not override balanced areas');
    c.stop();
});
test('turning preservation off keeps existing geometry and resumes splitting the focused tile', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
    a.focusedId = () => 1; c.event({kind: 'focus', id: 1});
    const before = {...a.read(1).rect}, tree = c.tree, moves = a.moves.length;
    c.preserveFocusedWindow = false; c.event({kind: 'changed'}); clock.run();
    assert(c.tree === tree); equal(a.moves.length, moves);
    a.add(3); c.event({kind: 'changed'}); clock.run();
    assert(a.read(1).rect.width < before.width || a.read(1).rect.height < before.height);
    c.stop();
});
test('repeated protected insertions remain deterministic and feasible with odd areas and gaps', () => {
    function run() {
        const area = {x: -301, y: 31, width: 1701, height: 1003};
        const specs = new Map(); let tree = null;
        for (let id = 1; id <= 15; id++) {
            specs.set(id, spec());
            const next = insert(tree, id, specs, area, {inner: 15, outer: 15}, 1,
                id % 2 ? 'left' : 'right', true);
            if (next) { tree = next; checkPlan(tree, area, specs, {inner: 15, outer: 15}); }
        }
        return tree;
    }
    equal(run(), run());
});

test('directional neighbors follow screen edges with overlap, excluding diagonals and outer boundaries', () => {
    const cells = new Map([[1, {x: 100, y: 100, width: 100, height: 100}],
        [2, {x: 0, y: 100, width: 90, height: 100}], [3, {x: 210, y: 100, width: 100, height: 100}],
        [4, {x: 100, y: 0, width: 100, height: 90}], [5, {x: 100, y: 210, width: 100, height: 100}],
        [6, {x: 0, y: 0, width: 50, height: 50}]]);
    for (const [direction, target] of [['left', 2], ['right', 3], ['up', 4], ['down', 5]])
        equal(directionalNeighbor(cells, 1, direction), target);
    equal(directionalNeighbor(cells, 2, 'left'), null);
});
test('directional neighbor prioritizes closest edge, greatest overlap and deterministic ties', () => {
    const cells = new Map([[1, {x: 0, y: 0, width: 100, height: 500}],
        [2, {x: 108, y: 0, width: 100, height: 200}], [3, {x: 108, y: 208, width: 100, height: 292}],
        [4, {x: 216, y: 0, width: 100, height: 500}]]);
    equal(directionalNeighbor(cells, 1, 'right'), 3);
});
test('controller directional swaps retain tree ratios and reverse without changing window focus', () => {
    for (const [axis, forward, backward] of [['x', 'right', 'left'], ['y', 'down', 'up']]) {
        const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
        c.tree = pair(axis); c.event({kind: 'changed'}); clock.run(); a.focusedId = () => 1;
        const frame = a.read(1).rect;
        c.swapDirection(forward); clock.run(); equal(ids(c.tree), [2, 1]);
        c.swapDirection(backward); clock.run(); equal(ids(c.tree), [1, 2]);
        equal(a.read(1).rect, frame); equal(c.tree.ratio, 0.5); c.stop();
    }
});
test('directional swap does nothing at boundary, during a grab, off, or for floating focus', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
    a.focusedId = () => 1; const tree = c.tree;
    c.swapDirection('left'); clock.run(); assert(c.tree === tree);
    beginMove(c); c.swapDirection('right'); assert(c.tree === tree);
    endMove(c); clock.run(); c.toggleWindow(1); clock.run();
    const floatingTree = c.tree; c.swapDirection('right'); clock.run(); assert(c.tree === floatingTree);
    c.stop(); const moves = a.moves.length; c.swapDirection('right'); clock.run(); equal(a.moves.length, moves);
});
test('incompatible keyboard swap leaves both tiles and original geometry intact', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {minWidth: 900}], [2, {}]]);
    a.focusedId = () => 1; const tree = c.tree, frame = a.read(1).rect;
    c.swapDirection('right'); clock.run(); assert(c.tree === tree); equal(a.read(1).rect, frame);
    equal(c.records.get(1).state, 'tiled'); c.stop();
});
function overrideSetup() {
    const schema = 'org.gnome.desktop.wm.keybindings';
    const native = new Map([['maximize', {values: ['<Super>Up', '<Alt>F10'], userValue: null}]]);
    let journal = '[]'; const writes = [];
    const own = {get_string: () => journal, set_string: (_key, value) => {journal = value; return true;}};
    const backend = {
        shortcutSources: () => [...native].map(([key, value]) => ({schema, key, accelerators: value.values})),
        readSystemShortcut: (_schema, key) => native.get(key),
        writeSystemShortcut: (_schema, key, value) => {
            assert(JSON.parse(journal).length > 0, 'Journal must precede native writes');
            writes.push(value);
            const values = value === null ? ['<Super>Up', '<Alt>F10'] : value;
            native.set(key, {values, userValue: value}); return true;
        },
    };
    return {schema, native, writes, own, backend, recovery: new ShortcutOverrides(backend, own)};
}
test('native shortcut takeover removes only authorized arrow, journals before writing and restores default provenance', () => {
    const {native, writes, recovery} = overrideSetup();
    recovery.sync(new Set(['super+up'])); equal(native.get('maximize').values, ['<Alt>F10']);
    recovery.sync(new Set(['super+up'])); equal(writes.length, 1);
    recovery.restore(); equal(native.get('maximize').values, ['<Super>Up', '<Alt>F10']);
    equal(native.get('maximize').userValue, null); equal(recovery.entries.length, 0);
});
test('changed/disabled shortcut releases reservation and custom arrays restore exactly', () => {
    const {native, recovery} = overrideSetup();
    native.set('maximize', {values: ['<Super>Up', '<Super>F12'], userValue: ['<Super>Up', '<Super>F12']});
    recovery.sync(new Set(['super+up'])); equal(native.get('maximize').values, ['<Super>F12']);
    recovery.sync(new Set()); equal(native.get('maximize').values, ['<Super>Up', '<Super>F12']);
    equal(native.get('maximize').userValue, ['<Super>Up', '<Super>F12']); equal(recovery.entries.length, 0);
});
test('later user edits are preserved and never reclaimed in the same management interval', () => {
    const {native, writes, recovery} = overrideSetup(); recovery.sync(new Set(['super+up']));
    native.set('maximize', {values: ['<Super>Up', '<Alt>m'], userValue: ['<Super>Up', '<Alt>m']});
    recovery.sync(new Set(['super+up'])); recovery.sync(new Set(['super+up'])); recovery.restore();
    equal(writes.length, 1); equal(native.get('maximize').values, ['<Super>Up', '<Alt>m']);
});
test('persisted journal recovers interrupted sessions without losing original shortcut values', () => {
    const {native, own, backend, recovery} = overrideSetup(); recovery.sync(new Set(['super+up']));
    const next = new ShortcutOverrides(backend, own); next.restore();
    equal(native.get('maximize').values, ['<Super>Up', '<Alt>F10']); equal(own.get_string(), '[]');
});
test('non-writable shortcuts do not leave a false ownership journal', () => {
    const {backend, recovery} = overrideSetup(); backend.writeSystemShortcut = () => false;
    recovery.sync(new Set(['super+up'])); equal(recovery.entries.length, 0);
});

test('refused compositor binding restores native arrows and does not retry writes in a loop', () => {
    const {native, own, backend, writes, recovery} = overrideSetup();
    own.get_strv = () => ['<Super>Up'];
    Object.assign(backend, {bindShortcut: () => false, unbindShortcut: () => {}, log: () => {}, notice: () => {}});
    const keys = new Keybindings(backend, own, {'swap-up': () => {}}, recovery);
    keys.refresh(); keys.refresh();
    equal(writes.length, 2); equal(native.get('maximize').values, ['<Super>Up', '<Alt>F10']);
    equal(keys.active.size, 0); keys.dispose();
});
test('journal write failure cannot modify native shortcuts', () => {
    const {own, recovery, writes} = overrideSetup(); own.set_string = () => false;
    let failed = false; try { recovery.sync(new Set(['super+up'])); } catch (_) { failed = true; }
    assert(failed); equal(writes.length, 0);
});

test('learned data validates version, geometry and identifiers without titles or defaults', () => {
    equal(readLearning('invalid'), {}); equal(readLearning('{"version":2,"apps":{}}'), {});
    equal(readLearning('x'.repeat(70000)), {});
    const apps = {'app-id:Example.desktop': {x: 0, y: 0, width: 0.5, height: 1}};
    equal(readLearning(writeLearning(apps)), apps);
    equal(readLearning(writeLearning({'wm-class:Bad': {x: 0.8, y: 0, width: 0.5, height: 1}})), {});
    equal(readLearning(writeLearning({'title:Private': apps['app-id:Example.desktop']})), {});
    equal(learningIdentity({appId: 'Example.desktop', wmClass: 'Example', title: 'Private'}), 'app-id:Example.desktop');
    equal(learningIdentity({wmInstance: 'unstable-instance', title: 'Private'}), null);
});
test('learning normalization survives scale and negative monitor origins', () => {
    const first = normalizedFrame({x: -290, y: 42, width: 490, height: 880},
        {x: -300, y: 32, width: 1000, height: 900}, {inner: 10, outer: 10});
    equal(first, {x: 0, y: 0, width: 0.5, height: 1});
    const specs = new Map([[1, spec()], [2, spec()]]), area = {x: 0, y: 0, width: 2000, height: 1000};
    const base = {axis: 'x', ratio: 0.8, a: {id: 2}, b: {id: 1}};
    const next = applyLearning(base, 1, new Map([[1, first]]), area, specs, {inner: 0, outer: 0});
    const frames = checkPlan(next, area, specs, {inner: 0, outer: 0}).frames;
    equal(frames.get(1), {x: 0, y: 0, width: 1000, height: 1000});
});
test('learning candidates respect application minima and protected focused size', () => {
    const tree = pair('x'), area = {x: 0, y: 0, width: 1000, height: 600}, gaps = {inner: 0, outer: 0};
    const goals = new Map([[1, {x: 0, y: 0, width: 0.2, height: 1}]]);
    const specs = new Map([[1, spec({minWidth: 400})], [2, spec()]]);
    const next = applyLearning(tree, 2, goals, area, specs, gaps);
    equal(checkPlan(next, area, specs, gaps).frames.get(1).width, 400);
    const protectedTree = applyLearning(tree, 2, goals, area, specs, gaps, {id: 1, width: 500, height: 600});
    equal(checkPlan(protectedTree, area, specs, gaps).frames.get(1).width, 500);
    assert(applyLearning(tree, 2, new Map(), area, specs, gaps) === tree);
});
test('multiple organized windows of an application are excluded from learning', () => {
    const windows = new Map([[1, {appId: 'Example.desktop', wmClass: 'Main'}],
        [2, {appId: 'Example.desktop', wmClass: 'Secondary'}], [3, {appId: 'Other.desktop', wmInstance: 'common-instance'}]]);
    equal(uniqueLearningKey(1, windows), null); equal(uniqueLearningKey(2, windows), null);
    equal(uniqueLearningKey(3, windows), 'app-id:Other.desktop');
    windows.set(4, {appId: 'Distinct.desktop', wmInstance: 'common-instance'});
    equal(uniqueLearningKey(3, windows), 'app-id:Other.desktop');
});
test('automatic opening, closing and workspace geometry changes never create learned preferences', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {wmClass: 'Example'}], [2, {wmClass: 'Other'}]]);
    let saves = 0; c.onLearnedLayouts = () => saves++;
    a.add(3, {wmClass: 'Third'}); c.event({kind: 'changed'}); clock.run();
    a.windows.delete(3); c.event({kind: 'closed', id: 3}); clock.run();
    a.workarea.width -= 100; c.event({kind: 'changed'}); clock.run();
    equal(saves, 0); equal(c.learnedLayouts, {}); c.stop();
});
test('manual split resize learns only converged geometry and restores it on later opening', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {wmClass: 'Example'}], [2, {wmClass: 'Other'}]]);
    assert(c.learnLayouts); let saved;
    c.onLearnedLayouts = apps => saved = writeLearning(apps);
    beginEast(c); a.windows.get(1).rect.width += 50; endEast(c); clock.run();
    assert(saved); const expected = {...a.read(1).rect};
    equal(readLearning(saved)['wm-class:Example'], normalizedFrame(expected, AREA, GAPS));
    a.windows.delete(2); c.event({kind: 'closed', id: 2}); clock.run();
    a.add(3, {wmClass: 'Other'}); c.event({kind: 'changed'}); clock.run();
    assert(sameRect(a.read(1).rect, expected, 1), 'Learned size and left region must return');
    c.stop();
});
test('new controller session restores learned layout with different native window IDs', () => {
    const first = setup([[1, {wmClass: 'Example'}], [2, {wmClass: 'Other'}]]);
    beginEast(first.controller); first.adapter.windows.get(1).rect.width += 50; endEast(first.controller); first.clock.run();
    const saved = writeLearning(first.controller.learnedLayouts), expected = first.adapter.read(1).rect;
    first.controller.stop();
    const clock = new FakeClock(), a = new FakeAdapter(clock); a.add(40, {wmClass: 'Example'}); a.add(41, {wmClass: 'Other'});
    const c = new Controller(a, clock); a.event = e => c.event(e); c.insertionSide = 'left';
    c.learnedLayouts = readLearning(saved); c.start(); clock.run();
    assert(sameRect(a.read(40).rect, expected, 1), 'Reopening must use app identity instead of window ID'); c.stop();
});
test('manual keyboard swaps learn new positions but edge no-ops do not write', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {wmClass: 'Example'}], [2, {wmClass: 'Other'}]]);
    let saves = 0; c.onLearnedLayouts = () => saves++;
    a.focusedId = () => 1; c.swapDirection('left'); clock.run(); equal(saves, 0);
    c.swapDirection('right'); clock.run(); equal(saves, 1);
    assert(c.learnedLayouts['wm-class:Example'].x > 0.4);
    c.stop();
});
test('manual drag swaps learn positions and cancelled drags do not learn', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {wmClass: 'Example'}], [2, {wmClass: 'Other'}]]);
    let saves = 0; c.onLearnedLayouts = () => saves++;
    const target = a.read(2).rect;
    c.event({kind: 'grab-begin', id: 1, grab: {kind: 'move', pointer: true}});
    c.event({kind: 'grab-end', id: 1}); clock.run(); equal(saves, 0);
    c.event({kind: 'grab-begin', id: 1, grab: {kind: 'move', pointer: true}});
    a.windows.get(1).rect.x += 100; a.point = {x: target.x + 10, y: target.y + 10};
    c.event({kind: 'grab-end', id: 1}); clock.run(); equal(saves, 1); c.stop();
});
test('disabling learning neither records manual actions nor applies saved preferences', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {wmClass: 'Example'}], [2, {wmClass: 'Other'}]]);
    c.learnLayouts = false; let saves = 0; c.onLearnedLayouts = () => saves++;
    c.learnedLayouts = {'wm-class:Example': {x: 0, y: 0, width: 0.2, height: 1}};
    beginEast(c); a.windows.get(1).rect.width += 90; endEast(c); clock.run(); equal(saves, 0);
    const tree = pair('x'), specs = pairSpecs();
    equal(c.preferredBalance(tree, AREA, specs, GAPS), tree); c.stop();
});
test('ambiguous application instances, failed resize and stopped sessions never save guessed layouts', () => {
    for (const mode of ['multiple', 'failure', 'stop']) {
        const {clock, adapter: a, controller: c} = setup([[1, {wmClass: 'Example'}], [2, {wmClass: mode === 'multiple' ? 'Example' : 'Other'}]]);
        let saves = 0; c.onLearnedLayouts = () => saves++;
        if (mode === 'failure') a.windows.get(2).refuse = true;
        beginEast(c); a.windows.get(1).rect.width += 100; endEast(c);
        if (mode === 'stop') c.stop();
        clock.run(); equal(saves, 0); c.stop();
    }
});

test('pending manual learning is discarded when area or gaps change before convergence', () => {
    for (const change of [(a, c) => a.workarea.width -= 100, (a, c) => c.gaps = {inner: 15, outer: 15}]) {
        const {clock, adapter: a, controller: c} = setup([[1, {wmClass: 'Example'}], [2, {wmClass: 'Other'}]]);
        let saves = 0; c.onLearnedLayouts = () => saves++;
        beginEast(c); a.windows.get(1).rect.width += 100; endEast(c);
        change(a, c); c.event({kind: 'changed'}); clock.run(); equal(saves, 0); c.stop();
    }
});

test('another tiled instance on an inactive workspace prevents learning that application', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {appId: 'Example.desktop'}], [2, {appId: 'Other.desktop'}]]);
    a.add(3, {appId: 'Example.desktop', inScope: false, domain: 'inactive'});
    c.records.set(3, {id: 3, state: 'tiled', domain: 'inactive'});
    equal(uniqueLearningKey(1, c.learningWindows()), null);
    c.stop();
});

test('excluded desktop and transient windows do not discard a successful manual learning intent', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {appId: 'Example.desktop'}],
        [2, {appId: 'Other.desktop'}], [90, {normal: false}], [91, {transient: true}]]);
    let saves = 0; c.onLearnedLayouts = () => saves++;
    beginEast(c); a.windows.get(1).rect.width += 100; endEast(c); clock.run();
    equal(saves, 1);
    assert(c.learnedLayouts['app-id:Example.desktop'], 'Desktop windows must not cancel pending learning');
    c.stop();
});

test('focus cycles tiled windows in spatial order, wraps and never moves or learns', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}], [3, {}]]);
    let focused = 1, saves = 0; const activated = [];
    a.focusedId = () => focused;
    a.focusWindow = id => { focused = id; activated.push(id); c.event({kind: 'focus', id}); };
    c.onLearnedLayouts = () => saves++;
    const tree = c.tree, moves = a.moves.length;
    const ordered = ids(tree).sort((x, y) => a.read(x).rect.y - a.read(y).rect.y || a.read(x).rect.x - a.read(y).rect.x);
    for (let n = 0; n < 3; n++) c.cycleFocus();
    equal(activated, [...ordered.slice(1), ordered[0]]); equal(focused, 1);
    equal(a.moves.length, moves); assert(c.tree === tree); equal(saves, 0); equal(c.learningPending, null);
    c.stop();
});
test('focus cycle excludes floating, minimized, other workspaces and fullscreen', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
    let focused = 99; a.focusedId = () => focused; a.focusWindow = id => focused = id;
    a.add(99, {normal: false});
    c.cycleFocus(); equal(focused, 1);
    a.windows.get(2).minimized = true; c.cycleFocus(); equal(focused, 1);
    a.windows.get(2).minimized = false;
    c.records.get(2).state = 'floating'; c.cycleFocus(); equal(focused, 1);
    c.records.get(2).state = 'tiled'; a.windows.get(2).inScope = false; c.cycleFocus(); equal(focused, 1);
    a.windows.get(2).inScope = true; a.windows.get(2).fullscreen = true; c.cycleFocus(); equal(focused, 1);
    a.windows.get(2).fullscreen = false;
    c.drag = {}; c.cycleFocus(); equal(focused, 1); c.drag = null;
    c.resize = {}; c.cycleFocus(); equal(focused, 1); c.resize = null;
    c.stop(); c.cycleFocus(); equal(focused, 1);
});

async function asyncTest(name, fn) {
    try { await fn(); passed++; print(`ok ${passed} - ${name}`); }
    catch (error) { printerr(`FAIL - ${name}`); throw error; }
}
await asyncTest('package identity delays unknown helpers, deduplicates queries and caches missing results', async () => {
    let resolve, calls = 0, changes = 0;
    const identity = new PackageIdentity(() => { calls++; return new Promise(done => { resolve = done; }); }, () => changes++);
    const one = identity.get('/usr/bin/helper'), two = identity.get('/usr/bin/helper');
    assert(one === two && one.pending); await Promise.resolve(); equal(calls, 1);
    resolve('tool.desktop');
    for (let n = 0; n < 5; n++) await Promise.resolve();
    equal(one, {pending: false, appId: 'tool.desktop'}); equal(changes, 1);
    assert(identity.get('/usr/bin/helper') === one);
    identity.dispose();
    const missing = new PackageIdentity(() => { throw Error('not installed'); }, () => {});
    const result = missing.get('/usr/bin/unknown');
    for (let n = 0; n < 5; n++) await Promise.resolve();
    equal(result, {pending: false, appId: null}); assert(missing.get('/usr/bin/unknown') === result);
    missing.dispose();
});
await asyncTest('disposed package resolver cannot emit changes after delayed completion', async () => {
    let resolve, changes = 0;
    const identity = new PackageIdentity(() => new Promise(done => { resolve = done; }), () => changes++);
    identity.get('/usr/bin/helper'); await Promise.resolve(); identity.dispose(); resolve('tool.desktop');
    for (let n = 0; n < 5; n++) await Promise.resolve();
    equal(changes, 0); equal(identity.cache.size, 0);
});

test('numbered swap is inert until selected and keeps source focus', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {}], [2, {}], [3, {}]]);
    let focus = 1; a.focusedId = () => focus; a.focusWindow = id => focus = id;
    a.activeWorkspace = () => c.domain;
    const tree = c.tree, context = c.numberedSwapContext();
    assert(context && context.targets.length === 2 && !context.targets.includes(1));
    equal(c.tree, tree);
    assert(!c.selectNumberedSwap(context, 0)); equal(c.tree, tree);
    const target = context.targets[0], before = {...a.read(target).rect};
    assert(c.selectNumberedSwap(context, 1)); clock.run();
    equal(a.read(1).rect, before); equal(focus, 1);
    assert(!c.selectNumberedSwap(context, 2), 'Old contexts cannot be reused'); c.stop();
});
test('numbered swap rejects stale focus, workspace, geometry and disabled context', () => {
    for (const mode of ['focus', 'workspace', 'geometry', 'disabled', 'monitor', 'rule']) {
        const {adapter: a, controller: c} = setup([[1, {}], [2, {}]]);
        a.focusedId = () => 1; a.focusWindow = () => {}; a.activeWorkspace = () => c.domain;
        const context = c.numberedSwapContext(), tree = c.tree; assert(context);
        if (mode === 'focus') a.focusedId = () => 2;
        if (mode === 'workspace') a.activeWorkspace = () => 'other';
        if (mode === 'geometry') a.windows.get(2).rect.x += 10;
        if (mode === 'disabled') c.running = false;
        if (mode === 'monitor') a.monitorCount = () => 2;
        if (mode === 'rule') c.floatingApps = ['wm-class:Other'];
        assert(!c.selectNumberedSwap(context, 1), mode); equal(c.tree, tree); c.stop();
    }
});
test('number choices support single digits, keypad values and ambiguous multi-digit prefixes', () => {
    equal(new NumberChoice(3).digit('2'), {number: 2, wait: false});
    const choice = new NumberChoice(63);
    equal(choice.digit('1'), {number: 1, wait: true});
    equal(choice.digit('2'), {number: 12, wait: false});
    equal(new NumberChoice(3).digit('9'), {number: null, wait: false});
    equal(new NumberChoice(63).digit('0'), {number: null, wait: false});
});
test('shortcut migration upgrades the previous defaults and preserves custom focus', () => {
    const settings = migrationSettings({'preferences-version': 1, 'toggle-floating': ['<Super>f'], 'cycle-focus': ['<Super>c']});
    migrateShortcuts(settings);
    equal(settings.get_strv('toggle-floating'), ['<Super>g']); equal(settings.get_strv('cycle-focus'), ['<Super>f']);
    const custom = migrationSettings({'preferences-version': 1, 'cycle-focus': ['<Super>x']});
    migrateShortcuts(custom); equal(custom.get_strv('cycle-focus'), ['<Super>x']);
});

test('migration gives custom bindings priority over new default shortcuts', () => {
    const settings = migrationSettings({'preferences-version': 1,
        'toggle-tiling': ['<Super>c'], 'toggle-floating': ['<Super>f'], 'cycle-focus': ['<Super>g']});
    migrateShortcuts(settings);
    equal(settings.get_strv('toggle-tiling'), ['<Super>c']);
    equal(settings.get_strv('cycle-focus'), ['<Super>g']);
    equal(settings.get_strv('swap-select'), []);
    equal(settings.get_strv('toggle-floating'), []);
});

test('rounded corner geometry aligns the frame and radius across shadow margins, scales and monitor origins', () => {
    const frame = {x: -500, y: 70, width: 300, height: 200};
    const buffer = {x: -510, y: 50, width: 320, height: 240};
    equal(cornerGeometry({frame, buffer, width: 320, height: 240}), {bounds: [10, 20, 300, 200], scale: 1, radius: 8});
    equal(cornerGeometry({frame, buffer, width: 640, height: 480}), {bounds: [20, 40, 600, 400], scale: 2, radius: 16});
    equal(cornerGeometry({frame, buffer, width: 480, height: 360}), {bounds: [15, 30, 450, 300], scale: 1.5, radius: 12});
});
test('manual corner radius accepts square corners and caps values independently of window scale', () => {
    equal(cornerRadius(), 8); equal(cornerRadius(0), 0); equal(cornerRadius(64), 64);
    equal(cornerRadius(-1), 0); equal(cornerRadius(200), 64); equal(cornerRadius(NaN), 8);
    const frame = {x: 0, y: 0, width: 300, height: 100};
    const visual = {frame, buffer: frame, width: 600, height: 200};
    equal(cornerGeometry(visual, 16).radius, 32);
    equal(cornerGeometry(visual, 16).scale, 2);
    equal(cornerGeometry(visual, 0).radius, 0);
    equal(cornerGeometry(visual, 64).radius, 100);
});
test('rounded corner geometry rejects unallocated buffers and caps the radius for tiny windows', () => {
    const frame = {x: 0, y: 0, width: 4, height: 6};
    equal(cornerGeometry({frame, buffer: frame, width: 4, height: 6}).radius, 2);
    for (const width of [0, -1, NaN, Infinity])
        equal(cornerGeometry({frame, buffer: frame, width, height: 6}), null);
    equal(cornerGeometry(null), null);
    equal(cornerGeometry({frame, buffer: {...frame, width: 0}, width: 4, height: 6}), null);
});
test('rounded shadows expand the paint volume without shrinking existing native shadows', () => {
    equal(cornerPaintVolume({x: 0, y: 0, width: 300, height: 200}, [0, 0, 300, 200]),
        {x: -20, y: -20, width: 340, height: 240});
    equal(cornerPaintVolume({x: -40, y: -30, width: 380, height: 270}, [0, 0, 300, 200]),
        {x: -40, y: -30, width: 380, height: 270});
});
test('offscreen mapping includes paint-volume expansion and integer resource scaling', () => {
    const volume = {x: -10, y: -20, width: 320, height: 240};
    equal(framebufferMapping(volume, 323, 243, 1), [-12, -22, 323, 243]);
    equal(framebufferMapping(volume, 646, 486, 1.5), [-12, -22, 323, 243]);
    equal(framebufferMapping(volume, 646, 486, 2), [-12, -22, 323, 243]);
    equal(framebufferMapping(volume, 0, 486, 2), null);
});

test('floating shortcut migration replaces Super O and preserves custom, disabled and multiple bindings', () => {
    const settings = migrationSettings({'preferences-version': 2, 'toggle-floating': ['<Mod4>O']});
    migrateShortcuts(settings);
    equal(settings.get_strv('toggle-floating'), ['<Super>g']);
    equal(settings.get_int('preferences-version'), 4);
    settings.set_strv('toggle-floating', ['<Super>o']); migrateShortcuts(settings);
    equal(settings.get_strv('toggle-floating'), ['<Super>o']); // A later explicit choice belongs to the user.
    for (const value of [[], ['<Super>x'], ['<Super>f'], ['<Super>o', '<Alt>g']]) {
        const custom = migrationSettings({'preferences-version': 2, 'toggle-floating': value});
        migrateShortcuts(custom); equal(custom.get_strv('toggle-floating'), value);
    }
});
test('floating shortcut migration protects another action already using Super G', () => {
    const settings = migrationSettings({'preferences-version': 2,
        'toggle-floating': ['<Super>o'], 'cycle-focus': ['<Super>g']});
    migrateShortcuts(settings);
    equal(settings.get_strv('cycle-focus'), ['<Super>g']);
    equal(settings.get_strv('toggle-floating'), []);
});


test('pins reserve the preferred half while other windows share the remainder', () => {
    const area = {x: 0, y: 0, width: 1200, height: 800}, gaps = {inner: 10, outer: 0};
    const specs = new Map([[1, spec()], [2, spec()], [3, spec()]]);
    const tree = {axis: 'x', ratio: 0.5, a: {id: 2}, b: {axis: 'y', a: {id: 1}, b: {id: 3}}};
    const goals = new Map([[1, {x: 0, y: 0, width: 0.5, height: 1}]]);
    const next = pinnedLayout(tree, goals, area, specs, gaps), plan = checkPlan(next, area, specs, gaps);
    equal(plan.frames.get(1), {x: 0, y: 0, width: 600, height: 800});
    assert(plan.frames.get(2).x >= 610 && plan.frames.get(3).x >= 610);
});
test('a sole pinned window retains its rectangle and empty regions are not swap targets', () => {
    const area = {x: -100, y: 70, width: 1000, height: 800}, gaps = {inner: 10, outer: 0};
    const specs = new Map([[1, spec()]]), goals = new Map([[1, {x: 0.25, y: 0.25, width: 0.5, height: 0.5}]]);
    const tree = pinnedLayout({id: 1}, goals, area, specs, gaps), plan = checkPlan(tree, area, specs, gaps);
    equal(plan.frames.get(1), {x: 150, y: 270, width: 500, height: 400});
    equal(ids(tree), [1]); equal(plan.cells.size, 1);
    equal(withoutReservations(tree), {id: 1});
    equal(beginDrag(tree, 1, plan.frames, area, specs, gaps), null);
});
test('center pins allow windows on multiple sides instead of blocking the entire screen', () => {
    const area = {x: 0, y: 0, width: 1200, height: 800}, gaps = {inner: 10, outer: 0};
    const specs = new Map([1, 2, 3, 4, 5].map(id => [id, spec({minWidth: 270, minHeight: 300})]));
    let tree = null;
    for (const [id] of specs) tree = insert(tree, id, specs, area, gaps);
    assert(tree);
    const goals = new Map([[1, {x: 0.25, y: 0.25, width: 0.5, height: 0.5}]]);
    const next = pinnedLayout(tree, goals, area, specs, gaps), plan = checkPlan(next, area, specs, gaps);
    equal(plan.frames.get(1), {x: 300, y: 200, width: 600, height: 400});
    assert([...plan.frames].filter(([id, r]) => id !== 1 && r.x < 300).length > 0);
    assert([...plan.frames].filter(([id, r]) => id !== 1 && r.x >= 910).length > 0);
});
test('multiple pinned applications keep non-overlapping saved regions', () => {
    const area = {x: 0, y: 0, width: 1200, height: 800}, gaps = {inner: 10, outer: 0};
    const specs = new Map([1, 2, 3].map(id => [id, spec()]));
    const tree = {axis: 'x', a: {id: 1}, b: {axis: 'y', a: {id: 2}, b: {id: 3}}};
    const goals = new Map([[1, {x: 0, y: 0, width: 0.5, height: 1}],
        [2, {x: 610 / 1200, y: 0, width: 590 / 1200, height: 0.5}]]);
    const next = pinnedLayout(tree, goals, area, specs, gaps), plan = checkPlan(next, area, specs, gaps);
    equal(plan.frames.get(1), {x: 0, y: 0, width: 600, height: 800});
    equal(plan.frames.get(2), {x: 610, y: 0, width: 590, height: 400});
});
test('pins yield only as space requires and recover their stored position after closures', () => {
    const area = {x: 0, y: 0, width: 1200, height: 800}, gaps = {inner: 10, outer: 0};
    const specs = new Map([[1, spec()], [2, spec({minWidth: 650, minHeight: 600})]]);
    const goals = new Map([[1, {x: 0, y: 0, width: 0.5, height: 1}]]), saved = JSON.stringify([...goals]);
    const tree = {axis: 'x', a: {id: 1}, b: {id: 2}};
    const compressed = pinnedLayout(tree, goals, area, specs, gaps), plan = checkPlan(compressed, area, specs, gaps);
    assert(plan.frames.get(1).width === 540 && plan.frames.get(1).height === 800, 'Pin should yield only the required width');
    equal(JSON.stringify([...goals]), saved);
    const restored = pinnedLayout(remove(compressed, 2), goals, area, specs, gaps);
    equal(checkPlan(restored, area, specs, gaps).frames.get(1), {x: 0, y: 0, width: 600, height: 800});
});
test('controller pins survive pressure, closure, reopening and learning disabled', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {appId: 'browser.desktop'}], [2, {appId: 'other.desktop'}]]);
    c.learnLayouts = false;
    const wanted = {...a.read(1).rect};
    let saved;
    c.onPinnedLayouts = value => { saved = JSON.parse(JSON.stringify(value)); };
    c.togglePin(1); clock.run();
    assert(saved['app-id:browser.desktop']);
    equal(a.read(1).rect, wanted);
    for (let id = 3; id <= 7; id++) { a.add(id, {appId: `app${id}.desktop`}); c.event({kind: 'created', id}); clock.run(); }
    equal(c.pinnedLayouts, saved);
    for (let id = 2; id <= 7; id++) { a.windows.delete(id); c.event({kind: 'closed', id}); clock.run(); }
    equal(a.read(1).rect, wanted);
    a.windows.delete(1); c.event({kind: 'closed', id: 1}); clock.run();
    a.add(20, {appId: 'browser.desktop'}); c.event({kind: 'created', id: 20}); clock.run();
    equal(a.read(20).rect, wanted);
    c.togglePin(20); clock.run();
    equal(Object.keys(c.pinnedLayouts), []);
    equal(a.read(20).rect.width, AREA.width - 16);
    assert(!a.messages.some(message => message.level === 'error'));
});
test('only one instance per application reserves space, floating rules take precedence', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {appId: 'browser.desktop'}], [2, {appId: 'browser.desktop'}]]);
    c.togglePin(2); clock.run();
    equal([...c.pinGoals().keys()], [2]);
    a.add(3, {appId: 'browser.desktop'}); c.event({kind: 'created', id: 3}); clock.run();
    equal([...c.pinGoals().keys()], [2]);
    c.floatingApps = ['app-id:browser.desktop']; c.schedule(0); clock.run();
    assert([...c.records.values()].every(record => record.state === 'floating'));
    equal(c.pinGoals().size, 0);
    assert(Object.keys(c.pinnedLayouts).length === 1, 'Floating temporarily must not erase the anchor');
});

test('manual split edits and keyboard swaps update explicit pins with learning disabled', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {appId: 'browser.desktop'}], [2, {appId: 'other.desktop'}]]);
    c.learnLayouts = false;
    let pinSaves = 0, learnedSaves = 0;
    c.onPinnedLayouts = () => pinSaves++;
    c.onLearnedLayouts = () => learnedSaves++;
    c.togglePin(1); clock.run();
    const original = c.pinnedLayouts['app-id:browser.desktop'].width;
    beginEast(c); assert(c.resize);
    a.windows.get(1).rect.width += 90; endEast(c); clock.run();
    assert(c.pinnedLayouts['app-id:browser.desktop'].width > original);
    const resized = {...a.read(1).rect};
    c.schedule(0); clock.run(); equal(a.read(1).rect, resized);
    a.focusedId = () => 1; c.swapDirection('right'); clock.run();
    assert(c.pinnedLayouts['app-id:browser.desktop'].x > 0);
    assert(pinSaves === 3 && learnedSaves === 0);
    c.stop(); assert(c.pinOwners.size === 0 && c.pinCache.size === 0);
});
test('floating, maximizing and restoring keep the saved pin without reserving hidden space', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {appId: 'browser.desktop'}], [2, {appId: 'other.desktop'}]]);
    c.togglePin(1); clock.run();
    const wanted = {...a.read(1).rect}, saved = JSON.stringify(c.pinnedLayouts);
    c.toggleWindow(1); clock.run();
    equal(a.read(2).rect.width, AREA.width - 16);
    equal(JSON.stringify(c.pinnedLayouts), saved);
    c.toggleWindow(1); clock.run(); equal(a.read(1).rect, wanted);
    a.windows.get(1).maximized = true; c.event({kind: 'changed', id: 1}); clock.run();
    equal(a.read(2).rect.width, AREA.width - 16);
    a.windows.get(1).maximized = false; c.event({kind: 'changed', id: 1}); clock.run();
    equal(a.read(1).rect, wanted); equal(JSON.stringify(c.pinnedLayouts), saved);
    c.stop();
});
test('pin owners use workspace object identity and survive switching between identical applications', () => {
    const {clock, a, c, first, second, select} = workspaceSetup();
    a.windows.get(1).appId = 'browser.desktop'; a.windows.get(2).appId = 'browser.desktop';
    a.windows.get(3).appId = 'browser.desktop';
    c.togglePin(2); clock.run();
    const wanted = {...a.read(2).rect};
    equal([...c.pinGoals().keys()], [2]);
    select(second); equal([...c.pinGoals().keys()], [3]);
    equal(a.read(3).rect, wanted);
    select(first); equal([...c.pinGoals().keys()], [2]);
    assert(c.pinOwners.get(first).get('app-id:browser.desktop') === 2 &&
        c.pinOwners.get(second).get('app-id:browser.desktop') === 3);
    a.domains = [first]; c.event({kind: 'workspace'}); clock.run();
    assert(!c.pinCache.has(second) && !c.pinOwners.has(second));
    c.stop();
});
test('pinned regions scale to changed work areas without modifying persisted proportions', () => {
    const {clock, adapter: a, controller: c} = setup([[1, {appId: 'browser.desktop'}], [2, {appId: 'other.desktop'}]]);
    c.togglePin(1); clock.run();
    const goal = c.pinnedLayouts['app-id:browser.desktop'], saved = JSON.stringify(c.pinnedLayouts);
    a.workarea = {x: -200, y: 60, width: 1800, height: 1000}; c.event({kind: 'changed'}); clock.run();
    assert(Math.abs(a.read(1).rect.width - goal.width * (1800 - 16)) <= 1);
    assert(a.read(1).rect.x === -192);
    equal(JSON.stringify(c.pinnedLayouts), saved);
    c.stop();
});
test('generated pin layouts stay valid across varied gaps, positions, closures and size hints', () => {
    let cases = 0;
    for (const gap of [0, 8, 15]) for (const count of [2, 3, 4, 6, 8]) {
        const area = {x: -130, y: 53, width: 1800, height: 1100}, gaps = {inner: gap, outer: gap};
        const specs = new Map(Array.from({length: count}, (_, i) => [i + 1, spec({minWidth: 160, minHeight: 100})]));
        let tree = null;
        for (const [id] of specs) tree = insert(tree, id, specs, area, gaps);
        const before = checkPlan(tree, area, specs, gaps);
        for (const id of [1, count]) {
            const saved = normalizedFrame(before.frames.get(id), area, gaps);
            const goals = new Map([[id, saved]]);
            const next = pinnedLayout(tree, goals, area, specs, gaps);
            const plan = checkPlan(next, area, specs, gaps);
            assert(sameRect(plan.frames.get(id), before.frames.get(id), 1));
            for (const other of ids(next).filter(key => key !== id)) {
                const smaller = pinnedLayout(remove(next, other), goals, area, specs, gaps);
                checkPlan(smaller, area, specs, gaps);
            }
            cases++;
        }
    }
    equal(cases, 30);
});

test('pin shortcut migration preserves existing customized bindings instead of taking over Super Y', () => {
    const settings = migrationSettings({'preferences-version': 3, 'cycle-focus': ['<Super>y'],
        'toggle-floating': ['<Super>o']});
    migrateShortcuts(settings);
    equal(settings.get_strv('cycle-focus'), ['<Super>y']);
    equal(settings.get_strv('toggle-floating'), ['<Super>o']);
    equal(settings.get_strv('toggle-pin'), []);
    equal(settings.get_int('preferences-version'), 4);
    const customized = migrationSettings({'preferences-version': 3, 'toggle-pin': ['<Super><Shift>z']});
    migrateShortcuts(customized); equal(customized.get_strv('toggle-pin'), ['<Super><Shift>z']);
});

function balancedSetup(count = 2, learned = {}, pinned = {}) {
    const clock = new FakeClock(), adapter = new FakeAdapter(clock);
    adapter.workarea = {x: 0, y: 0, width: 1200, height: 900};
    for (let id = 1; id <= count; id++) adapter.add(id, {appId: `app${id}.desktop`});
    const controller = new Controller(adapter, clock, {inner: 0, outer: 0});
    controller.learnedLayouts = learned; controller.pinnedLayouts = pinned;
    adapter.event = e => controller.event(e);
    controller.start(); clock.run();
    const open = id => { adapter.add(id, {appId: `app${id}.desktop`}); controller.event({kind: 'created', id}); clock.run(); };
    return {clock, adapter, controller, open};
}
test('third unconfigured window gets one third of the screen despite focus preservation', () => {
    const {adapter: a, controller: c, open} = balancedSetup();
    equal(a.read(1).rect.width * a.read(1).rect.height, 540000);
    c.event({kind: 'focus', id: 1});
    open(3);
    for (const id of [1, 2, 3]) equal(a.read(id).rect.width * a.read(id).rect.height, 360000);
    equal(Object.keys(c.learnedLayouts), []); c.stop();
});
test('a learned half-screen region takes priority and other windows get one quarter each', () => {
    const saved = {'app-id:app1.desktop': {x: 0, y: 0, width: 0.5, height: 1}};
    const {adapter: a, controller: c, open} = balancedSetup(2, saved);
    let writes = 0; c.onLearnedLayouts = () => writes++;
    open(3);
    equal(a.read(1).rect, {x: 0, y: 0, width: 600, height: 900});
    for (const id of [2, 3]) equal(a.read(id).rect.width * a.read(id).rect.height, 270000);
    equal(c.learnedLayouts, saved); equal(writes, 0); c.stop();
});
test('pinned half-screen regions leave equally sized cells for all unconfigured windows', () => {
    const pinned = {'app-id:app1.desktop': {x: 0, y: 0, width: 0.5, height: 1}};
    const {adapter: a, controller: c, open} = balancedSetup(2, {}, pinned);
    for (const id of [3, 4, 5]) {
        open(id);
        equal(a.read(1).rect, {x: 0, y: 0, width: 600, height: 900});
        const areas = Array.from({length: id - 1}, (_, i) => a.read(i + 2).rect).map(r => r.width * r.height);
        assert(Math.max(...areas) / Math.min(...areas) < 1.01, `Free regions must balance independently of pinned regions: ${id} ${JSON.stringify(areas)} ${JSON.stringify(c.tree)}`);
    }
    equal(c.pinnedLayouts, pinned); c.stop();
});
test('learned sizes remain effective inside the free region around a pinned application', () => {
    const pinned = {'app-id:app1.desktop': {x: 0, y: 0, width: 0.5, height: 1}};
    const learned = {'app-id:app2.desktop': {x: 0.5, y: 0, width: 0.5, height: 0.5}};
    const {adapter: a, controller: c, open} = balancedSetup(2, learned, pinned);
    open(3); open(4);
    equal(a.read(1).rect, {x: 0, y: 0, width: 600, height: 900});
    equal(a.read(2).rect, {x: 600, y: 0, width: 600, height: 450});
    equal(a.read(3).rect.width * a.read(3).rect.height, 135000);
    equal(a.read(4).rect.width * a.read(4).rect.height, 135000);
    c.stop();
});
test('closing windows balances the remaining unsaved areas without writing learned sizes', () => {
    const {clock, adapter: a, controller: c, open} = balancedSetup();
    open(3); open(4); open(5);
    let writes = 0; c.onLearnedLayouts = () => writes++;
    for (const id of [4, 2]) {
        a.windows.delete(id); c.event({kind: 'closed', id}); clock.run();
        const areas = ids(c.tree).map(key => a.read(key).rect).map(r => r.width * r.height);
        assert(Math.max(...areas) / Math.min(...areas) < 1.01);
    }
    equal(writes, 0); c.stop();
});
test('balanced insertion respects constrained applications and never mutates the previous tree', () => {
    const area = {x: -51, y: 31, width: 1200, height: 900}, gaps = {inner: 15, outer: 15};
    const tree = {axis: 'x', ratio: 0.9, a: {id: 1}, b: {id: 2}}, saved = JSON.stringify(tree);
    const specs = new Map([[1, spec({minWidth: 700, minHeight: 600})], [2, spec()], [3, spec()]]);
    const next = insertBalanced(tree, 3, specs, area, gaps, 1, 'left');
    assert(next); checkPlan(next, area, specs, gaps); equal(JSON.stringify(tree), saved);
    specs.set(4, spec({minWidth: 2000, minHeight: 2000}));
    equal(insertBalanced(next, 4, specs, area, gaps), null);
});
test('repeated balanced insertions avoid exponentially shrinking leaves with gaps and odd dimensions', () => {
    for (const side of ['left', 'right']) {
        const area = {x: -301, y: 31, width: 1701, height: 1003}, gaps = {inner: 15, outer: 15};
        const specs = new Map(); let tree = null;
        for (let id = 1; id <= 12; id++) {
            specs.set(id, spec({minWidth: 100, minHeight: 80}));
            tree = insertBalanced(tree, id, specs, area, gaps, id - 1, side);
            const plan = checkPlan(tree, area, specs, gaps), areas = [...plan.frames.values()].map(r => r.width * r.height);
            assert(Math.max(...areas) / Math.min(...areas) < 1.15, 'Repeated insertions must keep comparable usable areas');
        }
    }
});

test('landscape layouts prefer stacking over equally sized tall columns', () => {
    const area = {x: 0, y: 0, width: 1000, height: 900}, gaps = {inner: 15, outer: 0};
    const specs = new Map([[1, spec()], [2, spec()]]);
    const tree = balancedLayout({axis: 'x', ratio: 0.5, a: {id: 1}, b: {id: 2}}, area, specs, gaps);
    const plan = checkPlan(tree, area, specs, gaps);
    assert([...plan.frames.values()].every(r => r.width > r.height), 'Prefer wide rows instead of tall columns');
});
test('learned full-height half-screen app yields temporarily around a pinned browser to avoid thin columns', () => {
    const clock = new FakeClock(), a = new FakeAdapter(clock);
    a.workarea = {x: 0, y: 24, width: 3840, height: 1080};
    a.add(1, {appId: 'browser.desktop'}); a.add(2, {appId: 'chat.desktop'});
    const c = new Controller(a, clock, {inner: 15, outer: 15});
    a.event = e => c.event(e);
    c.pinnedLayouts = {'app-id:browser.desktop': {x: 0, y: 0, width: 0.5, height: 1}};
    c.learnedLayouts = {'app-id:chat.desktop': {x: 0.5, y: 0, width: 0.5, height: 1}};
    const saved = JSON.stringify(c.learnedLayouts), pins = JSON.stringify(c.pinnedLayouts);
    let writes = 0; c.onLearnedLayouts = () => writes++; c.onPinnedLayouts = () => writes++;
    c.start(); clock.run();
    const browser = {...a.read(1).rect};
    for (const id of [3, 4, 5]) {
        a.add(id, {appId: `ordinary${id}.desktop`}); c.event({kind: 'created', id}); clock.run();
        equal(a.read(1).rect, browser);
        for (let key = 3; key <= id; key++) {
            const r = a.read(key).rect;
            assert(r.width >= r.height, `Unconfigured window must be landscape: ${id} ${key} ${JSON.stringify(r)}`);
        }
        checkPlan(c.tree, a.area(), c.layoutSpecs(), c.gaps);
        equal(JSON.stringify(c.learnedLayouts), saved); equal(JSON.stringify(c.pinnedLayouts), pins);
    }
    for (const id of [3, 4, 5]) { a.windows.delete(id); c.event({kind: 'closed', id}); clock.run(); }
    equal(a.read(2).rect.height, browser.height);
    equal(writes, 0); c.stop();
});
test('portrait screens and application minimum sizes remain valid when landscape geometry is impossible', () => {
    const area = {x: 0, y: 0, width: 700, height: 1400}, gaps = {inner: 15, outer: 15};
    const specs = new Map([[1, spec({minWidth: 500, minHeight: 600})], [2, spec({minWidth: 500, minHeight: 600})]]);
    const tree = insertBalanced({id: 1}, 2, specs, area, gaps);
    const plan = checkPlan(tree, area, specs, gaps);
    assert(plan.frames.size === 2, 'A shape preference must never reject a feasible native minimum');
});

test('preset palette geometry uses the work area and keeps hit tests outside gaps', () => {
    const geometry = layoutBarGeometry({x: -1600, y: 30, width: 1600, height: 900});
    equal(geometry.zones.length, 14);
    for (const zone of geometry.zones) equal(layoutHit({x: zone.hit.x + zone.hit.width / 2,
        y: zone.hit.y + zone.hit.height / 2}, geometry)?.id, zone.id);
    equal(layoutHit({x: geometry.frame.x + 2, y: geometry.frame.y + 2}, geometry), null);
    assert(insideBar({x: geometry.frame.x + 2, y: geometry.frame.y + 2}, geometry));
    equal(layoutHit({x: NaN, y: 0}, geometry), null);
    equal(layoutBarGeometry({x: 0, y: 0, width: 100, height: 100}), null);
    for (const width of [300, 700, 2000]) {
        const bar = layoutBarGeometry({x: 0, y: 0, width, height: 800});
        assert(bar.frame.x >= 0 && bar.frame.x + bar.frame.width <= width);
    }
});
test('preset frames preserve outer gaps and share inner gaps without overlap', () => {
    const area = {x: -21, y: 31, width: 1701, height: 1003}, gaps = {inner: 15, outer: 15};
    for (const preset of PRESETS) {
        const frames = preset.regions.map(region => presetFrame(region, area, gaps));
        for (const frame of frames) {
            assert(frame.width > 0 && frame.height > 0 && frame.x >= area.x + 15 && frame.y >= area.y + 15);
            assert(frame.x + frame.width <= area.x + area.width - 15 && frame.y + frame.height <= area.y + area.height - 15);
            for (const other of frames) if (other !== frame) assert(frame.x + frame.width <= other.x ||
                other.x + other.width <= frame.x || frame.y + frame.height <= other.y || other.y + other.height <= frame.y);
        }
    }
});
function assistantDrag(count = 2, id = 1, swap = true) {
    const context = balancedSetup(count), {controller: c, adapter: a} = context;
    c.layoutAssistant = true; c.dragSwap = swap;
    c.event({kind: 'grab-begin', id, grab: {kind: 'move', pointer: true}});
    assert(c.drag);
    a.windows.get(id).rect.x += 100;
    c.assistantVisible = c.assistantReady = true;
    return context;
}
test('dropping on a preset pins only the dragged application and preserves learning', () => {
    const {controller: c, adapter: a, clock} = assistantDrag();
    let saves = 0, learned = 0; c.onPinnedLayouts = () => saves++; c.onLearnedLayouts = () => learned++;
    const zone = layoutBarGeometry(a.area()).zones.find(item => item.id === 'quarters:0');
    const preview = c.presetPlan(zone.region);
    assert(preview && Object.keys(c.pinnedLayouts).length === 0, 'Preview must not persist a pin');
    a.point = {x: zone.hit.x + 3, y: zone.hit.y + 3};
    c.event({kind: 'grab-end', id: 1}); clock.run();
    equal(a.read(1).rect, presetFrame(zone.region, a.area(), c.gaps));
    equal(saves, 1); equal(learned, 0); assert(!c.drag);
    c.stop();
});
test('assistant supports a sole tiled window and restores cancelled preset drags', () => {
    for (const choose of [true, false]) {
        const {controller: c, adapter: a, clock} = assistantDrag(1);
        const original = {...c.drag.frame};
        const zone = layoutBarGeometry(a.area()).zones[0];
        a.point = choose ? {x: zone.hit.x + 3, y: zone.hit.y + 3} : {x: 5, y: 600};
        c.event({kind: 'grab-end', id: 1}); clock.run();
        equal(c.records.get(1).state, 'tiled');
        if (!choose) equal(a.read(1).rect, original);
        equal(Object.keys(c.pinnedLayouts).length, choose ? 1 : 0); c.stop();
    }
});
test('assistant drops in empty space restore the original grid without changing saved preferences', () => {
    for (const count of [1, 2]) for (const swap of [true, false]) for (const visible of [true, false]) {
        const {controller: c, adapter: a, clock} = assistantDrag(count, 1, swap);
        const frame = {...c.drag.frame}, tree = c.drag.tree;
        const pins = JSON.stringify(c.pinnedLayouts), learning = JSON.stringify(c.learnedLayouts);
        c.assistantVisible = c.assistantReady = visible;
        a.point = {x: a.area().x - 20, y: a.area().y + 200};
        c.event({kind: 'grab-end', id: 1}); clock.run();
        equal(c.records.get(1).state, 'tiled'); equal(a.read(1).rect, frame);
        assert(c.tree === tree && !c.drag && c.records.get(1).override !== 'floating');
        equal(JSON.stringify(c.pinnedLayouts), pins); equal(JSON.stringify(c.learnedLayouts), learning);
        c.stop();
    }
});
test('assistant still swaps on a valid target and retains a pinned region on cancelled drops', () => {
    const {controller: c, adapter: a, clock} = assistantDrag(2);
    const target = {...a.read(2).rect}; a.point = center(target);
    c.event({kind: 'grab-end', id: 1}); clock.run(); equal(a.read(1).rect, target);
    c.togglePin(1); clock.run();
    const pins = JSON.stringify(c.pinnedLayouts), frame = {...a.read(1).rect};
    c.event({kind: 'grab-begin', id: 1, grab: {kind: 'move', pointer: true}});
    assert(c.drag); a.windows.get(1).rect.x += 100;
    a.point = {x: -100, y: -100};
    c.event({kind: 'grab-end', id: 1}); clock.run();
    equal(a.read(1).rect, frame); equal(JSON.stringify(c.pinnedLayouts), pins);
    equal(c.records.get(1).state, 'tiled'); c.stop();
});
test('Esc-like restored geometry and bar gaps never pin or accidentally swap', () => {
    for (const cancel of [true, false]) {
        const {controller: c, adapter: a, clock} = assistantDrag();
        const original = c.drag.tree, frame = {...c.drag.frame};
        const bar = layoutBarGeometry(a.area()), zone = bar.zones[0];
        if (cancel) a.windows.get(1).rect = frame;
        a.point = cancel ? {x: zone.hit.x + 3, y: zone.hit.y + 3} : {x: bar.frame.x + 2, y: bar.frame.y + 2};
        c.event({kind: 'grab-end', id: 1}); clock.run();
        equal(Object.keys(c.pinnedLayouts).length, 0); assert(c.tree === original);
        equal(a.read(1).rect, frame); c.stop();
    }
});
test('occupied pin regions and incompatible minima are unavailable without changing preferences', () => {
    const {controller: c, adapter: a, clock} = assistantDrag();
    const goal = {x: 0, y: 0, width: 0.5, height: 1};
    c.drag = null; c.pinnedLayouts = {'app-id:app2.desktop': goal}; c.pinCache.clear(); c.schedule(0); clock.run();
    c.event({kind: 'grab-begin', id: 1, grab: {kind: 'move', pointer: true}}); assert(c.drag);
    a.windows.get(1).rect.x += 100; c.assistantVisible = c.assistantReady = true;
    const zone = layoutBarGeometry(a.area()).zones[0];
    assert(!c.presetFits(zone.region) && !c.presetPlan(zone.region));
    a.point = {x: zone.hit.x + 3, y: zone.hit.y + 3};
    c.event({kind: 'grab-end', id: 1}); clock.run();
    equal(c.pinnedLayouts, {'app-id:app2.desktop': goal}); equal(c.records.get(1).state, 'tiled');
    c.stop();
});
test('preset release rejects changed workspace, geometry, settings and pins', () => {
    for (const change of ['area', 'pins', 'disabled', 'workspace']) {
        const {controller: c, adapter: a, clock} = assistantDrag();
        const zone = layoutBarGeometry(a.area()).zones[0]; assert(c.presetPlan(zone.region));
        if (change === 'area') a.workarea.width -= 100;
        if (change === 'pins') c.pinnedLayouts = {'app-id:outside.desktop': {x: 0, y: 0, width: 0.5, height: 1}};
        if (change === 'disabled') c.layoutAssistant = false;
        if (change === 'workspace') a.activeWorkspace = () => 'another-workspace';
        a.point = {x: zone.hit.x + 3, y: zone.hit.y + 3};
        c.event({kind: 'grab-end', id: 1}); clock.run();
        assert(!Object.hasOwn(c.pinnedLayouts, 'app-id:app1.desktop')); c.stop();
    }
});

test('layout assistant remains independent of drag swapping', () => {
    const {controller: c, adapter: a, clock} = assistantDrag();
    c.drag = null; c.dragSwap = false;
    a.windows.get(1).rect.x -= 100;
    c.event({kind: 'grab-begin', id: 1, grab: {kind: 'move', pointer: true}});
    assert(c.drag?.assistantOnly);
    a.windows.get(1).rect.x += 100; c.assistantVisible = c.assistantReady = true;
    const zone = layoutBarGeometry(a.area()).zones[0];
    a.point = {x: zone.hit.x + 3, y: zone.hit.y + 3};
    c.event({kind: 'grab-end', id: 1}); clock.run();
    equal(a.read(1).rect, presetFrame(zone.region, a.area(), c.gaps));
    equal(Object.keys(c.pinnedLayouts).length, 1); c.stop();
});
test('a preset smaller than the native minimum cannot pin or float the source', () => {
    const {controller: c, adapter: a, clock} = balancedSetup(1);
    a.windows.get(1).minWidth = 900; c.schedule(0); clock.run();
    c.layoutAssistant = true;
    c.event({kind: 'grab-begin', id: 1, grab: {kind: 'move', pointer: true}});
    assert(c.drag);
    a.windows.get(1).rect.x += 100; c.assistantVisible = c.assistantReady = true;
    const zone = layoutBarGeometry(a.area()).zones[0];
    assert(!c.presetFits(zone.region) && !c.presetPlan(zone.region));
    a.point = {x: zone.hit.x + 3, y: zone.hit.y + 3};
    c.event({kind: 'grab-end', id: 1}); clock.run();
    equal(c.records.get(1).state, 'tiled'); equal(Object.keys(c.pinnedLayouts).length, 0); c.stop();
});
print(`\n${passed} tests passed. Pure GJS tests: no compositor, D-Bus session or window mutation.`);
