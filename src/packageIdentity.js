// SPDX-License-Identifier: GPL-3.0-or-later
// Async, per-executable cache. No process IDs or window classes are persisted.
export class PackageIdentity {
    constructor(lookup, changed) {
        this.lookup = lookup;
        this.changed = changed;
        this.cache = new Map();
        this.disposed = false;
    }
    get(executable) {
        if (this.disposed || !executable) return {pending: false, appId: null};
        if (this.cache.has(executable)) return this.cache.get(executable);
        if (this.cache.size >= 128) return {pending: false, appId: null};
        const result = {pending: true, appId: null};
        this.cache.set(executable, result);
        Promise.resolve().then(() => this.disposed ? null : this.lookup(executable))
            .catch(() => null).then(appId => {
                if (this.disposed) return;
                result.pending = false;
                result.appId = typeof appId === 'string' && appId.endsWith('.desktop') ? appId : null;
                this.changed();
            });
        return result;
    }
    dispose() { this.disposed = true; this.cache.clear(); }
}

export function packageOwner(output, executable) {
    const owners = new Set();
    for (const line of output.split('\n')) {
        const split = line.indexOf(': ');
        if (split < 0 || line.slice(split + 2) !== executable) continue;
        const owner = line.slice(0, split);
        if (/^[a-z0-9][a-z0-9+.-]*(?::[a-z0-9-]+)?$/.test(owner)) owners.add(owner);
    }
    return owners.size === 1 ? [...owners][0] : null;
}

export function desktopFiles(output) {
    return [...new Set(output.split('\n').filter(path =>
        /^\/usr\/share\/applications\/[^/]+\.desktop$/.test(path)))];
}
