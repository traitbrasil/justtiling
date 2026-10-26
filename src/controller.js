// SPDX-License-Identifier: GPL-3.0-or-later
import {N_} from './strings.js';
import {ids, remove, sameRect, solve} from './layout/tree.js';
import {appIdentities, constraints, exclusion, matchesApp} from './rules.js';
import {learningIdentity, learningMatch, normalizedFrame, uniqueLearningKey} from './learning.js';
import {beginDrag, finishDrag, swapTiles, directionalNeighbor} from './layout/drag.js';
import {beginResize, finishResize, sameSpecs} from './layout/resize.js';

import {dragMoved, insideBar, layoutBarGeometry, layoutHit, presetFrame} from './layout/presets.js';
import {balancedLayout, comfortableLearning, insertBalanced} from './layout/balance.js';
import {pinnedLayout, withoutReservations} from './pinning.js';

const SETTLE_MS = 400;
const READY_MS = 2000;
const MAX_CORRECTIONS = 2;
const MAX_TILES = 64;

// The adapter owns all native objects. The controller owns only IDs and plain data.
export class Controller {
    constructor(adapter, clock, gaps = {inner: 8, outer: 8}) {
        this.adapter = adapter;
        this.clock = clock;
        this.gaps = gaps;
        this.records = new Map();
        this.trees = new Map();
        this.domain = 0;
        this.tree = null;
        this.running = false;
        this.suspended = false;
        this.timer = null;
        this.due = Infinity;
        this.lastFocus = null;
        this.insertionSide = 'right';
        this.preserveFocusedWindow = true;
        this.focusByDomain = new Map();
        this.floatingApps = [];
        this.debug = false;
        this.onStateChanged = null;
        this.resizeSplits = true;
        this.dragSwap = true;
        this.layoutAssistant = false;
        this.assistantVisible = false;
        this.assistantReady = false;
        this.drag = null;
        this.resize = null;
        this.pinnedLayouts = Object.create(null);
        this.onPinnedLayouts = null;
        this.pinOwners = new Map();
        this.pinCache = new Map();
        this.balancePending = new Set();
        this.learnLayouts = true;
        this.learnedLayouts = Object.create(null);
        this.onLearnedLayouts = null;
        this.learningPending = null;
    }

    changed() {
        try { this.onStateChanged?.(); }
        catch (e) { this.adapter.log('warn', `Status update: ${e}`); }
    }

    get tree() { return this.trees.get(this.domain) ?? null; }
    set tree(value) {
        if (value) this.trees.set(this.domain, value);
        else this.trees.delete(this.domain);
    }

    removeWindow(id) {
        // One owner per window, including closures and transfers on inactive workspaces.
        for (const [domain, tree] of this.trees) {
            const next = remove(tree, id);
            // Excluded desktop/dialog windows are reconsidered every reconcile.
            // They must not cancel a manual intent when no tile was removed.
            if (next !== tree) { this.learningPending = null; this.balancePending.add(domain); }
            if (next) this.trees.set(domain, next);
            else this.trees.delete(domain);
        }
    }

    start() {
        if (this.running && !this.suspended) return;
        if (this.suspended) this.stop();
        this.suspended = false;
        this.running = true;
        this.schedule(0);
        this.changed();
    }

    event({kind, id, grab}) {
        if (!this.running || this.suspended)
            return;
        const r = this.records.get(id);
        if (kind === 'closed') {
            if (this.resize?.id === id) this.resize = null;
            if (this.drag?.id === id) this.drag = null;
            this.removeWindow(id);
            this.records.delete(id);
        } else if (kind === 'focus') {
            if (r?.state === 'tiled') {
                this.lastFocus = id;
                this.focusByDomain.set(r.domain, id);
            }
            return;
        } else if (kind === 'grab-begin' && r && ['tiled', 'preparing', 'floating'].includes(r.state)) {
            if (this.drag && this.drag.id !== id) this.cancelDrag('drag-context-changed');
            if (grab?.kind === 'move' && grab.pointer && (this.dragSwap || this.layoutAssistant) && r.state === 'tiled' &&
                this.beginDrag(r)) return;
            if (grab?.kind === 'resize' && this.resizeSplits && r.state === 'tiled' &&
                this.beginSplitResize(r, grab.edges)) return;
            if (this.resize) this.cancelSplitResize('resize-context-changed');
            if (this.drag) this.cancelDrag('drag-context-changed');
            // Yield before the user starts moving. Never fight native snap/resize.
            if (r.state !== 'floating') {
                this.float(r, 'user-interaction', false);
                r.override = 'floating';
            }
            r.grabbed = true;
        } else if (kind === 'grab-end' && r) {
            if (this.resize?.id === id) this.endSplitResize();
            if (this.drag?.id === id) this.endDrag();
            r.grabbed = false;
        } else if (kind === 'geometry') {
            if (this.resize || this.drag) return;
            if (r?.state !== 'tiled') {
                // A late compositor actor/frame can become ready through geometry
                // alone. Retry timed-out readiness, never explicit floating choices.
                if (r?.state === 'floating' && r.override !== 'floating') {
                    const data = this.adapter.read(id);
                    if ((r.reason === 'not-ready' && data?.ready) ||
                        (r.reason === 'user-maximized' && data && !data.maximized))
                        this.schedule(30);
                }
                return;
            }
            this.schedule(SETTLE_MS);
            return;
        }
        this.schedule(30);
    }

    schedule(delay) {
        if (!this.running || this.suspended)
            return;
        const due = this.clock.now() + delay;
        if (this.timer !== null && this.due <= due)
            return;
        if (this.timer !== null) this.clock.cancel(this.timer);
        this.due = due;
        this.timer = this.clock.after(delay, () => {
            this.timer = null;
            this.due = Infinity;
            try {
                this.reconcile();
            } catch (error) {
                this.adapter.log('error', `Controller stopped: ${error.stack ?? error}`);
                this.stop();
            }
            this.changed();
        });
    }

    suspend(reason, notify = true) {
        this.learningPending = null;
        if (this.suspended) return;
        this.suspended = true;
        if (this.timer !== null) this.clock.cancel(this.timer);
        this.timer = null;
        this.due = Infinity;
        for (const r of this.records.values()) {
            this.release(r, !r.grabbed);
            r.grabbed = false;
        }
        this.resize = null;
        this.drag = null;
        this.trees.clear();
        this.pinCache.clear();
        this.pinOwners.clear();
        this.balancePending.clear();
        this.adapter.log('warn', `${reason}; use the toggle to restart explicitly.`);
        if (notify) this.adapter.notice(reason);
        this.changed();
    }

    stop() {
        this.learningPending = null;
        this.running = false;
        if (this.timer !== null) this.clock.cancel(this.timer);
        this.timer = null;
        this.due = Infinity;
        for (const r of this.records.values()) {
            this.release(r, !r.grabbed);
            r.grabbed = false;
        }
        this.resize = null;
        this.drag = null;
        this.records.clear();
        this.trees.clear();
        this.pinCache.clear();
        this.pinOwners.clear();
        this.balancePending.clear();
        this.focusByDomain.clear();
        this.changed();
    }

    capture(r) {
        r.snapshot ??= this.adapter.capture(r.id);
    }

    release(r, restoreGeometry) {
        try {
            if (!this.adapter.read(r.id)?.alive) return;
            if (restoreGeometry && r.touched && r.snapshot)
                this.adapter.restore(r.id, r.snapshot);
        } catch (e) {
            this.adapter.log('warn', `Restore ${r.id}: ${e}`);
        } finally {
            r.touched = false;
            r.request = null;
            r.snapshot = null;
        }
    }

    float(r, reason, restore = true) {
        // Preserve native stacking: forcing always-on-top here can make Mutter
        // announce subsequently mapped helper windows as needing attention.
        if (this.resize?.id === r.id) this.resize = null;
        if (this.drag?.id === r.id) this.drag = null;
        this.removeWindow(r.id);
        this.release(r, restore);
        r.state = 'floating';
        r.reason = reason;
        const warning = ['not-ready', 'prepare-timeout', 'resize-not-converged'].includes(reason);
        this.adapter.log(warning ? 'warn' : 'info', `Floating ${r.id}: ${reason}`);
    }

    toggleWindow(id) {
        if (!this.running || this.suspended) {
            this.adapter.notice(N_("Enable automatic tiling before toggling a window."));
            return;
        }
        if (this.adapter.activeWorkspace) this.domain = this.adapter.activeWorkspace();
        const r = this.records.get(id);
        const d = this.adapter.read(id);
        if (!r || exclusion(d) || !d.ready) {
            this.adapter.notice(N_("This window is not ready or cannot participate in tiling."));
            return;
        }
        if (['tiled', 'preparing', 'pending'].includes(r.state)) {
            r.override = 'floating';
            this.float(r, 'user-toggle');
        } else {
            this.release(r, true);
            r.override = 'tiled';
            r.state = 'pending';
            r.born = this.clock.now();
        }
        this.schedule(0);
    }

    cycleFocus() {
        if (!this.running || this.suspended || this.resize || this.drag || this.adapter.monitorCount() !== 1) return;
        const domain = this.adapter.activeWorkspace?.() ?? this.domain;
        if (domain !== this.domain || !this.adapter.targetActive()) return;
        const windows = ids(this.tree).map(id => ({id, data: this.adapter.read(id)}));
        // Fullscreen yields to the application rather than stealing its focus.
        if (this.adapter.list().some(id => {
            const data = this.adapter.read(id);
            return data?.inScope && data.fullscreen;
        })) return;
        const candidates = windows.filter(({id, data}) => this.records.get(id)?.state === 'tiled' &&
            !exclusion(data) && data.ready && !data.maximized)
            .sort((a, b) => a.data.rect.y - b.data.rect.y || a.data.rect.x - b.data.rect.x || a.id - b.id);
        if (!candidates.length) return;
        const current = this.adapter.focusedId?.(), index = candidates.findIndex(item => item.id === current);
        const next = candidates[(index + 1) % candidates.length].id;
        if (next === current) return;
        this.adapter.focusWindow(next);
    }

    swapDirection(direction) {
        if (!this.running || this.suspended || this.resize || this.drag || this.adapter.monitorCount() !== 1) return;
        if (this.adapter.activeWorkspace) this.domain = this.adapter.activeWorkspace();
        const id = this.adapter.focusedId?.(), data = this.adapter.read(id);
        if (this.records.get(id)?.state !== 'tiled' || exclusion(data) || !data.ready || data.maximized) {
            this.adapter.notice(N_("Select a tiled window to swap positions.")); return;
        }
        const specs = this.layoutSpecs(), area = this.adapter.area();
        const plan = solve(this.tree, area, specs, this.gaps);
        if (!plan || [...plan.frames].some(([key, frame]) => !sameRect(this.adapter.read(key)?.rect, frame, 1))) return;
        const target = directionalNeighbor(plan.cells, id, direction);
        if (target === null) return;
        const next = swapTiles(this.tree, id, target, area, specs, this.gaps);
        if (!next) { this.adapter.notice(N_("The two windows do not fit in their destination positions.")); return; }
        this.tree = next;
        this.queueLearning([id, target]);
        for (const key of ids(next)) this.records.get(key).request = null;
        this.schedule(0);
    }

    numberedSwapContext() {
        if (!this.running || this.suspended || this.resize || this.drag ||
            this.adapter.monitorCount() !== 1 || !this.adapter.targetActive() ||
            this.adapter.activeWorkspace?.() !== this.domain) return null;
        const id = this.adapter.focusedId?.();
        if (this.records.get(id)?.state !== 'tiled') return null;
        const frames = new Map(ids(this.tree).map(key => [key, this.adapter.read(key)?.rect]));
        const context = beginDrag(this.tree, id, frames, this.adapter.area(), this.layoutSpecs(), this.gaps);
        if (!context) return null;
        const targets = [...context.plan.frames].filter(([key]) => key !== id)
            .sort(([a, ar], [b, br]) => ar.y - br.y || ar.x - br.x || a - b).map(([key]) => key);
        return {...context, domain: this.domain, rules: [...this.floatingApps], targets};
    }

    validNumberedSwap(context) {
        const focus = this.adapter.focusedId?.();
        return !!context && this.running && !this.suspended && !this.resize && !this.drag &&
            this.adapter.targetActive() && this.adapter.activeWorkspace?.() === context.domain &&
            (focus === null || focus === undefined || focus === context.id) &&
            this.validLayoutContext(context) && [...context.plan.frames].every(([id, frame]) =>
                sameRect(this.adapter.read(id)?.rect, frame, 1));
    }

    selectNumberedSwap(context, number) {
        if (!this.validNumberedSwap(context) || !Number.isInteger(number) ||
            number < 1 || number > context.targets.length) return false;
        const target = context.targets[number - 1];
        const next = swapTiles(this.tree, context.id, target, context.area, context.specs, context.gaps);
        if (!next) {
            this.adapter.notice(N_("The two windows do not fit in their destination positions."));
            return false;
        }
        this.tree = next;
        this.queueLearning([context.id, target]);
        for (const id of ids(next)) this.records.get(id).request = null;
        this.schedule(0);
        this.adapter.focusWindow(context.id);
        return true;
    }

    activePin(data) {
        const key = data && learningMatch(data, this.pinnedLayouts);
        return key && (this.adapter.pinApplies?.(this.pinnedLayouts[key]) ?? true) ? key : null;
    }
    pinGoals() {
        const goals = new Map(), candidates = new Map();
        for (const id of ids(this.tree)) {
            const data = this.adapter.read(id), key = this.activePin(data);
            if (!key) continue;
            if (!candidates.has(key)) candidates.set(key, []);
            candidates.get(key).push(id);
        }
        for (const [key, windows] of candidates) {
            if (!this.pinOwners.has(this.domain)) this.pinOwners.set(this.domain, new Map());
            const owners = this.pinOwners.get(this.domain);
            const owner = windows.includes(owners.get(key)) ? owners.get(key) : windows[0];
            owners.set(key, owner);
            goals.set(owner, this.pinnedLayouts[key]);
        }
        return goals;
    }

    pinMonitor() {
        const monitor = this.adapter.monitorIdentity?.(this.adapter.index ?? 0);
        return monitor ? {monitor} : {};
    }
    togglePin(id) {
        if (!this.running || this.suspended) return;
        if (this.adapter.activeWorkspace) this.domain = this.adapter.activeWorkspace();
        const data = this.adapter.read(id), key = data && learningIdentity(data);
        if (!key) return;
        const existing = learningMatch(data, this.pinnedLayouts), apps = {...this.pinnedLayouts};
        if (existing) delete apps[existing];
        else {
            if (this.records.get(id)?.state !== 'tiled' || exclusion(data) || !data.ready || data.maximized) {
                this.adapter.notice(N_("Select a tiled window to pin this application.")); return;
            }
            const frame = normalizedFrame(data.rect, this.adapter.area(), this.gaps);
            if (!frame || Object.keys(apps).length >= 128) return;
            apps[key] = {...frame, ...this.pinMonitor()};
            if (!this.pinOwners.has(this.domain)) this.pinOwners.set(this.domain, new Map());
            this.pinOwners.get(this.domain).set(key, id);
        }
        this.pinnedLayouts = apps;
        this.learningPending = null;
        this.pinCache.clear();
        this.onPinnedLayouts?.(apps);
        this.adapter.notice(existing ? N_("Application unpinned.") : N_("Application pinned. Preferred position and size saved."));
        this.schedule(0);
        this.changed();
    }

    fitPins(area, specs) {
        if (this.learningPending) return; // Explicit manual edits settle before saving a new anchor.
        const goals = this.pinGoals();
        const savedGoals = JSON.stringify([...goals]);
        const signature = JSON.stringify({goals: [...goals], area, gaps: this.gaps, specs: [...specs]});
        const cache = this.pinCache.get(this.domain);
        const rebalance = this.balancePending.has(this.domain) ||
            (cache?.goals !== undefined && cache.goals !== savedGoals);
        if (!rebalance && cache?.tree === this.tree && cache.signature === signature) return;
        let tree = this.tree;
        if (rebalance) tree = this.preferredBalance(withoutReservations(tree), area, specs, this.gaps);
        const remainder = rebalance ? (part, region) => this.preferredBalance(part, region, specs,
            {inner: this.gaps.inner, outer: 0}) : null;
        this.tree = pinnedLayout(tree, goals, area, specs, this.gaps, remainder);
        this.balancePending.delete(this.domain);
        this.pinCache.set(this.domain, {tree: this.tree, signature, goals: savedGoals});
    }

    learningWindows(extra = null) {
        const windows = new Map();
        for (const [id, r] of this.records) {
            const data = this.adapter.read(id);
            if ((r.state === 'tiled' || id === extra) && !exclusion({...data, inScope: true}) && data.ready)
                windows.set(id, data);
        }
        return windows;
    }

    queueLearning(affected) {
        this.learningPending = (this.learnLayouts || this.pinGoals().size > 0) && affected.length ?
            {tree: this.tree, domain: this.domain, affected, area: {...this.adapter.area()},
                gaps: {...this.gaps}, specs: this.layoutSpecs()} : null;
    }

    commitLearning(plan) {
        const pending = this.learningPending;
        if (!pending) return;
        if (pending.tree !== this.tree || pending.domain !== this.domain ||
            !sameRect(pending.area, this.adapter.area()) ||
            pending.gaps.inner !== this.gaps.inner || pending.gaps.outer !== this.gaps.outer ||
            !sameSpecs(pending.specs, this.layoutSpecs())) {
            this.learningPending = null; return;
        }
        if ([...plan.frames].some(([id, rect]) => this.records.get(id)?.state !== 'tiled' ||
            !sameRect(this.adapter.read(id)?.rect, rect, 1))) return;
        this.learningPending = null;
        const windows = this.learningWindows(), apps = {...this.learnedLayouts};
        const pinned = {...this.pinnedLayouts}, owners = this.pinGoals();
        for (const id of pending.affected) {
            const data = windows.get(id), pinKey = data && learningMatch(data, pinned);
            const preferred = normalizedFrame(plan.frames.get(id), this.adapter.area(), this.gaps);
            if (pinKey && preferred && owners.has(id)) {
                const monitor = pinned[pinKey].monitor;
                pinned[pinKey] = {...preferred, ...(monitor ? {monitor} : this.pinMonitor())};
            }
            if (!this.learnLayouts) continue;
            const key = uniqueLearningKey(id, windows);
            const frame = normalizedFrame(plan.frames.get(id), this.adapter.area(), this.gaps);
            if (!key || !frame || (!Object.hasOwn(apps, key) && Object.keys(apps).length >= 128)) continue;
            const oldKey = learningMatch(windows.get(id), apps);
            if (oldKey && oldKey !== key) delete apps[oldKey];
            apps[key] = frame;
        }
        if (JSON.stringify(pinned) !== JSON.stringify(this.pinnedLayouts)) {
            this.pinnedLayouts = pinned;
            this.onPinnedLayouts?.(pinned);
        }
        if (JSON.stringify(apps) !== JSON.stringify(this.learnedLayouts)) {
            this.learnedLayouts = apps;
            try { this.onLearnedLayouts?.(apps); }
            catch (error) { this.adapter.log('warn', `Cannot save learned layout: ${error}`); }
        }
    }

    learningGoals(tree, area, gaps) {
        if (!this.learnLayouts) return new Map();
        const windows = this.learningWindows(), goals = new Map();
        const full = this.adapter.area(), root = {x: full.x + this.gaps.outer, y: full.y + this.gaps.outer,
            width: full.width - 2 * this.gaps.outer, height: full.height - 2 * this.gaps.outer};
        const local = {x: area.x + gaps.outer, y: area.y + gaps.outer,
            width: area.width - 2 * gaps.outer, height: area.height - 2 * gaps.outer};
        for (const id of ids(tree)) {
            if (!uniqueLearningKey(id, windows)) continue;
            const data = windows.get(id);
            if (this.activePin(data)) continue;
            const profile = learningMatch(data, this.learnedLayouts);
            if (!profile) continue;
            const goal = this.learnedLayouts[profile];
            const width = Math.min(1, goal.width * root.width / local.width);
            const height = Math.min(1, goal.height * root.height / local.height);
            goals.set(id, {x: Math.max(0, Math.min(1 - width, (root.x + goal.x * root.width - local.x) / local.width)),
                y: Math.max(0, Math.min(1 - height, (root.y + goal.y * root.height - local.y) / local.height)), width, height});
        }
        return goals;
    }

    preferredBalance(tree, area, specs, gaps) {
        if (!tree) return tree;
        const next = balancedLayout(tree, area, specs, gaps), goals = this.learningGoals(next, area, gaps);
        if (!goals.size || ids(next).length < 2) return next;
        const learned = pinnedLayout(next, goals, area, specs, gaps,
            (part, region) => balancedLayout(part, region, specs, {inner: gaps.inner, outer: 0}));
        const ordinary = new Set(ids(next).filter(id => !goals.has(id) &&
            !this.activePin(this.adapter.read(id))));
        return comfortableLearning(next, learned, goals, area, specs, gaps, ordinary, withoutReservations(learned));
    }

    applyAppRule(target) {
        const identities = appIdentities(target);
        for (const r of this.records.values()) {
            const data = this.adapter.read(r.id);
            if (data && r.override === 'tiled' && matchesApp(data, identities))
                r.override = null;
        }
        this.schedule(0);
    }

    layoutSpecs() {
        const specs = new Map();
        for (const id of ids(this.tree)) {
            const data = this.adapter.read(id);
            const r = this.records.get(id);
            if (!r || r.state !== 'tiled' || exclusion(data) || !data.ready || data.maximized) continue;
            specs.set(id, constraints(data));
        }
        return specs;
    }

    beginSplitResize(r, edges) {
        if (this.resize?.id === r.id) return true;
        if (this.adapter.monitorCount() !== 1) return false;
        if (this.adapter.activeWorkspace) this.domain = this.adapter.activeWorkspace();
        const data = this.adapter.read(r.id);
        if (exclusion(data) || !data.ready || data.maximized) return false;
        const specs = this.layoutSpecs();
        const context = beginResize(this.tree, r.id, edges, data.rect, this.adapter.area(), specs, this.gaps);
        if (!context) return false;
        this.resize = {...context, domain: this.domain, rules: [...this.floatingApps]};
        r.grabbed = true;
        r.request = null;
        // Native drag owns the frame until grab-op-end. No resize polling.
        if (this.timer !== null) this.clock.cancel(this.timer);
        this.timer = null;
        this.due = Infinity;
        this.adapter.log('info', `Split resize started ${r.id}: ${edges.join(',')}`);
        return true;
    }

    validResize(context) {
        return this.resizeSplits && this.validLayoutContext(context);
    }

    validLayoutContext(context) {
        const data = this.adapter.read(context.id);
        return this.adapter.monitorCount() === 1 &&
            this.domain === context.domain && this.tree === context.tree &&
            (context.pins === undefined || context.pins === JSON.stringify(this.pinnedLayouts)) &&
            !exclusion(data) && data.ready && !data.maximized &&
            sameRect(this.adapter.area(), context.area) &&
            this.gaps.inner === context.gaps.inner && this.gaps.outer === context.gaps.outer &&
            this.floatingApps.length === context.rules.length &&
            this.floatingApps.every((value, i) => value === context.rules[i]) &&
            sameSpecs(this.layoutSpecs(), context.specs);
    }

    cancelSplitResize(reason) {
        const context = this.resize;
        this.resize = null;
        const r = context && this.records.get(context.id);
        if (r) {
            this.float(r, reason, false);
            r.override = 'floating';
        }
    }

    endSplitResize() {
        const context = this.resize;
        if (this.adapter.activeWorkspace) this.domain = this.adapter.activeWorkspace();
        if (!this.validResize(context)) {
            this.cancelSplitResize('resize-context-changed');
            return;
        }
        const result = finishResize(context, this.adapter.read(context.id).rect);
        if (!result) {
            this.cancelSplitResize('unsupported-resize');
            return;
        }
        this.resize = null;
        this.tree = result.tree;
        if (result.tree !== context.tree) this.queueLearning([...result.plan.frames.keys()].filter(id =>
            !sameRect(result.plan.frames.get(id), context.plan.frames.get(id), 1)));
        for (const id of ids(this.tree)) this.records.get(id).request = null;
        this.adapter.log('info', `Split resize applied ${context.id}`);
        this.schedule(0);
    }

    beginDrag(r) {
        if (this.drag?.id === r.id) return true;
        if (this.resize || this.adapter.monitorCount() !== 1) return false;
        if (this.adapter.activeWorkspace) this.domain = this.adapter.activeWorkspace();
        const data = this.adapter.read(r.id);
        if (exclusion(data) || !data.ready || data.maximized) return false;
        const frames = new Map(ids(this.tree).map(id => [id, this.adapter.read(id)?.rect]));
        let context = beginDrag(this.tree, r.id, frames, this.adapter.area(), this.layoutSpecs(), this.gaps);
        if (!context && this.layoutAssistant && ids(this.tree).length === 1) {
            const area = this.adapter.area(), specs = this.layoutSpecs(), plan = solve(this.tree, area, specs, this.gaps);
            if (plan && sameRect(data.rect, plan.frames.get(r.id), 1))
                context = {tree: this.tree, id: r.id, frame: {...data.rect}, area: {...area}, gaps: {...this.gaps}, specs, plan};
        }
        if (!context) return false;
        this.drag = {...context, domain: this.domain, rules: [...this.floatingApps],
            pins: JSON.stringify(this.pinnedLayouts), presetPlans: new Map(),
            assistantOnly: !this.dragSwap || ids(this.tree).length < 2};
        r.grabbed = true;
        r.request = null;
        if (this.timer !== null) this.clock.cancel(this.timer);
        this.timer = null;
        this.due = Infinity;
        this.adapter.log('info', `Tile drag started ${r.id}`);
        return true;
    }

    cancelDrag(reason) {
        const context = this.drag;
        this.drag = null;
        const r = context && this.records.get(context.id);
        if (r) {
            this.float(r, reason, false);
            r.override = 'floating';
        }
    }

    presetFits(region) {
        const context = this.drag;
        if (!context || !this.layoutAssistant) return false;
        const data = this.adapter.read(context.id), spec = context.specs.get(context.id);
        const key = data && learningIdentity(data);
        if (!key || !spec || (!learningMatch(data, this.pinnedLayouts) && Object.keys(this.pinnedLayouts).length >= 128)) return false;
        const rect = presetFrame(region, context.area, context.gaps);
        if (rect.width < spec.minWidth || rect.height < spec.minHeight || rect.width > spec.maxWidth || rect.height > spec.maxHeight) return false;
        const goal = normalizedFrame(rect, context.area, context.gaps);
        if (!goal) return false;
        const profile = learningMatch(data, this.pinnedLayouts);
        for (const [id, pinned] of this.pinGoals()) {
            if (id === context.id || learningMatch(this.adapter.read(id), this.pinnedLayouts) === profile) continue;
            if (goal.x < pinned.x + pinned.width - 1e-6 && pinned.x < goal.x + goal.width - 1e-6 &&
                goal.y < pinned.y + pinned.height - 1e-6 && pinned.y < goal.y + goal.height - 1e-6) return false;
        }
        return true;
    }

    presetPlan(region) {
        const context = this.drag;
        if (!this.running || this.suspended || !context ||
            (this.adapter.activeWorkspace && this.adapter.activeWorkspace() !== context.domain) ||
            !this.validLayoutContext(context) || !this.presetFits(region)) return null;
        const cacheKey = JSON.stringify(region);
        if (context.presetPlans.has(cacheKey)) return context.presetPlans.get(cacheKey);
        const rect = presetFrame(region, context.area, context.gaps), goal = normalizedFrame(rect, context.area, context.gaps);
        const profile = learningMatch(this.adapter.read(context.id), this.pinnedLayouts);
        const goals = new Map([...this.pinGoals()].filter(([id]) => id !== context.id &&
            learningMatch(this.adapter.read(id), this.pinnedLayouts) !== profile));
        goals.set(context.id, goal);
        const next = pinnedLayout(withoutReservations(this.tree), goals, context.area, context.specs, context.gaps,
            (part, area) => this.preferredBalance(part, area, context.specs, {inner: context.gaps.inner, outer: 0}));
        const plan = solve(next, context.area, context.specs, context.gaps);
        const result = plan && sameRect(plan.frames.get(context.id), rect, 1) ? {tree: next, goal} : null;
        context.presetPlans.set(cacheKey, result);
        return result;
    }

    finishPreset(context, region) {
        const result = this.assistantReady ? this.presetPlan(region) : null;
        this.drag = null;
        this.learningPending = null;
        if (!result) {
            this.tree = context.tree;
            this.adapter.notice(N_("This layout region is unavailable for this window."));
        } else {
            const data = this.adapter.read(context.id), key = learningIdentity(data);
            const profile = learningMatch(data, this.pinnedLayouts), apps = {...this.pinnedLayouts};
            if (profile) delete apps[profile];
            apps[key] = {...result.goal, ...this.pinMonitor()};
            this.pinnedLayouts = apps;
            if (!this.pinOwners.has(this.domain)) this.pinOwners.set(this.domain, new Map());
            this.pinOwners.get(this.domain).set(key, context.id);
            this.tree = result.tree;
            this.pinCache.clear();
            this.balancePending.delete(this.domain);
            this.onPinnedLayouts?.(apps);
            this.adapter.notice(N_("Application pinned. Preferred position and size saved."));
        }
        for (const id of ids(this.tree)) this.records.get(id).request = null;
        this.schedule(0);
    }

    previewDrag(point) {
        const context = this.drag;
        if (!this.running || this.suspended || !context || !this.dragSwap) return null;
        if (this.adapter.activeWorkspace && this.adapter.activeWorkspace() !== context.domain) return null;
        if (!this.validLayoutContext(context)) return null;
        const result = finishDrag(context, this.adapter.read(context.id)?.rect, point);
        return result && result.target !== context.id ? result.target : null;
    }

    restoreDrag(context) {
        this.drag = null;
        this.tree = context.tree;
        for (const id of ids(this.tree)) this.records.get(id).request = null;
        this.schedule(0);
    }

    endDrag() {
        const context = this.drag;
        if (this.adapter.activeWorkspace) this.domain = this.adapter.activeWorkspace();
        if ((!this.dragSwap && !this.layoutAssistant) || !this.validLayoutContext(context)) {
            this.cancelDrag('drag-context-changed');
            return;
        }
        // Sample again at release: the visual preview is advisory and may be stale.
        let point = null;
        try { point = this.adapter.pointer?.(); }
        catch (error) { this.adapter.log('warn', `Drop pointer unavailable: ${error}`); }
        const region = this.layoutAssistant && this.assistantVisible && dragMoved(context, this.adapter.read(context.id)?.rect) &&
            layoutHit(point, layoutBarGeometry(context.area));
        if (region) { this.finishPreset(context, region.region); return; }
        if (this.layoutAssistant && this.assistantVisible && insideBar(point, layoutBarGeometry(context.area))) {
            this.restoreDrag(context);
            return;
        }
        if (context.assistantOnly) { this.restoreDrag(context); return; }
        const result = finishDrag(context, this.adapter.read(context.id).rect, point);
        if (!result) {
            if (this.layoutAssistant) this.restoreDrag(context);
            else this.cancelDrag('drag-no-compatible-target');
            return;
        }
        this.drag = null;
        this.tree = result.tree;
        if (result.target !== context.id) this.queueLearning([context.id, result.target]);
        for (const id of ids(this.tree)) this.records.get(id).request = null;
        this.adapter.log('info', `Tile drop ${context.id} -> ${result.target}`);
        this.schedule(0);
    }

    reconcile() {
        if (!this.running || this.suspended) return;
        if (this.adapter.monitorCount() !== 1) {
            this.suspend(N_("Auto-tiling paused: exactly one monitor is required"));
            return;
        }
        if (this.adapter.activeWorkspace) {
            this.domain = this.adapter.activeWorkspace();
            this.lastFocus = this.focusByDomain.get(this.domain) ?? null;
        }
        const focusedId = this.adapter.focusedId?.();
        const focused = this.records.get(focusedId);
        if (focused?.state === 'tiled' && focused.domain === this.domain) {
            this.lastFocus = focusedId;
            this.focusByDomain.set(this.domain, focusedId);
        }
        if (!this.adapter.targetExists()) {
            this.suspend(N_("Auto-tiling paused: target workspace was removed"));
            return;
        }
        if (this.resize) {
            if (this.validResize(this.resize)) return;
            this.cancelSplitResize('resize-context-changed');
        }

        if (this.drag) {
            if (this.dragSwap && this.validLayoutContext(this.drag)) return;
            this.cancelDrag('drag-context-changed');
        }

        const live = new Set(this.adapter.list());
        for (const id of this.records.keys()) {
            if (!live.has(id)) {
                this.removeWindow(id);
                this.records.delete(id);
            }
        }
        const now = this.clock.now();
        for (const id of live) {
            if (!this.records.has(id)) this.records.set(id, {
                id, state: 'pending', born: now, snapshot: null,
                touched: false, request: null,
            });
        }
        const data = new Map([...this.records.keys()].map(id => [id, this.adapter.read(id)]));
        const paused = !this.adapter.targetActive() || [...data.values()]
            .some(d => d?.inScope && d.fullscreen);

        // Release windows that leave our scope, even while another workspace is active.
        for (const r of this.records.values()) {
            const d = data.get(r.id);
            const reason = exclusion(d);
            const maximizedEligible = d?.maximized && !exclusion({...d, resizable: true});
            if (!d?.alive) {
                this.removeWindow(r.id);
                this.records.delete(r.id);
                continue;
            }
            if (this.debug) {
                const identity = appIdentities(d).join(', ') || '(sem identificador)';
                if (r.identityLogged !== identity) {
                    this.adapter.log('info', `Window ${r.id} identities: ${identity}`);
                    r.identityLogged = identity;
                }
            }
            const domain = d.domain ?? this.domain;
            if (r.domain !== undefined && r.domain !== domain) {
                this.removeWindow(r.id);
                this.release(r, true);
                if (r.state !== 'floating') {
                    r.state = 'pending';
                    r.born = now;
                    this.schedule(150);
                }
            }
            r.domain = domain;
            // Merely switching workspace does not release that workspace's tiles.
            // Only transfers, closure, or explicit state changes alter their ownership.
            if (reason === 'outside-target' && d.domain !== undefined && d.monitor === 0) {
                continue;
            }
            // Readiness timeout only ends polling. A later native event can
            // admit the window through the normal rules/constraints again.
            if (r.state === 'floating' && r.reason === 'not-ready' &&
                r.override !== 'floating' && d.ready && (!reason || maximizedEligible)) {
                this.release(r, true);
                r.state = 'pending';
                r.reason = null;
                r.born = now;
            }
            // Only maximization of a managed tile creates this temporary exit.
            // Do not restore its old snapshot: keep the newly restored geometry
            // as the starting point for the next management interval.
            if (r.state === 'floating' && r.reason === 'user-maximized' &&
                !d.maximized && d.ready && !reason && r.override !== 'floating' &&
                !matchesApp(d, this.floatingApps)) {
                this.release(r, false);
                r.state = 'pending';
                r.reason = null;
                r.born = now;
            }
            // Features may still be unset at window-created. Do not permanently
            // classify a new normal window as fixed-size before it is mapped.
            if (r.state === 'pending' && d.inScope && d.normal &&
                (!d.ready || now - r.born < 150)) {
                if (now - r.born >= READY_MS) this.float(r, 'not-ready');
                else this.schedule(100);
                continue;
            }
            // Mutter reports fully maximized windows as non-resizable. Test
            // eligibility without that temporary restriction before classifying
            // an opening window as fixed-size; verify its real hints afterward.
            if (r.state === 'tiled' && maximizedEligible) {
                this.float(r, 'user-maximized', false);
                continue;
            }
            if (r.state === 'preparing' && (!d.ready || d.maximized || now < r.prepareUntil)) {
                if (now - r.born >= READY_MS)
                    this.float(r, d.ready ? 'prepare-timeout' : 'not-ready');
                else this.schedule(100);
                continue;
            }
            if (r.state === 'pending' && maximizedEligible && r.override !== 'floating' &&
                (r.override === 'tiled' || !matchesApp(d, this.floatingApps))) {
                if (paused) continue;
                this.capture(r);
                r.touched = true;
                r.state = 'preparing';
                r.prepareUntil = now + SETTLE_MS;
                r.born = now;
                this.adapter.unmaximize(r.id);
                this.schedule(100);
                continue;
            }
            if (r.state === 'tiled' && d.fullscreen) continue;
            if (reason && r.state !== 'floating') {
                this.removeWindow(r.id);
                this.release(r, reason === 'outside-target');
                r.state = 'excluded';
                r.reason = reason;
                // Fixed-size normal windows stay outside the grid.
                if (reason === 'fixed-size') this.float(r, reason, false);
            } else if (!reason && r.state === 'excluded') {
                r.state = 'pending';
                r.born = now;
                this.schedule(150);
            }
            if (reason === 'outside-target' && r.state === 'floating' && r.touched)
                this.release(r, true);
        }
        if (this.adapter.workspaces) {
            const remaining = new Set(this.adapter.workspaces());
            for (const domain of this.trees.keys()) {
                if (!remaining.has(domain)) this.trees.delete(domain);
            }
            for (const domain of this.balancePending) if (!remaining.has(domain)) this.balancePending.delete(domain);
            for (const domain of this.pinCache.keys()) if (!remaining.has(domain)) this.pinCache.delete(domain);
            for (const domain of this.pinOwners.keys()) if (!remaining.has(domain)) this.pinOwners.delete(domain);
            for (const domain of this.focusByDomain.keys()) {
                if (!remaining.has(domain)) this.focusByDomain.delete(domain);
            }
        }
        if (paused) return;

        const area = this.adapter.area();
        const specs = new Map();
        for (const r of this.records.values()) {
            const d = data.get(r.id);
            if (!exclusion(d)) specs.set(r.id, constraints(d));
        }
        if (this.tree && !solve(this.tree, area, specs, this.gaps))
            this.tree = withoutReservations(this.tree);
        // A resolution/hint change can invalidate an existing tree. Newest leaves yield first.
        while (this.tree && !solve(this.tree, area, specs, this.gaps)) {
            const newest = ids(this.tree).at(-1);
            this.float(this.records.get(newest), 'incompatible-constraints');
        }

        for (const r of this.records.values()) {
            const d = data.get(r.id);
            if (exclusion(d)) continue;
            if (r.override === 'floating') {
                if (r.state !== 'floating') this.float(r, 'user-toggle');
                continue;
            }
            const byApp = r.override !== 'tiled' && matchesApp(d, this.floatingApps);
            if (byApp && (r.state !== 'floating' || r.reason === 'app-exception')) {
                if (r.reason !== 'app-exception' || r.state !== 'floating')
                    this.float(r, 'app-exception');
                continue;
            }
            if (!byApp && r.state === 'floating' && r.reason === 'app-exception') {
                this.release(r, true);
                r.state = 'pending';
                r.born = now;
                this.schedule(150);
            }
            if (!['pending', 'preparing'].includes(r.state) || exclusion(d)) continue;
            if (r.state === 'pending' && now - r.born < 150) continue;
            if (!d.ready || (r.state === 'preparing' &&
                (d.maximized || now < r.prepareUntil))) {
                // A refused unmaximize must not restart forever merely because
                // the native window is mapped and otherwise ready.
                if (now - r.born >= READY_MS) this.float(r, d.ready ? 'prepare-timeout' : 'not-ready');
                else this.schedule(100);
                continue;
            }
            const spec = specs.get(r.id);
            if (spec.maxWidth < spec.minWidth || spec.maxHeight < spec.minHeight) {
                this.float(r, 'incompatible-constraints');
                continue;
            }
            if (ids(this.tree).length >= MAX_TILES) {
                this.float(r, 'capacity');
                continue;
            }
            let next = insertBalanced(withoutReservations(this.tree), r.id, specs, area, this.gaps, this.lastFocus, this.insertionSide, this.preserveFocusedWindow);
            if (!next) {
                this.float(r, 'insufficient-space');
                continue;
            }
            this.balancePending.add(this.domain);
            this.capture(r);
            if (r.state === 'preparing') r.snapshot.rect = {...d.rect};
            this.learningPending = null;
            this.tree = next;
            r.state = 'tiled';
            r.reason = null;
            this.adapter.log('info', `Tiled ${r.id}`);
        }

        this.fitPins(area, specs);
        const plan = solve(this.tree, area, specs, this.gaps);
        if (!plan) return;
        let removed = false;
        for (const [id, rect] of plan.frames) {
            const r = this.records.get(id);
            const d = data.get(id);
            if (!sameRect(r.request?.rect, rect)) {
                r.request = {rect, corrections: 0, deadline: now + SETTLE_MS};
                if (!sameRect(d.rect, rect, 1)) this.move(r, rect);
            } else if (!sameRect(d.rect, rect, 1) && now >= r.request.deadline) {
                if (r.request.corrections >= MAX_CORRECTIONS) {
                    this.float(r, 'resize-not-converged');
                    removed = true;
                    continue;
                }
                r.request.corrections++;
                r.request.deadline = now + SETTLE_MS;
                this.move(r, rect);
            }
            // Verify even after the initial request: Wayland completion is asynchronous.
            if (r.state !== 'tiled') continue;
            if (!sameRect(this.adapter.read(id)?.rect, rect, 1))
                this.schedule(Math.max(1, r.request.deadline - now));
        }
        if (removed) this.schedule(0);
        else this.commitLearning(plan);
    }

    move(r, rect) {
        r.touched = true;
        try {
            this.adapter.move(r.id, rect);
        } catch (e) {
            this.adapter.log('warn', `Move ${r.id}: ${e}`);
            this.float(r, 'resize-error');
            this.schedule(0);
        }
    }
}
