// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GioUnix from 'gi://GioUnix';
import {desktopFiles, packageOwner} from './packageIdentity.js';

// Optional Debian/Ubuntu fallback for helpers that GNOME cannot associate.
// Commands only query the installed package database; no shell is invoked.
export class PackageLookup {
    constructor() {
        this.program = GLib.find_program_in_path('dpkg-query');
        this.jobs = new Map();
        this.appAliases = new Map();
        this.disposed = false;
    }
    executable(pid) {
        if (!Number.isInteger(pid) || pid <= 0) return null;
        try {
            return Gio.File.new_for_path(`/proc/${pid}/exe`).query_info(
                'standard::symlink-target', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null).get_symlink_target();
        } catch (_) { return null; }
    }
    query(args) {
        if (this.disposed || !this.program) return Promise.resolve(null);
        return new Promise(resolve => {
            let process;
            try {
                process = Gio.Subprocess.new([this.program, ...args],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            } catch (_) { resolve(null); return; }
            const job = {timer: 0};
            this.jobs.set(process, job);
            job.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 750, () => {
                job.timer = 0; process.force_exit(); return GLib.SOURCE_REMOVE;
            });
            process.communicate_utf8_async(null, null, (source, result) => {
                let output = null;
                try {
                    const [, stdout] = source.communicate_utf8_finish(result);
                    if (source.get_successful() && stdout.length < 1048576) output = stdout;
                } catch (_) { /* missing package/tool, timeout or shutdown */ }
                if (job.timer) { GLib.source_remove(job.timer); job.timer = 0; }
                this.jobs.delete(process);
                resolve(output);
            });
        });
    }
    async lookup(executable) {
        if (!executable?.startsWith('/') || executable.endsWith(' (deleted)')) return null;
        const search = await this.query(['--search', executable]);
        if (!search || this.disposed) return null;
        const owner = packageOwner(search, executable);
        if (!owner) return null;
        const listing = await this.query(['--listfiles', owner]);
        if (!listing || this.disposed) return null;
        const candidates = new Set();
        for (const file of desktopFiles(listing)) {
            const app = GioUnix.DesktopAppInfo.new_from_filename(file);
            if (app && !app.get_is_hidden() && !app.get_nodisplay() && app.get_executable()) {
                const id = file.slice(file.lastIndexOf('/') + 1);
                candidates.add(id);
                const wmClass = app.get_startup_wm_class();
                this.appAliases.set(id, wmClass ? [`wm-class:${wmClass}`] : []);
            }
        }
        // A package containing several distinct applications is ambiguous.
        return candidates.size === 1 ? [...candidates][0] : null;
    }
    aliases(appId) { return this.appAliases.get(appId) ?? []; }
    dispose() {
        this.disposed = true;
        for (const [process, job] of this.jobs) {
            // Sources must be removed synchronously, before async process reaping.
            if (job.timer) { GLib.source_remove(job.timer); job.timer = 0; }
            process.force_exit();
        }
        this.jobs.clear();
        this.appAliases.clear();
    }
}
