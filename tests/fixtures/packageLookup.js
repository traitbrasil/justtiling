// SPDX-License-Identifier: GPL-3.0-or-later
export const executables = new Map(), applications = new Map(), calls = [];
export const aliases = new Map();
export class PackageLookup {
    executable(pid) { return executables.get(pid) ?? null; }
    async lookup(path) { calls.push(path); return await (applications.get(path) ?? null); }
    aliases(appId) { return aliases.get(appId) ?? []; }
    dispose() {}
}
