// SPDX-License-Identifier: GPL-3.0-or-later
import {Controller} from './controller.js';
import {MonitorAdapter} from './monitorAdapter.js';
import {learningMatch} from './learning.js';
import {exclusion, matchesApp} from './rules.js';

const SETTINGS = ['gaps', 'floatingApps', 'pinnedLayouts', 'learnedLayouts', 'learnLayouts',
    'debug', 'resizeSplits', 'dragSwap', 'layoutAssistant', 'insertionSide', 'preserveFocusedWindow'];
const INTERACTION = ['assistantVisible', 'assistantReady', 'learningPending'];

// One engine per monitor, each retaining its existing independent workspace
// layouts. Preferences and local application profiles are shared by all engines.
export class Monitors {
    constructor(adapter, clock, gaps = {inner: 8, outer: 8}) {
        this.adapter = adapter;
        this.clock = clock;
        this.workers = new Map();
        this.parked = new Map();
        this.placed = new Set();
        this.placing = false;
        this.options = {gaps};
        this.running = false;
        this.suspended = false;
        this.onStateChanged = null;
        this.onPinnedLayouts = null;
        this.onLearnedLayouts = null;
        this.syncWorkers();
    }
    owner(id) { return [...this.workers.values()].find(worker => worker.records.has(id)); }
    selected(id = this.adapter.focusedId?.()) {
        return this.workers.get(this.adapter.read(id)?.monitor ?? 0) ?? this.owner(id) ?? this.workers.values().next().value;
    }
    interacting() { return [...this.workers.values()].find(worker => worker.drag || worker.resize) ?? this.selected(); }
    get records() { return new Map([...this.workers.values()].flatMap(worker => [...worker.records])); }
    get drag() { return [...this.workers.values()].find(worker => worker.drag)?.drag ?? null; }
    get resize() { return [...this.workers.values()].find(worker => worker.resize)?.resize ?? null; }
    get tree() { return this.selected()?.tree ?? null; }
    get trees() { return this.selected()?.trees ?? new Map(); }
    get domain() { return this.interacting()?.domain; }
    get pinCache() { return {clear: () => { for (const worker of this.workers.values()) worker.pinCache.clear(); }}; }
    changed() { this.onStateChanged?.(); }
    sharedProfile(key, callback, value) {
        this.options[key] = value;
        for (const worker of this.workers.values()) {
            worker[key] = value;
            if (key === 'pinnedLayouts') worker.pinCache.clear();
            worker.schedule(0);
        }
        this[callback]?.(value);
    }
    syncWorkers() {
        const count = this.adapter.monitorCount();
        for (let index = 0; index < count; index++) {
            if (this.workers.has(index)) continue;
            const scoped = new MonitorAdapter(this.adapter, index, (id, target) => {
                const owner = this.owner(id);
                return !this.parked.has(id) &&
                    (!owner || owner.adapter.index === target || !owner.records.get(id)?.grabbed);
            });
            const worker = new Controller(scoped, this.clock, this.options.gaps);
            const reconcile = worker.reconcile.bind(worker);
            worker.reconcile = () => { this.placeNewWindows(); this.transferWindows(); reconcile(); };
            const localLearningWindows = worker.learningWindows.bind(worker);
            worker.learningWindows = extra => {
                const windows = localLearningWindows(extra);
                // A saved application preference must still represent a sole
                // tiled instance, even when its other instance is on another monitor.
                for (const other of this.workers.values()) if (other !== worker)
                    for (const [id, record] of other.records)
                        if (record.state === 'tiled') windows.set(id, other.adapter.read(id));
                return windows;
            };
            for (const key of SETTINGS) {
                if (key in this.options) worker[key] = this.options[key];
                else this.options[key] = worker[key];
            }
            worker.onStateChanged = () => this.changed();
            worker.onPinnedLayouts = apps => this.sharedProfile('pinnedLayouts', 'onPinnedLayouts', apps);
            worker.onLearnedLayouts = apps => this.sharedProfile('learnedLayouts', 'onLearnedLayouts', apps);
            this.workers.set(index, worker);
            if (this.running && !this.suspended) worker.start();
        }
        this.transferWindows();
        for (const [id, record] of this.parked) {
            const data = this.adapter.read(id);
            if (!data) { this.parked.delete(id); continue; }
            const target = this.workers.get(data.monitor ?? 0);
            if (target && target.adapter.index < count) {
                this.attach(record, target);
                this.parked.delete(id);
            }
        }
        for (const [index, worker] of this.workers) {
            if (index < count) continue;
            // Mutter relocates windows before notifying topology changes. Do not
            // restore obsolete snapshots into a monitor that no longer exists.
            for (const [id, record] of worker.records) this.parked.set(id, record);
            worker.records.clear();
            worker.onStateChanged = null;
            worker.stop();
            this.workers.delete(index);
        }
    }
    placeNewWindows() {
        if (this.placing || !this.running || this.suspended) return;
        this.placing = true;
        try {
            for (const id of this.adapter.list()) {
                if (this.placed.has(id)) continue;
                const data = this.adapter.read(id), record = this.owner(id)?.records.get(id);
                if (!data?.ready || record?.grabbed) continue;
                const key = learningMatch(data, this.pinnedLayouts ?? {});
                if (!key && !data.appId && !data.wmClass) continue;
                this.placed.add(id);
                const saved = key && this.pinnedLayouts[key].monitor;
                if (!saved || exclusion({...data, resizable: data.maximized ? true : data.resizable}) || matchesApp(data, this.floatingApps ?? []) ||
                    record?.override === 'floating') continue;
                const target = this.adapter.preferredMonitor?.(saved) ??
                    (saved.index < this.adapter.monitorCount() ? saved.index : this.adapter.primaryMonitor?.() ?? 0);
                if (target !== data.monitor) this.adapter.moveToMonitor?.(id, target);
            }
        } finally { this.placing = false; }
    }
    transferWindows(released = null) {
        for (const worker of this.workers.values()) for (const [id, record] of worker.records) {
            const data = this.adapter.read(id), target = data && this.workers.get(data.monitor ?? 0);
            if (!target || target === worker) continue;
            if (record.grabbed && id !== released && worker.adapter.index < this.adapter.monitorCount()) continue;
            worker.removeWindow(id);
            if (worker.drag?.id === id) worker.drag = null;
            if (worker.resize?.id === id) worker.resize = null;
            worker.records.delete(id);
            this.attach(record, target);
            this.adapter.log('info', `Window ${id} transferred monitor ${worker.adapter.index} -> ${target.adapter.index}`);
            worker.schedule(0);
        }
    }
    attach(record, target) {
        record.snapshot = null;
        record.request = null;
        record.touched = false;
        record.grabbed = false;
        record.domain = target.adapter.read(record.id)?.domain ?? target.domain;
        if (record.override !== 'floating' && !['app-exception', 'user-maximized'].includes(record.reason)) {
            record.state = 'pending'; record.born = this.clock.now();
        }
        target.records.set(record.id, record);
        target.schedule(0);
    }
    start() {
        if (this.suspended) this.stop();
        this.running = true;
        this.suspended = false;
        this.syncWorkers();
        for (const worker of this.workers.values()) worker.start();
        this.changed();
    }
    stop() {
        this.running = false;
        this.parked.clear();
        this.placed.clear();
        for (const worker of this.workers.values()) worker.stop();
        this.changed();
    }
    suspend(reason, notify = true) {
        this.suspended = true;
        for (const worker of this.workers.values()) worker.suspend(reason, false);
        if (notify) this.adapter.notice(reason);
        this.changed();
    }
    event(event) {
        if (!this.running || this.suspended) return;
        if (event.kind === 'closed') { this.parked.delete(event.id); this.placed.delete(event.id); }
        this.syncWorkers();
        if (event.kind === 'grab-end') this.transferWindows(event.id);
        for (const worker of this.workers.values()) {
            const held = [...worker.records.values()].some(record => record.grabbed &&
                (this.adapter.read(record.id)?.monitor ?? 0) !== worker.adapter.index);
            if (held && !['closed', 'grab-end'].includes(event.kind)) continue;
            worker.event(event);
        }
    }
    schedule(delay) { for (const worker of this.workers.values()) worker.schedule(delay); }
    applyAppRule(data) { for (const worker of this.workers.values()) worker.applyAppRule(data); }
    toggleWindow(id) { return this.selected(id)?.toggleWindow(id); }
    togglePin(id) { return this.selected(id)?.togglePin(id); }
    cycleFocus() { return this.selected()?.cycleFocus(); }
    swapDirection(direction) { return this.selected()?.swapDirection(direction); }
    numberedSwapContext() { return this.selected()?.numberedSwapContext() ?? null; }
    validNumberedSwap(context) { return this.owner(context?.id)?.validNumberedSwap(context) ?? false; }
    selectNumberedSwap(context, number) { return this.owner(context?.id)?.selectNumberedSwap(context, number) ?? false; }
    validLayoutContext(context) { return this.owner(context?.id)?.validLayoutContext(context) ?? false; }
    presetFits(region) { return this.interacting()?.presetFits(region) ?? false; }
    presetPlan(region) { return this.interacting()?.presetPlan(region) ?? null; }
    previewDrag(point) { return this.interacting()?.previewDrag(point) ?? null; }
}
for (const key of [...SETTINGS, ...INTERACTION]) Object.defineProperty(Monitors.prototype, key, {
    get() { return key in this.options ? this.options[key] : this.interacting()?.[key]; },
    set(value) {
        if (SETTINGS.includes(key)) this.options[key] = value;
        for (const worker of this.workers.values()) worker[key] = value;
    },
});
