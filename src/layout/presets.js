// SPDX-License-Identifier: GPL-3.0-or-later
const columns = widths => {
    let x = 0;
    return widths.map(width => { const region = {x, y: 0, width, height: 1}; x += width; return region; });
};
export const PRESETS = [
    {id: 'halves', regions: columns([0.5, 0.5])},
    {id: 'thirds', regions: columns([1 / 3, 1 / 3, 1 / 3])},
    {id: 'quarters', regions: [0, 0.5].flatMap(y => [0, 0.5].map(x => ({x, y, width: 0.5, height: 0.5})))},
    {id: 'center', regions: columns([0.25, 0.5, 0.25])},
    {id: 'rows', regions: [0, 0.5].map(y => ({x: 0, y, width: 1, height: 0.5}))},
];
export function presetFrame(region, area, gaps) {
    const root = {x: Math.round(area.x + gaps.outer), y: Math.round(area.y + gaps.outer),
        width: Math.floor(area.width - 2 * gaps.outer), height: Math.floor(area.height - 2 * gaps.outer)};
    const left = Math.round(root.x + region.x * root.width + (region.x > 0 ? gaps.inner / 2 : 0));
    const top = Math.round(root.y + region.y * root.height + (region.y > 0 ? gaps.inner / 2 : 0));
    const right = Math.round(root.x + (region.x + region.width) * root.width -
        (region.x + region.width < 0.99999 ? gaps.inner / 2 : 0));
    const bottom = Math.round(root.y + (region.y + region.height) * root.height -
        (region.y + region.height < 0.99999 ? gaps.inner / 2 : 0));
    return {x: left, y: top, width: right - left, height: bottom - top};
}
export function layoutBarGeometry(area) {
    if (!area || ![area.x, area.y, area.width, area.height].every(Number.isFinite) || area.width < 240 || area.height < 180) return null;
    const gap = 12, padding = 12, cardWidth = Math.min(110, Math.floor((area.width - 48 - gap * 4 - padding * 2) / 5));
    const width = padding * 2 + cardWidth * 5 + gap * 4;
    const frame = {x: Math.round(area.x + (area.width - width) / 2), y: area.y + 12, width, height: 106};
    const zones = PRESETS.flatMap((preset, index) => preset.regions.map((region, quadrant) => ({
        id: `${preset.id}:${quadrant}`, preset: preset.id, region,
        hit: {x: frame.x + padding + index * (cardWidth + gap) + region.x * cardWidth + 2,
            y: frame.y + 36 + region.y * 58 + 2,
            width: region.width * cardWidth - 4, height: region.height * 58 - 4},
    })));
    return {frame, zones};
}
export function layoutHit(point, geometry) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    return geometry?.zones.find(({hit}) => point.x >= hit.x && point.x < hit.x + hit.width &&
        point.y >= hit.y && point.y < hit.y + hit.height) ?? null;
}
export function dragMoved(context, frame) {
    return !!frame && Math.abs(frame.width - context.frame.width) <= 1 &&
        Math.abs(frame.height - context.frame.height) <= 1 &&
        Math.hypot(frame.x - context.frame.x, frame.y - context.frame.y) >= 8;
}

export function insideBar(point, geometry) {
    const frame = geometry?.frame;
    return Boolean(point && frame && Number.isFinite(point.x) && Number.isFinite(point.y) &&
        point.x >= frame.x && point.x < frame.x + frame.width && point.y >= frame.y && point.y < frame.y + frame.height);
}
