// SPDX-License-Identifier: GPL-3.0-or-later
// Read installed metadata only. Never launch the applications or contact Shell.
import Gio from 'gi://Gio';
import {PackageLookup} from '../src/packageLookup.js';
function assert(value, message) { if (!value) throw Error(message); }
const lookup = new PackageLookup();
if (Gio.File.new_for_path('/usr/bin/openlogi-overlay').query_exists(null)) {
    const appId = await lookup.lookup('/usr/bin/openlogi-overlay');
    assert(appId === 'openlogi.desktop', 'Installed helper should resolve to its single application');
    assert(lookup.aliases(appId).includes('wm-class:org.openlogi.openlogi'), 'Desktop StartupWMClass should support legacy default rules');
}
assert(await lookup.lookup('/tmp/justtiling-no-such-package-helper') === null, 'Unknown executable must have no identity');
assert(await lookup.lookup('/usr/bin/helper (deleted)') === null, 'Deleted process must not get a stale package identity');
lookup.dispose();
assert(await lookup.lookup('/usr/bin/openlogi-overlay') === null, 'Disposed lookup must not spawn queries');
const interrupted = new PackageLookup();
const pending = interrupted.query(['--listfiles', 'openlogi']);
const timers = [...interrupted.jobs.values()];
interrupted.dispose();
assert(interrupted.jobs.size === 0 && timers.every(job => job.timer === 0), 'Shutdown must immediately remove all GLib sources');
assert(interrupted.appAliases.size === 0, 'Shutdown must release application alias cache');
await pending;
assert(interrupted.jobs.size === 0, 'Shutdown must reap pending subprocess');
const unavailable = new PackageLookup(); unavailable.program = null;
assert(await unavailable.lookup('/usr/bin/openlogi-overlay') === null, 'Missing dpkg must leave native identity handling intact');
unavailable.dispose();
if (Gio.File.new_for_path('/usr/share/applications/openlogi.desktop').query_exists(null) &&
    Gio.File.new_for_path('/usr/share/applications/org.gnome.Calculator.desktop').query_exists(null)) {
    const ambiguous = new PackageLookup();
    ambiguous.query = async args => args[0] === '--search' ? 'suite: /opt/suite-helper' :
        '/usr/share/applications/openlogi.desktop\n/usr/share/applications/org.gnome.Calculator.desktop';
    assert(await ambiguous.lookup('/opt/suite-helper') === null, 'Two distinct visible apps must not be merged');
    ambiguous.dispose();
}
print('Package lookup OK: real read-only installed metadata, legacy alias, missing/deleted process and shutdown. No application launched.');
