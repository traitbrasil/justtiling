import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gettext from 'gettext';
export class Extension {
    constructor() {
        this.uuid = 'justtiling@trait.com.br';
        Gettext.bindtextdomain('trait-justtiling', GLib.getenv('TRAIT_TEST_LOCALEDIR'));
    }
    openPreferences() { this.preferencesOpened = (this.preferencesOpened ?? 0) + 1; }
    getSettings() { return new Gio.Settings({schema_id: 'org.gnome.shell.extensions.justtiling'}); }
}
