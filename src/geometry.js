// SPDX-License-Identifier: GPL-3.0-or-later
export function plainRect(r) {
    return {x: r.x, y: r.y, width: r.width, height: r.height};
}

export function clampRect(rect, area) {
    const width = Math.max(1, Math.min(rect.width, area.width));
    const height = Math.max(1, Math.min(rect.height, area.height));
    return {
        x: Math.max(area.x, Math.min(rect.x, area.x + area.width - width)),
        y: Math.max(area.y, Math.min(rect.y, area.y + area.height - height)),
        width, height,
    };
}

// Meta 51 core getters return internal size_hints (already scaled by Mutter).
// Match core/constraints.c:get_size_limits: client -> frame, NOT protocol -> stage again.
export function frameLimits(minimum, maximum, convert) {
    const [hasMin, minW, minH] = minimum;
    const [hasMax, maxW, maxH] = maximum;
    const min = convert(hasMin ? minW : 0, hasMin ? minH : 0);
    const max = convert(hasMax && maxW > 0 ? Math.min(maxW, 1000000) : 1000000,
        hasMax && maxH > 0 ? Math.min(maxH, 1000000) : 1000000);
    return {
        minWidth: Math.max(0, min.width), minHeight: Math.max(0, min.height),
        maxWidth: hasMax && maxW > 0 ? max.width : Infinity,
        maxHeight: hasMax && maxH > 0 ? max.height : Infinity,
    };
}
