// SPDX-License-Identifier: GPL-3.0-or-later
import {ids, insert, remove, solve, sameRect} from './layout/tree.js';
import {fitLayoutGoals} from './learning.js';

// Reserved empty regions are layout space, never native windows or swap targets.
export function withoutReservations(tree) {
    if (!tree || tree.empty) return null;
    if ('id' in tree) return tree;
    const a = withoutReservations(tree.a), b = withoutReservations(tree.b);
    if (!a) return b;
    if (!b) return a;
    return a === tree.a && b === tree.b ? tree : {...tree, a, b};
}

function subset(tree, wanted) {
    for (const id of ids(tree)) if (!wanted.includes(id)) tree = remove(tree, id);
    return tree;
}
function inside(rect, area) {
    return rect.x >= area.x && rect.y >= area.y &&
        rect.x + rect.width <= area.x + area.width && rect.y + rect.height <= area.y + area.height;
}
function split(axis, size, total, gap, a, b) {
    return {axis, ratio: size / (total - gap), a: a ?? {empty: true}, b: b ?? {empty: true}};
}
function rectFor(goal, root, spec) {
    const width = Math.max(spec.minWidth, Math.min(spec.maxWidth, Math.round(goal.width * root.width)));
    const height = Math.max(spec.minHeight, Math.min(spec.maxHeight, Math.round(goal.height * root.height)));
    return {x: Math.round(root.x + goal.x * root.width), y: Math.round(root.y + goal.y * root.height), width, height};
}

// Reserve an arbitrary rectangle using four non-overlapping bands. Try both cut
// orientations so narrow, tall applications do not lose usable side regions.
function reserve(tree, goals, desired, area, specs, gap, budget, remainder, depth = 0) {
    if (!goals.size) {
        const next = remainder ? remainder(tree, area) : tree;
        return solve(next, area, specs, {inner: gap, outer: 0}) ? next : null;
    }
    if (depth > 16 || --budget.remaining < 0) return null;
    const [id] = goals.keys(), rect = desired.get(id);
    if (!inside(rect, area)) return null;
    const others = ids(tree).filter(key => key !== id);
    if (!others.length && sameRect(rect, area)) return {id};
    for (const axis of ['x', 'y']) {
        const dim = axis === 'x' ? 'width' : 'height', cross = axis === 'x' ? 'y' : 'x';
        const span = axis === 'x' ? 'height' : 'width';
        const leading = rect[axis] - area[axis], trailing = area[dim] - leading - rect[dim];
        const before = rect[cross] - area[cross], after = area[span] - before - rect[span];
        if ([leading, trailing, before, after].some(n => n > 0 && n <= gap)) continue;
        const bands = [];
        if (leading) bands.push({name: 'leading', area: {...area, [dim]: leading - gap}});
        if (trailing) bands.push({name: 'trailing', area: {...area, [axis]: rect[axis] + rect[dim] + gap, [dim]: trailing - gap}});
        if (before) bands.push({name: 'before', area: {...area, [axis]: rect[axis], [dim]: rect[dim], [span]: before - gap}});
        if (after) bands.push({name: 'after', area: {...area, [axis]: rect[axis], [dim]: rect[dim],
            [cross]: rect[cross] + rect[span] + gap, [span]: after - gap}});
        if (others.length && !bands.length) continue;
        const ordered = [...others].sort((a, b) => Number(goals.has(b)) - Number(goals.has(a)) ||
            specs.get(b).minWidth * specs.get(b).minHeight - specs.get(a).minWidth * specs.get(a).minHeight);
        // A single band keeps the remainder's existing BSP intact. Greedy
        // distribution then makes the other three bands available when needed.
        for (let attempt = 0; attempt < bands.length + 1; attempt++) {
            const bins = bands.map(band => ({...band, tree: null, ids: []}));
            let failed = false;
            for (const key of ordered) {
                const candidates = bins.map((bin, index) => ({bin, index})).filter(({bin, index}) =>
                    (attempt === bands.length || index === attempt) &&
                    (!goals.has(key) || inside(desired.get(key), bin.area)))
                    .sort((a, b) => a.bin.ids.length - b.bin.ids.length ||
                        b.bin.area.width * b.bin.area.height - a.bin.area.width * a.bin.area.height);
                let placed = false;
                for (const {bin} of candidates) {
                    const selected = [...bin.ids, key];
                    let next = subset(tree, selected);
                    if (!solve(next, bin.area, specs, {inner: gap, outer: 0})) {
                        next = insert(bin.tree, key, specs, bin.area, {inner: gap, outer: 0});
                    }
                    if (!next) continue;
                    bin.tree = next; bin.ids = selected; placed = true; break;
                }
                if (!placed) { failed = true; break; }
            }
            if (failed) continue;
            const branches = new Map();
            for (const bin of bins) {
                const remaining = new Map([...goals].filter(([key]) => key !== id && bin.ids.includes(key)));
                const next = bin.tree && reserve(bin.tree, remaining, desired, bin.area, specs, gap, budget, remainder, depth + 1);
                if (bin.tree && !next) { failed = true; break; }
                branches.set(bin.name, next);
            }
            if (failed) continue;
            let next = {id};
            if (after) next = split(cross, rect[span], rect[span] + after, gap, next, branches.get('after'));
            if (before) next = split(cross, before - gap, area[span], gap, branches.get('before'), next);
            if (trailing) next = split(axis, rect[dim], rect[dim] + trailing, gap, next, branches.get('trailing'));
            if (leading) next = split(axis, leading - gap, area[dim], gap, branches.get('leading'), next);
            const plan = solve(next, area, specs, {inner: gap, outer: 0});
            if (plan && [...goals].every(([key]) => sameRect(plan.frames.get(key), desired.get(key), 1))) return next;
        }
    }
    return null;
}

export function pinnedLayout(tree, goals, area, specs, gaps, remainder = null) {
    if (!goals.size || !tree) return withoutReservations(tree);
    tree = withoutReservations(tree);
    const root = {x: Math.round(area.x + gaps.outer), y: Math.round(area.y + gaps.outer),
        width: Math.floor(area.width - 2 * gaps.outer), height: Math.floor(area.height - 2 * gaps.outer)};
    const desired = new Map([...goals].map(([id, goal]) => [id, rectFor(goal, root, specs.get(id))]));
    const exact = reserve(tree, goals, desired, root, specs, gaps.inner, {remaining: 192}, remainder);
    if (exact) return exact;
    // Space is insufficient: retain as much of every saved size as constraints
    // permit. Saved preferences are never overwritten by this temporary fit.
    let best = tree, retention = -1;
    const candidates = [tree];
    for (const [id] of [...goals].slice(0, 8)) {
        const rest = remove(tree, id);
        if (!rest) continue;
        for (const axis of ['x', 'y']) for (const first of [true, false])
            candidates.push({axis, ratio: 0.5, a: first ? {id} : rest, b: first ? rest : {id}});
    }
    for (const candidate of candidates) {
        let lo = 0, hi = 1, fitting = null;
        for (let step = 0; step < 14; step++) {
            const mid = step === 0 ? 1 : (lo + hi) / 2, protectedSpecs = new Map(specs);
            for (const [id, target] of desired) {
                const spec = specs.get(id);
                protectedSpecs.set(id, {...spec,
                    minWidth: Math.ceil(spec.minWidth + Math.max(0, target.width - spec.minWidth) * mid),
                    minHeight: Math.ceil(spec.minHeight + Math.max(0, target.height - spec.minHeight) * mid)});
            }
            const plan = solve(candidate, area, protectedSpecs, gaps);
            if (plan) {
                lo = mid;
                fitting = fitLayoutGoals(candidate, plan, goals, root, gaps);
                if (mid === 1) break;
            } else hi = mid;
        }
        if (fitting && lo > retention && solve(fitting, area, specs, gaps)) { best = fitting; retention = lo; }
    }
    return best;
}
