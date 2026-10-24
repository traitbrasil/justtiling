// SPDX-License-Identifier: GPL-3.0-or-later
import {ids, sameRect, solve} from './tree.js';

function exchange(node, first, second) {
    if ('id' in node) {
        if (node.id === first) return {id: second};
        if (node.id === second) return {id: first};
        return node;
    }
    const a = exchange(node.a, first, second), b = exchange(node.b, first, second);
    return a === node.a && b === node.b ? node : {...node, a, b};
}

export function beginDrag(tree, id, frames, area, specs, gaps) {
    if (ids(tree).length < 2) return null;
    const plan = solve(tree, area, specs, gaps);
    if (!plan?.frames.has(id) || [...plan.frames].some(([key, rect]) =>
        !sameRect(frames.get(key), rect, 1))) return null;
    return {tree, id, frame: {...frames.get(id)}, plan, area: {...area},
        specs: new Map(specs), gaps: {...gaps}};
}

export function finishDrag(context, frame, point) {
    if (!context || !frame || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(frame[k])))
        return null;
    const {tree, id, specs, plan, area, gaps} = context;
    // Escape normally restores the starting frame. Small clicks are not a drop.
    if (sameRect(frame, context.frame, 1)) return {tree, target: id};
    if (Math.abs(frame.width - context.frame.width) > 1 ||
        Math.abs(frame.height - context.frame.height) > 1) return null;
    if (Math.hypot(frame.x - context.frame.x, frame.y - context.frame.y) < 8)
        return {tree, target: id};
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const target = [...plan.frames].find(([, r]) => point.x >= r.x && point.x < r.x + r.width &&
        point.y >= r.y && point.y < r.y + r.height)?.[0];
    if (target === undefined) return null;
    if (target === id) return {tree, target};
    const next = swapTiles(tree, id, target, area, specs, gaps);
    return next ? {tree: next, target} : null;
}

export function swapTiles(tree, id, target, area, specs, gaps) {
    const plan = solve(tree, area, specs, gaps);
    if (!plan?.cells.has(id) || !plan.cells.has(target)) return null;
    const fits = (key, cell) => specs.get(key).minWidth <= cell.width && specs.get(key).minHeight <= cell.height;
    if (!fits(id, plan.cells.get(target)) || !fits(target, plan.cells.get(id))) return null;
    const next = exchange(tree, id, target);
    return solve(next, area, specs, gaps) ? next : null;
}

export function directionalNeighbor(cells, id, direction) {
    const source = cells.get(id);
    if (!source || !['left', 'right', 'up', 'down'].includes(direction)) return null;
    const horizontal = ['left', 'right'].includes(direction);
    const axis = horizontal ? 'x' : 'y', dim = horizontal ? 'width' : 'height';
    const cross = horizontal ? 'y' : 'x', size = horizontal ? 'height' : 'width';
    const positive = ['right', 'down'].includes(direction);
    const candidates = [];
    for (const [other, rect] of cells) {
        if (other === id) continue;
        const gap = positive ? rect[axis] - (source[axis] + source[dim]) : source[axis] - (rect[axis] + rect[dim]);
        const overlap = Math.min(source[cross] + source[size], rect[cross] + rect[size]) - Math.max(source[cross], rect[cross]);
        if (gap < 0 || overlap <= 0) continue;
        const distance = Math.abs(rect[cross] + rect[size] / 2 - source[cross] - source[size] / 2);
        candidates.push({id: other, gap, overlap, distance});
    }
    candidates.sort((a, b) => a.gap - b.gap || b.overlap - a.overlap || a.distance - b.distance);
    return candidates[0]?.id ?? null;
}
