// SPDX-License-Identifier: GPL-3.0-or-later
import {ids, solve} from './tree.js';

// Equal window counts on each branch yield equal areas even in an asymmetric
// BSP. Native minimum and maximum sizes remain the solver's responsibility.
export function balancedLayout(tree, area = null, specs = null, gaps = null, preferLandscape = false) {
    function visit(node) {
        if (!node || node.empty) return {tree: node, count: 0};
        if ('id' in node) return {tree: node, count: 1};
        const a = visit(node.a), b = visit(node.b), count = a.count + b.count;
        return {tree: {...node, ratio: count ? a.count / count : 0.5, a: a.tree, b: b.tree}, count};
    }
    let best = visit(tree).tree;
    if (!area || !specs || !best) return best;
    const candidates = [best];
    if (preferLandscape) {
        // Rebuild grouping as well as orientation: an insertion chain may not
        // admit balanced, wide cells through split rotations alone.
        const rebuild = keys => keys.length === 1 ? {id: keys[0]} : {
            axis: 'x', ratio: Math.floor(keys.length / 2) / keys.length,
            a: rebuild(keys.slice(0, Math.floor(keys.length / 2))),
            b: rebuild(keys.slice(Math.floor(keys.length / 2))),
        };
        const keys = ids(tree);
        if (keys.length > 1) candidates.push(rebuild(keys));
    }
    let bestScore = Infinity;
    for (let candidate of candidates) {
        const initial = solve(candidate, area, specs, gaps);
        if (!initial) continue;
        let score = quality(initial, preferLandscape);
        for (let pass = 0; pass < 3; pass++) {
            let chosen = null;
            for (const variant of alternatives(candidate)) {
                const plan = solve(variant, area, specs, gaps);
                if (!plan) continue;
                const value = quality(plan, preferLandscape);
                if (value < score - 1e-8) { chosen = variant; score = value; }
            }
            if (!chosen) break;
            candidate = chosen;
        }
        if (score < bestScore - 1e-8) { best = candidate; bestScore = score; }
    }
    return best;
}

function alternatives(node) {
    if (!node || node.empty || 'id' in node) return [];
    return [{...node, axis: node.axis === 'x' ? 'y' : 'x'},
        ...alternatives(node.a).map(a => ({...node, a})),
        ...alternatives(node.b).map(b => ({...node, b}))];
}

function replace(tree, id, next) {
    if ('id' in tree) return tree.id === id ? next : tree;
    return {...tree, a: replace(tree.a, id, next), b: replace(tree.b, id, next)};
}
function quality(plan, preferLandscape = false) {
    const frames = [...plan.frames.values()], areas = frames.map(r => r.width * r.height);
    const mean = areas.reduce((a, b) => a + b, 0) / areas.length;
    const imbalance = areas.reduce((sum, value) => sum + ((value - mean) / mean) ** 2, 0) / areas.length;
    const shape = frames.reduce((sum, r) => sum + Math.log(r.width / r.height / 1.6) ** 2, 0) / frames.length;
    const landscape = preferLandscape ? frames.reduce((sum, r) =>
        sum + Math.max(0, r.height / r.width - 1) ** 2, 0) / frames.length : 0;
    return imbalance + shape * 0.02 + portraitPenalty(plan) + landscape;
}
export function insertBalanced(tree, id, specs, area, gaps, focus = null, side = 'right', preferOthers = true) {
    if (!['left', 'right'].includes(side)) return null;
    if (ids(tree).includes(id)) throw new Error('Cannot insert a duplicate window');
    if (!tree) return solve({id}, area, specs, gaps) ? {id} : null;
    const order = ids(tree).sort((a, b) => preferOthers
        ? Number(a === focus) - Number(b === focus) : Number(b === focus) - Number(a === focus));
    let best = null, score = Infinity;
    for (const target of order) {
        for (const axis of ['x', 'y']) {
            const next = balancedLayout(replace(tree, target, {axis,
                a: {id: side === 'left' ? id : target}, b: {id: side === 'left' ? target : id}}));
            const plan = solve(next, area, specs, gaps);
            if (!plan) continue;
            const value = quality(plan);
            if (value < score - 1e-8) { best = next; score = value; }
        }
        if (!preferOthers && target === focus && best) return best;
    }
    return best;
}

// Learned geometry is a preference, not permission to squeeze other apps into
// tall strips. Keep it unchanged when the remaining windows have usable shapes.
export function portraitPenalty(plan, selected = null) {
    const frames = [...plan.frames].filter(([id]) => !selected || selected.has(id)).map(([, rect]) => rect);
    return frames.length ? frames.reduce((sum, r) => sum + Math.max(0, r.height / r.width - 1.25) ** 2, 0) / frames.length : 0;
}
export function comfortableLearning(balanced, learned, goals, area, specs, gaps, ordinary, stripped = learned) {
    const original = solve(learned, area, specs, gaps);
    if (!original) return balanced;
    const selected = ordinary.size ? ordinary : new Set(goals.keys());
    if (portraitPenalty(original, selected) < 1e-8) return learned;
    const root = {x: area.x + gaps.outer, y: area.y + gaps.outer,
        width: area.width - 2 * gaps.outer, height: area.height - 2 * gaps.outer};
    function score(plan) {
        let error = 0;
        for (const [id, goal] of goals) {
            const r = plan.frames.get(id);
            const actual = {x: (r.x - root.x) / root.width, y: (r.y - root.y) / root.height,
                width: r.width / root.width, height: r.height / root.height};
            for (const key of ['x', 'y', 'width', 'height']) error += (actual[key] - goal[key]) ** 2;
        }
        const free = [...plan.frames].filter(([id]) => selected.has(id)).map(([, r]) => r.width * r.height);
        const mean = free.reduce((sum, value) => sum + value, 0) / Math.max(1, free.length);
        const spread = free.reduce((sum, value) => sum + ((value - mean) / mean) ** 2, 0) / Math.max(1, free.length);
        const comfort = [...plan.frames].filter(([id]) => selected.has(id)).reduce((sum, [, r]) =>
            sum + Math.max(0, r.height / r.width - 1) ** 2 + Math.max(0, Math.log(r.width / r.height / 3)) ** 2, 0) /
            Math.max(1, selected.size);
        return error / Math.max(1, goals.size) * 2 + spread + comfort * 0.35 + quality(plan) * 0.02;
    }
    function relax(node, amount) {
        if ('id' in node) return node;
        const a = ids(node.a).length, b = ids(node.b).length;
        return {...node, ratio: node.ratio * (1 - amount) + a / (a + b) * amount,
            a: relax(node.a, amount), b: relax(node.b, amount)};
    }
    let best = learned, narrow = portraitPenalty(original, selected), value = score(original);
    // Bound topology search; preserve IDs/order, and relax only runtime ratios.
    for (const source of [balanced, stripped]) {
        for (const variant of [source, ...alternatives(source)]) for (const amount of [0, 0.5, 1]) {
            const candidate = relax(variant, amount), plan = solve(candidate, area, specs, gaps);
            if (!plan) continue;
            const penalty = portraitPenalty(plan, selected), next = score(plan);
            if (penalty < narrow - 1e-8 || (Math.abs(penalty - narrow) <= 1e-8 && next < value - 1e-8)) {
                best = candidate; narrow = penalty; value = next;
            }
        }
    }
    return best;
}
