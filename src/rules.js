// SPDX-License-Identifier: GPL-3.0-or-later
export function exclusion(data) {
    if (!data?.alive) return 'destroyed';
    if (!data.normal) return 'window-type';
    if (data.transient) return 'transient';
    if (isNautilusAuxiliary(data)) return 'auxiliary-window';
    if (data.overrideRedirect || data.skipTaskbar) return 'special-window';
    if (data.sticky) return 'sticky';
    if (!data.inScope) return 'outside-target';
    if (data.fullscreen || data.minimized) return 'special-state';
    if (!data.movable || !data.resizable) return 'fixed-size';
    return null;
}

// Nautilus 51's portal chooser is an AdwWindow, not an ApplicationWindow.
// GTK exports its application and bus, but no per-window action object.
// Main Files windows do export that object. Require the complete application
// metadata: a missing window path alone is not evidence for other applications.
export function isNautilusAuxiliary(data) {
    return data?.gtkAppId === 'org.gnome.Nautilus' &&
        data.gtkApplicationPath === '/org/gnome/Nautilus' &&
        typeof data.gtkBusName === 'string' && /^:\d+\.\d+$/.test(data.gtkBusName) &&
        data.gtkWindowPath === null;
}

// Highlighting is independent of tiling eligibility and application identity.
// Only actual focused application windows qualify, not desktop chrome or popups.
export function focusBorderEligible(data) {
    return Boolean(data?.alive && data.mapped && data.appWindow && data.inScope &&
        !data.overrideRedirect && !data.minimized && !data.fullscreen && !data.maximized);
}

// Explicit usability floor; hints can further increase it. No toolkit blacklist.
export function constraints(data) {
    return {
        minWidth: Math.max(240, data.minWidth ?? 0),
        minHeight: Math.max(160, data.minHeight ?? 0),
        maxWidth: data.maxWidth > 0 ? data.maxWidth : Infinity,
        maxHeight: data.maxHeight > 0 ? data.maxHeight : Infinity,
    };
}

// Bound current metadata without truncating identifiers into ambiguous matches.
export function boundedIdentities(values) {
    const result = [], seen = new Set(); let bytes = 0;
    for (const value of values) {
        if (typeof value !== 'string' || !value || value.length > 512 ||
            /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value) || seen.has(value)) continue;
        if (result.length >= 32 || bytes + value.length * 2 > 8192) break;
        seen.add(value); result.push(value); bytes += value.length * 2;
    }
    return result;
}
// Audited, self-only compatibility alias for OpenLogi's separately launched
// Caps Lock OSD. This does not authorize grouping, process access or settings
// writes, and works even when XWayland cannot supply authenticated ownership.
const COMPATIBILITY_IDENTITIES = new Map([
    ['openlogi-lock-key-osd', ['app-id:openlogi.desktop', 'wm-class:org.openlogi.openlogi']],
]);
export function appIdentities(data) {
    const fields = [['app-id', data.appId], ['wm-class', data.wmClass], ['wm-instance', data.wmInstance],
        ['sandbox-id', data.sandboxId], ['gtk-app-id', data.gtkAppId]];
    return boundedIdentities([...fields.filter(([kind, value]) => typeof value === 'string' && value.length + kind.length + 1 <= 512 && value.trim())
        .map(([kind, value]) => `${kind}:${value}`), ...(COMPATIBILITY_IDENTITIES.get(data.wmClass) ?? []), ...(data.applicationIdentities ?? [])]);
}

export function matchesApp(data, exceptions) {
    return appIdentities(data).some(id => exceptions.includes(id));
}

export function setAppException(exceptions, data, enabled) {
    const candidates = appIdentities(data);
    if (!enabled) return exceptions.filter(id => !candidates.includes(id));
    if (!candidates.length || matchesApp(data, exceptions)) return [...exceptions];
    // Prefer application-wide IDs over WM_CLASS instance names.
    const selected = ['app-id:', 'sandbox-id:', 'gtk-app-id:', 'wm-class:', 'wm-instance:']
        .map(prefix => candidates.find(id => id.startsWith(prefix))).find(Boolean);
    return [...exceptions, selected];
}

// Only authenticated Wayland peer PIDs or independently verified package
// ownership may link windows. Client-declared PIDs, desktop IDs and classes
// remain useful for the window's own rule, never as cross-window credentials.
export function ownershipKeys(data) {
    const keys = [];
    if (Number.isInteger(data.ownerPid) && data.ownerPid > 0) keys.push(`peer:${data.ownerPid}`);
    if (typeof data.verifiedAppId === 'string' && data.verifiedAppId.length <= 512)
        keys.push(`package:${data.verifiedAppId}`);
    return keys;
}
export function applicationIdentities(windows) {
    const direct = new Map(), groups = new Map();
    for (const [id, data] of windows) {
        direct.set(id, appIdentities(data ?? {}));
        if (!data || data.transientFor != null || data.normal === false || data.special) continue;
        for (const key of ownershipKeys(data))
            groups.set(key, boundedIdentities([...(groups.get(key) ?? []), ...direct.get(id)]));
    }
    function inherited(id, visited = new Set()) {
        if (visited.has(id) || visited.size >= 16) return [];
        visited.add(id);
        const data = windows.get(id);
        if (!data) return [];
        const keys = ownershipKeys(data);
        const values = [...(direct.get(id) ?? []), ...keys.flatMap(key => groups.get(key) ?? [])];
        const parent = windows.get(data.transientFor);
        if (parent && keys.some(key => ownershipKeys(parent).includes(key)))
            values.push(...inherited(data.transientFor, visited));
        return boundedIdentities(values);
    }
    return new Map([...windows.keys()].map(id => [id, inherited(id)]));
}
