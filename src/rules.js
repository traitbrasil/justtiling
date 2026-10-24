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

export function appIdentities(data) {
    const fields = [['app-id', data.appId], ['wm-class', data.wmClass], ['wm-instance', data.wmInstance],
        ['sandbox-id', data.sandboxId], ['gtk-app-id', data.gtkAppId]];
    return [...new Set([...fields.filter(([, value]) => typeof value === 'string' && value.trim())
        .map(([kind, value]) => `${kind}:${value}`), ...(data.applicationIdentities ?? [])])];
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

// Group only by compositor application, positive client PID, or an explicit
// transient parent. Titles, executable names and generic WM_CLASS are not links.
export function applicationIdentities(windows) {
    const parent = new Map([...windows.keys()].map(id => [id, id]));
    function root(id) {
        let key = id;
        while (parent.get(key) !== key) key = parent.get(key);
        while (parent.get(id) !== id) { const next = parent.get(id); parent.set(id, key); id = next; }
        return key;
    }
    function link(a, b) { parent.set(root(a), root(b)); }
    const groups = new Map();
    for (const [id, d] of windows) {
        if (!d) continue;
        const keys = [];
        if (d.appGroupId) keys.push(`app:${d.appGroupId}`);
        if (d.appId) keys.push(`desktop:${d.appId}`);
        if (Number.isInteger(d.pid) && d.pid > 0) keys.push(`pid:${d.pid}`);
        for (const key of keys) {
            if (groups.has(key)) link(id, groups.get(key));
            else groups.set(key, id);
        }
        if (d.transientFor !== null && d.transientFor !== undefined && windows.has(d.transientFor))
            link(id, d.transientFor);
    }
    const identities = new Map();
    for (const [id, d] of windows) {
        const key = root(id);
        if (!identities.has(key)) identities.set(key, new Set());
        if (d) for (const value of appIdentities(d)) identities.get(key).add(value);
    }
    return new Map([...windows.keys()].map(id => [id, [...identities.get(root(id))]]));
}

// Upgrade old per-window identifiers only when that exact window is associated
// with an installed application. Runtime group IDs and PIDs are never persisted.
export function canonicalAppExceptions(exceptions, windows) {
    return [...new Set(exceptions.flatMap(rule => {
        const apps = [...windows.values()].filter(d => d?.appId &&
            appIdentities({...d, applicationIdentities: []}).includes(rule));
        return apps.length ? apps.map(d => `app-id:${d.appId}`) : [rule];
    }))];
}
