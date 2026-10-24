// SPDX-License-Identifier: GPL-3.0-or-later
import {appIdentities} from './rules.js';
import {ids, solve} from './layout/tree.js';

const fields = ['x', 'y', 'width', 'height'];
export function readLearning(text) {
    const result = Object.create(null);
    try {
        if (typeof text !== 'string' || text.length > 65536) return result;
        const data = JSON.parse(text);
        if (data?.version !== 1 || !data.apps || Array.isArray(data.apps)) return result;
        for (const [key, rect] of Object.entries(data.apps).slice(0, 128)) {
            if (!/^(app-id|sandbox-id|gtk-app-id|wm-class):.+/.test(key) || key.length > 512 ||
                !rect || !fields.every(k => Number.isFinite(rect[k]) && rect[k] >= 0 && rect[k] <= 1) ||
                rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > 1.00001 || rect.y + rect.height > 1.00001) continue;
            result[key] = Object.fromEntries(fields.map(k => [k, rect[k]]));
        }
    } catch (_) { /* Invalid or future data never prevents tiling. */ }
    return result;
}
export function writeLearning(apps) { return JSON.stringify({version: 1, apps}); }
export function learningIdentity(data) {
    const identities = appIdentities({...data, applicationIdentities: []});
    return ['app-id:', 'sandbox-id:', 'gtk-app-id:', 'wm-class:']
        .map(prefix => identities.find(key => key.startsWith(prefix))).find(Boolean) ?? null;
}
export function learningMatch(data, apps) {
    return appIdentities({...data, applicationIdentities: []}).find(key => Object.hasOwn(apps, key)) ?? null;
}
function rootRect(area, gaps) {
    return {x: Math.round(area.x + gaps.outer), y: Math.round(area.y + gaps.outer),
        width: Math.floor(area.width - 2 * gaps.outer), height: Math.floor(area.height - 2 * gaps.outer)};
}
export function normalizedFrame(frame, area, gaps) {
    const root = rootRect(area, gaps);
    if (!frame || root.width <= 0 || root.height <= 0) return null;
    const rect = {x: (frame.x - root.x) / root.width, y: (frame.y - root.y) / root.height,
        width: frame.width / root.width, height: frame.height / root.height};
    if (!fields.every(k => Number.isFinite(rect[k]) && rect[k] >= -0.00001 && rect[k] <= 1.00001)) return null;
    return Object.fromEntries(fields.map(k => [k, Math.max(0, Math.min(1, rect[k]))]));
}

// A window must be the sole tiled instance of its application, across workspaces.
export function uniqueLearningKey(id, windows) {
    const data = windows.get(id), key = data && learningIdentity(data);
    if (!key) return null;
    const stable = d => appIdentities({...d, applicationIdentities: []}).filter(value => !value.startsWith('wm-instance:'));
    const identities = stable(data);
    return [...windows].some(([other, d]) => {
        if (other === id) return false;
        const otherKey = learningIdentity(d);
        if (key.startsWith('app-id:') && otherKey?.startsWith('app-id:')) return key === otherKey;
        return stable(d).some(value => identities.includes(value));
    }) ? null : key;
}

function exchange(node, first, second) {
    if ('id' in node) return {id: node.id === first ? second : node.id === second ? first : node.id};
    return {...node, a: exchange(node.a, first, second), b: exchange(node.b, first, second)};
}
function error(plan, goals, root) {
    let total = 0;
    for (const [id, goal] of goals) {
        const frame = plan.frames.get(id);
        if (!frame) continue;
        const actual = {x: (frame.x - root.x) / root.width, y: (frame.y - root.y) / root.height,
            width: frame.width / root.width, height: frame.height / root.height};
        total += fields.reduce((sum, key) => sum + (actual[key] - goal[key]) ** 2, 0);
    }
    return total;
}

// Fit existing BSP branches to remembered regions. Minima come from the solver;
// maxima remain enforced by its final pass. No pixel positions are persisted.
function fit(tree, initial, goals, root, gaps) {
    const regions = new Map();
    function measure(node) {
        if ('id' in node) {
            const goal = goals.get(node.id);
            const rect = goal && {x: root.x + goal.x * root.width, y: root.y + goal.y * root.height,
                width: goal.width * root.width, height: goal.height * root.height};
            regions.set(node, rect); return rect;
        }
        const a = measure(node.a), b = measure(node.b);
        let region = a || b;
        if (a && b) {
            const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
            region = {x, y, width: Math.max(a.x + a.width, b.x + b.width) - x,
                height: Math.max(a.y + a.height, b.y + b.height) - y};
        }
        regions.set(node, region); return region;
    }
    function place(node, rect) {
        if ('id' in node) return node;
        const dim = node.axis === 'x' ? 'width' : 'height', axis = node.axis;
        const available = rect[dim] - gaps.inner;
        const a = regions.get(node.a), b = regions.get(node.b);
        const requests = [];
        if (a) requests.push(a[axis] + a[dim] - rect[axis]);
        if (b) requests.push(b[axis] - rect[axis] - gaps.inner);
        const wanted = requests.length ? requests.reduce((sum, value) => sum + value, 0) / requests.length :
            initial.bounds.get(node.a)[dim] / (initial.bounds.get(node)[dim] - gaps.inner) * available;
        const size = Math.max(initial.minima.get(node.a)[dim], Math.min(available - initial.minima.get(node.b)[dim], Math.round(wanted)));
        return {...node, ratio: size / available,
            a: place(node.a, {...rect, [dim]: size}),
            b: place(node.b, {...rect, [axis]: rect[axis] + size + gaps.inner, [dim]: available - size})};
    }
    measure(tree); return place(tree, root);
}

export function applyLearning(tree, newId, goals, area, specs, gaps, protectedFocus = null) {
    if (!goals.size || ids(tree).length < 2) return tree;
    const root = rootRect(area, gaps), base = solve(tree, area, specs, gaps);
    if (!base) return tree;
    const allowed = plan => !protectedFocus ||
        (plan.frames.get(protectedFocus.id)?.width >= protectedFocus.width &&
         plan.frames.get(protectedFocus.id)?.height >= protectedFocus.height);
    let best = tree, score = error(base, goals, root);
    const candidates = [{tree, plan: base}];
    for (const id of ids(tree)) {
        if (id === newId) continue;
        const next = exchange(tree, newId, id), plan = solve(next, area, specs, gaps);
        if (plan) candidates.push({tree: next, plan});
    }
    // Bound the amount of work per insertion, including large layouts.
    candidates.sort((a, b) => error(a.plan, goals, root) - error(b.plan, goals, root));
    for (const candidate of [{tree, plan: base}, ...candidates.filter(item => item.tree !== tree).slice(0, 7)]) {
        for (const next of [candidate.tree, fit(candidate.tree, candidate.plan, goals, root, gaps)]) {
            const plan = solve(next, area, specs, gaps);
            if (!plan || !allowed(plan)) continue;
            const value = error(plan, goals, root);
            if (value < score - 1e-8) { best = next; score = value; }
        }
    }
    return best;
}
