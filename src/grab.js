// SPDX-License-Identifier: GPL-3.0-or-later
// The adapter supplies the real Meta.GrabOp enum; no numeric bitmask assumptions.
export function describeGrab(op, operations) {
    for (const [suffix, edges] of Object.entries({
        N: ['north'], S: ['south'], E: ['east'], W: ['west'],
        NW: ['north', 'west'], NE: ['north', 'east'],
        SW: ['south', 'west'], SE: ['south', 'east'],
    })) {
        if ([`RESIZING_${suffix}`, `KEYBOARD_RESIZING_${suffix}`]
            .some(name => operations[name] !== undefined && operations[name] === op))
            return {kind: 'resize', edges};
    }
    if (['MOVING', 'MOVING_UNCONSTRAINED'].some(name =>
        operations[name] !== undefined && operations[name] === op))
        return {kind: 'move', edges: [], pointer: true};
    return {kind: 'move', edges: []};
}
