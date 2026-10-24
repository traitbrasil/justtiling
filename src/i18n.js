// SPDX-License-Identifier: GPL-3.0-or-later
import Gettext from 'gettext';

// GNOME initializes this domain from metadata in both Shell and Preferences.
export function _(message) { return Gettext.dgettext('trait-justtiling', message); }
