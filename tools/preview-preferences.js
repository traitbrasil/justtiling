// SPDX-License-Identifier: GPL-3.0-or-later
// Standalone preview; launched with memory-only settings by preview-english.py.
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {buildPreferences} from '../src/preferences.js';

const application = new Adw.Application({application_id: 'com.trait.JustTiling.EnglishPreview',
    flags: Gio.ApplicationFlags.NON_UNIQUE});
application.connect('activate', () => {
    const window = new Adw.PreferencesWindow({application, default_width: 700, default_height: 800});
    const settings = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.justtiling'});
    const metadataFile = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('metadata.json');
    const [, bytes] = metadataFile.load_contents(null);
    const metadata = JSON.parse(new TextDecoder().decode(bytes));
    const ui = buildPreferences(window, settings, metadata);
    if (ui.about.versionRow.subtitle !== metadata['version-name']) throw new Error('Preview version mismatch');
    if (ui.about.page.title !== 'About') throw new Error('English preview did not select English');
    window.connect('close-request', () => { ui.dispose(); return false; });
    window.present();
    if (GLib.getenv('TRAIT_PREVIEW_SMOKE') === '1') {
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            window.close(); return GLib.SOURCE_REMOVE;
        });
    }
});
application.run([]);
