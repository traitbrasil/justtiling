// SPDX-License-Identifier: GPL-3.0-or-later
import {sameRect, solve} from './tree.js';

const edgeInfo = {
    east: {axis: 'x', dimension: 'width', side: 'a', far: true},
    west: {axis: 'x', dimension: 'width', side: 'b', far: false},
    south: {axis: 'y', dimension: 'height', side: 'a', far: true},
    north: {axis: 'y', dimension: 'height', side: 'b', far: false},
};
const close = (a, b) => Math.abs(a - b) <= 1;
const edgePosition = (r, info) => r[info.axis] + (info.far ? r[info.dimension] : 0);

function findPath(node, id, path = []) {
    if (!node || node.empty) return null;
    if ('id' in node) return node.id === id ? path : null;
    return findPath(node.a, id, [...path, {node, side: 'a'}]) ??
        findPath(node.b, id, [...path, {node, side: 'b'}]);
}

function withRatio(tree, path, ratio) {
    if (!path.length) return {...tree, ratio};
    const [side, ...rest] = path;
    return {...tree, [side]: withRatio(tree[side], rest, ratio)};
}

// Snapshot of a valid, settled layout. Only shared boundaries can adjust a split.
export function beginResize(tree, id, edges, frame, area, specs, gaps) {
    if (!Array.isArray(edges) || !edges.length || edges.length > 2 ||
        edges.some(edge => !edgeInfo[edge])) return null;
    const axes = edges.map(edge => edgeInfo[edge].axis);
    if (new Set(axes).size !== edges.length) return null;
    const plan = solve(tree, area, specs, gaps);
    const path = findPath(tree, id);
    if (!plan || !path || !sameRect(frame, plan.frames.get(id), 1)) return null;
    const cell = plan.cells.get(id);
    const targets = [];
    for (const edge of edges) {
        const info = edgeInfo[edge];
        // A capped/centered frame must not masquerade as its cell's boundary.
        if (!close(edgePosition(frame, info), edgePosition(cell, info))) return null;
        let found = null;
        for (let i = path.length - 1; i >= 0; i--) {
            const {node, side} = path[i];
            if (node.axis !== info.axis || side !== info.side) continue;
            const child = plan.bounds.get(node[side]);
            if (!close(edgePosition(cell, info), edgePosition(child, info))) continue;
            found = {edge, info, node, path: path.slice(0, i).map(p => p.side)};
            break;
        }
        if (!found) return null;
        targets.push(found);
    }
    return {tree, id, frame: {...frame}, area: {...area}, gaps: {...gaps},
        specs: new Map(specs), plan, targets};
}

// Validate native edge movement independently of the BSP. Pinned outer edges
// can reserve a new rectangle even when no shared split exists at that edge.
export function anchoredResize(original, frame, edges) {
    if (!original || !frame || !Array.isArray(edges) || !edges.length || edges.length > 2 ||
        edges.some(edge => !edgeInfo[edge]) ||
        new Set(edges.map(edge => edgeInfo[edge].axis)).size !== edges.length ||
        !['x', 'y', 'width', 'height'].every(k => Number.isFinite(frame[k])) ||
        frame.width <= 0 || frame.height <= 0) return false;
    for (const [axis, dim] of [['x', 'width'], ['y', 'height']]) {
        const info = edges.map(edge => edgeInfo[edge]).find(edge => edge.axis === axis);
        if (info ? !close(info.far ? frame[axis] : frame[axis] + frame[dim],
            info.far ? original[axis] : original[axis] + original[dim]) :
            !close(frame[axis], original[axis]) || !close(frame[dim], original[dim])) return false;
    }
    return true;
}

export function finishResize(context, frame) {
    if (!context || !anchoredResize(context.frame, frame, context.targets.map(t => t.edge))) return null;
    const {tree, area, specs, gaps, targets} = context;
    const original = context.frame;
    if (sameRect(frame, original, 1)) return {tree, plan: context.plan};
    let next = tree;
    for (const target of targets) {
        const {info, node, path} = target;
        const rect = context.plan.bounds.get(node);
        const available = rect[info.dimension] - gaps.inner;
        const previous = context.plan.bounds.get(node.a)[info.dimension];
        const delta = edgePosition(frame, info) - edgePosition(original, info);
        const min = context.plan.minima.get(node.a)[info.dimension];
        const max = available - context.plan.minima.get(node.b)[info.dimension];
        const size = Math.max(min, Math.min(max, Math.round(previous + delta)));
        next = withRatio(next, path, size / available);
    }
    const plan = solve(next, area, specs, gaps);
    return plan ? {tree: next, plan} : null;
}

export function sameSpecs(a, b) {
    return a.size === b.size && [...a].every(([id, spec]) => {
        const other = b.get(id);
        return other && ['minWidth', 'minHeight', 'maxWidth', 'maxHeight']
            .every(k => spec[k] === other[k]);
    });
}
