// SPDX-License-Identifier: GPL-3.0-or-later
// Read-only, bounded process lineage. Never inspect arguments or environment.
export async function processLineage(pid, readStatus, readExecutable, cancelled = () => false) {
    const result = [], seen = new Set();
    while (!cancelled() && Number.isInteger(pid) && pid > 1 && !seen.has(pid) && result.length < 12) {
        seen.add(pid);
        let status = '', executable = null;
        try { status = (await readStatus(pid)) ?? ''; } catch (_) { /* process exited or access denied */ }
        if (cancelled()) break;
        try { executable = (await readExecutable(pid)) ?? null; } catch (_) { /* optional */ }
        if (cancelled()) break;
        const parent = Number(status.match(/^PPid:\s+(\d+)/m)?.[1] ?? 0);
        result.push({pid, parent, executable});
        pid = parent;
    }
    return result;
}
