// SPDX-License-Identifier: GPL-3.0-or-later
// Pure layout code: no GJS, compositor or filesystem dependencies.
export function ids(tree) {
    if (!tree)
        return [];
    return 'id' in tree ? [tree.id] : [...ids(tree.a), ...ids(tree.b)];
}

export function remove(tree, id) {
    if (!tree || 'id' in tree)
        return tree?.id === id ? null : tree;
    const a = remove(tree.a, id);
    const b = remove(tree.b, id);
    if (a === tree.a && b === tree.b) return tree;
    return !a ? b : !b ? a : {...tree, a, b};
}

function replace(tree, id, next) {
    if ('id' in tree)
        return tree.id === id ? next : tree;
    return {...tree, a: replace(tree.a, id, next), b: replace(tree.b, id, next)};
}

export function sameRect(a, b, tolerance = 0) {
    return Boolean(a && b && ['x', 'y', 'width', 'height']
        .every(k => Math.abs(a[k] - b[k]) <= tolerance));
}

function validRect(r) {
    return r && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k])) &&
        r.width > 0 && r.height > 0;
}

export function solve(tree, area, specs, {inner = 8, outer = 8} = {}) {
    if (!validRect(area) || !Number.isFinite(inner) || !Number.isFinite(outer) ||
        inner < 0 || outer < 0)
        return null;
    const root = {
        x: Math.round(area.x + outer), y: Math.round(area.y + outer),
        width: Math.floor(area.width - outer * 2),
        height: Math.floor(area.height - outer * 2),
    };
    if (!validRect(root))
        return null;
    const frames = new Map();
    const cells = new Map();
    const minima = new Map();
    const bounds = new Map();
    const seen = new Set();
    function measure(node) {
        if ('id' in node) {
            if (seen.has(node.id))
                throw new Error('Duplicate window ID');
            seen.add(node.id);
            const s = specs.get(node.id);
            if (!s || ![s.minWidth, s.minHeight].every(n => Number.isFinite(n) && n > 0) ||
                !(s.maxWidth >= s.minWidth) || !(s.maxHeight >= s.minHeight))
                return null;
            const min = {width: Math.ceil(s.minWidth), height: Math.ceil(s.minHeight)};
            minima.set(node, min);
            return min;
        }
        if (!node.a || !node.b || !['x', 'y'].includes(node.axis))
            return null;
        const a = measure(node.a);
        const b = measure(node.b);
        if (!a || !b)
            return null;
        const min = node.axis === 'x'
            ? {width: a.width + b.width + inner, height: Math.max(a.height, b.height)}
            : {width: Math.max(a.width, b.width), height: a.height + b.height + inner};
        minima.set(node, min);
        return min;
    }
    function place(node, r) {
        bounds.set(node, r);
        const min = minima.get(node);
        if (r.width < min.width || r.height < min.height)
            return false;
        if ('id' in node) {
            const s = specs.get(node.id);
            const width = Math.min(r.width, Math.floor(s.maxWidth));
            const height = Math.min(r.height, Math.floor(s.maxHeight));
            frames.set(node.id, {x: r.x + Math.floor((r.width - width) / 2),
                y: r.y + Math.floor((r.height - height) / 2), width, height});
            cells.set(node.id, r);
            return true;
        }
        const dim = node.axis === 'x' ? 'width' : 'height';
        const pos = node.axis;
        const available = r[dim] - inner;
        const lo = minima.get(node.a)[dim];
        const hi = available - minima.get(node.b)[dim];
        const ratio = Number.isFinite(node.ratio) ? Math.max(0, Math.min(1, node.ratio)) : 0.5;
        const size = Math.max(lo, Math.min(hi, Math.floor(available * ratio + 1e-7)));
        return place(node.a, {...r, [dim]: size}) &&
            place(node.b, {...r, [pos]: r[pos] + size + inner, [dim]: available - size});
    }
    if (tree && (!measure(tree) || !place(tree, root)))
        return null;
    return {frames, cells, bounds, minima};
}

export function insert(tree, id, specs, area, gaps, preferredId = null, side = 'right', preserveFocus = false) {
    if (!['left', 'right'].includes(side)) return null;
    if (ids(tree).includes(id))
        throw new Error('Cannot insert a duplicate window');
    if (!tree) {
        const next = {id};
        return solve(next, area, specs, gaps) ? next : null;
    }
    const current = solve(tree, area, specs, gaps);
    if (!current)
        return null;
    const order = ids(tree).sort((a, b) => {
        if (a === preferredId) return -1;
        if (b === preferredId) return 1;
        const ra = current.cells.get(a);
        const rb = current.cells.get(b);
        return rb.width * rb.height - ra.width * ra.height;
    });
    if (preserveFocus && current.frames.has(preferredId))
        order.sort((a, b) => Number(a === preferredId) - Number(b === preferredId));
    const candidates = [];
    for (const target of order) {
        const r = current.cells.get(target);
        const axes = r.width >= r.height ? ['x', 'y'] : ['y', 'x'];
        for (const axis of axes) {
            const next = replace(tree, target, {axis, ratio: 0.5,
                a: {id: side === 'left' ? id : target}, b: {id: side === 'left' ? target : id}});
            if (!preserveFocus || !current.frames.has(preferredId)) {
                if (solve(next, area, specs, gaps)) return next;
            } else {
                candidates.push(next);
            }
        }
    }
    if (!candidates.length) return null;
    const frame = current.frames.get(preferredId);
    const original = specs.get(preferredId);
    // Temporary minima protect the previous focused frame. Other branches may
    // shrink first, subject to their real application constraints.
    const protectedSpecs = new Map(specs);
    function plan(next, retention) {
        protectedSpecs.set(preferredId, {...original,
            minWidth: Math.max(original.minWidth,
                Math.ceil(original.minWidth + (frame.width - original.minWidth) * retention)),
            minHeight: Math.max(original.minHeight,
                Math.ceil(original.minHeight + (frame.height - original.minHeight) * retention)),
        });
        return solve(next, area, protectedSpecs, gaps);
    }
    // Prefer splitting other windows; preserve the focus at full size whenever
    // any insertion can do so. Stable order keeps side and largest-tile ties.
    let best = null, bestPlan = null, bestRetention = -1;
    for (const next of candidates) {
        const full = plan(next, 1);
        if (full) return freezeRatios(next, full);
    }
    // No candidate fits with the old focused size. Relax only as much as the
    // layout needs, rather than halving the focused tile unconditionally.
    for (const next of candidates) {
        let fitting = plan(next, 0);
        if (!fitting) continue;
        let lo = 0, hi = 1;
        for (let step = 0; step < 16; step++) {
            const mid = (lo + hi) / 2;
            const result = plan(next, mid);
            if (result) { lo = mid; fitting = result; }
            else hi = mid;
        }
        if (lo > bestRetention) {
            best = next; bestPlan = fitting; bestRetention = lo;
        }
    }
    return best ? freezeRatios(best, bestPlan) : null;
}

// Persist the solved divisions, not the temporary application minima. Later
// solves, mouse resizing and swaps continue to use the real constraints.
function freezeRatios(node, plan) {
    if ('id' in node) return node;
    const dim = node.axis === 'x' ? 'width' : 'height';
    const a = plan.bounds.get(node.a)[dim], b = plan.bounds.get(node.b)[dim];
    return {...node, ratio: a / (a + b),
        a: freezeRatios(node.a, plan), b: freezeRatios(node.b, plan)};
}

