// SPDX-License-Identifier: GPL-3.0-or-later
// Each layout engine owns exactly one logical monitor. Native objects and
// observers remain shared; only window membership, domains and work areas vary.
export class MonitorAdapter {
    constructor(root, index, admitted = () => true) {
        this.root = root;
        this.index = index;
        this.admitted = admitted;
        this.secondaryDomain = {monitor: index};
        this.workspace = this.activeWorkspace();
        return new Proxy(this, {
            get: (target, key) => {
                const value = key in target ? target[key] : root[key];
                return typeof value === 'function' ? value.bind(key in target ? target : root) : value;
            },
        });
    }
    secondaryShared() {
        return Boolean(this.root.workspacesOnlyOnPrimary?.() && this.index !== (this.root.primaryMonitor?.() ?? 0));
    }
    activeWorkspace() {
        const workspace = this.root.activeWorkspace?.() ?? 0;
        this.workspace = this.secondaryShared() ? this.secondaryDomain : workspace;
        return this.workspace;
    }
    workspaces() {
        return this.secondaryShared() ? [this.secondaryDomain] : this.root.workspaces?.() ?? [this.workspace];
    }
    list() {
        return this.root.list().filter(id => (this.root.read(id)?.monitor ?? 0) === this.index && this.admitted(id, this.index));
    }
    read(id) {
        const data = this.root.read(id);
        if (!data) return null;
        const shared = this.secondaryShared();
        return {...data, monitor: data.monitor ?? 0,
            domain: shared ? this.secondaryDomain : data.domain,
            sticky: shared ? false : data.sticky,
            inScope: (data.monitor ?? 0) === this.index && (shared ||
                (data.domain !== undefined ? data.domain === this.workspace : data.inScope))};
    }
    pinApplies(profile) {
        const saved = profile.monitor;
        if (!saved) return true; // Pins created before monitor preferences remain compatible.
        if (saved.connector) return this.root.monitorIdentity?.(this.index)?.connector === saved.connector;
        return saved.index === this.index;
    }
    monitorCount() { return this.index < this.root.monitorCount() ? 1 : 0; }
    targetActive() { return this.secondaryShared() || this.root.targetActive(); }
    targetExists() { return this.monitorCount() === 1 && this.root.targetExists(); }
    area() { return this.root.monitorArea?.(this.index) ?? this.root.area(); }
}
