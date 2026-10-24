// SPDX-License-Identifier: GPL-3.0-or-later
import {_} from './i18n.js';
import {format} from './strings.js';
// GTK process only. System keybinding settings are read, never written.
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import {canonicalAccelerator, SHORTCUT_TITLES, canOverride} from './keybindings.js';
import {SYSTEM_SCHEMAS} from './shortcutOverrides.js';
import {Connections} from './resources.js';

const titles = SHORTCUT_TITLES;
const schemaNames = SYSTEM_SCHEMAS;

function systemSources() {
    const source = Gio.SettingsSchemaSource.get_default();
    return schemaNames.flatMap(name => {
        const schema = source.lookup(name, true);
        return schema ? [{name, schema, settings: new Gio.Settings({settings_schema: schema})}] : [];
    });
}

function conflict(values, key, settings, sources) {
    const wanted = values.map(canonicalAccelerator).filter(Boolean);
    const systemWanted = values.filter(value => !canOverride(key, value)).map(canonicalAccelerator);
    for (const other of Object.keys(titles)) {
        if (other !== key && settings.get_strv(other).some(value => wanted.includes(canonicalAccelerator(value))))
            return format(_("Already used for “%s”."), _(titles[other]));
    }
    for (const source of sources) {
        for (const name of source.schema.list_keys()) {
            if (source.settings.get_value(name).get_type_string() !== 'as') continue;
            if (source.settings.get_strv(name).some(value => systemWanted.includes(canonicalAccelerator(value))))
                return _("This combination is already used by a GNOME shortcut.");
        }
    }
    return null;
}

function label(values) {
    return values.map(value => {
        const [ok, key, mods] = Gtk.accelerator_parse(value);
        return ok ? Gtk.accelerator_get_label(key, mods) : value;
    }).join(_(" or ")) || _("Disabled");
}

export function shortcutPreferences(parent, settings) {
    const signals = new Connections();
    const sources = systemSources();
    const rows = {}, editButtons = {}, resetButtons = {};
    const group = new Adw.PreferencesGroup({title: _("Keyboard shortcuts"),
        description: _("Choose a shortcut or disable its keyboard action. Super+Arrow temporarily replaces GNOME shortcuts while tiling is active. The menu remains available.")});
    let capture = null, disposed = false;
    const refresh = () => {
        for (const [key, row] of Object.entries(rows)) {
            const values = settings.get_strv(key);
            const warning = conflict(values, key, settings, sources);
            row.subtitle = `${label(values)}${warning ? ` — ${warning}` : ''}`;
        }
    };
    const open = key => {
        if (disposed) return;
        capture?.dispose();
        const dialogSignals = new Connections();
        const dialog = new Adw.Window({title: _("Set shortcut"), transient_for: parent,
            modal: true, default_width: 460, default_height: 270, resizable: false});
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 16});
        box.append(new Adw.HeaderBar());
        const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 16,
            margin_start: 24, margin_end: 24, margin_bottom: 24});
        content.append(new Gtk.Label({label: _(titles[key]), wrap: true}));
        content.append(new Gtk.Label({label: _("Press the desired key combination.\nBackspace disables; Enter saves; Escape cancels."), wrap: true}));
        const preview = new Gtk.ShortcutLabel({accelerator: ''});
        content.append(preview);
        const status = new Gtk.Label({label: _("Saving replaces the shortcuts for this action."), wrap: true});
        content.append(status);
        const save = new Gtk.Button({label: _("Save"), sensitive: false, halign: Gtk.Align.CENTER});
        save.add_css_class('suggested-action'); content.append(save);
        box.append(content); dialog.set_content(box);
        const controller = new Gtk.EventControllerKey({propagation_phase: Gtk.PropagationPhase.CAPTURE});
        dialog.add_controller(controller);
        let candidate = null, closed = false, surface = null;
        const validate = () => {
            const warning = candidate === null ? null : conflict(candidate, key, settings, sources);
            save.sensitive = candidate !== null && !warning;
            status.label = warning ?? (candidate?.length === 0 ? _("The menu will remain available.") :
                _("Saving replaces the shortcuts for this action."));
        };
        const dispose = () => {
            if (closed) return;
            closed = true;
            // Always release the temporary request, including parent close and cancellation.
            surface?.restore_system_shortcuts();
            dialogSignals.clear();
            dialog.destroy();
            if (capture?.dialog === dialog) capture = null;
        };
        dialogSignals.add(dialog, 'map', () => {
            surface = dialog.get_surface();
            surface?.inhibit_system_shortcuts(null);
        });
        dialogSignals.add(dialog, 'close-request', () => { dispose(); return true; });
        dialogSignals.add(controller, 'key-pressed', (_controller, keyval, _code, state) => {
            const mods = state & Gtk.accelerator_get_default_mod_mask();
            if ([Gdk.KEY_Tab, Gdk.KEY_ISO_Left_Tab].includes(keyval) &&
                !(mods & (Gdk.ModifierType.SUPER_MASK | Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.ALT_MASK)))
                return false;
            if (keyval === Gdk.KEY_space && mods === 0 && save.has_focus) return false;
            if ([Gdk.KEY_Return, Gdk.KEY_KP_Enter].includes(keyval) && mods === 0) {
                if (save.sensitive) save.emit('clicked');
                return true;
            }
            if (keyval === Gdk.KEY_Escape && mods === 0) { dispose(); return true; }
            if (keyval === Gdk.KEY_BackSpace && mods === 0) {
                candidate = []; preview.accelerator = ''; preview.disabled_text = _("Disabled"); validate(); return true;
            }
            // Modifiers alone are not a candidate; ignore lock state, retain explicit Shift.
            if (!Gtk.accelerator_valid(keyval, mods)) return true;
            if (!(mods & (Gdk.ModifierType.SUPER_MASK | Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.ALT_MASK))) {
                candidate = null; save.sensitive = false;
                preview.accelerator = ''; preview.disabled_text = _("Invalid shortcut");
                status.label = _("Use Super, Ctrl or Alt together with another key.");
                return true;
            }
            candidate = [Gtk.accelerator_name(Gdk.keyval_to_lower(keyval), mods)];
            preview.accelerator = candidate[0]; validate(); return true;
        });
        dialogSignals.add(save, 'clicked', () => {
            validate();
            if (!save.sensitive) return;
            const values = candidate;
            dispose();
            settings.set_strv(key, values);
        });
        for (const own of Object.keys(titles)) dialogSignals.add(settings, `changed::${own}`, validate);
        for (const source of sources) dialogSignals.add(source.settings, 'changed', validate);
        capture = {dialog, controller, save, status, preview, dispose};
        dialog.present();
    };
    for (const [key, title] of Object.entries(titles)) {
        const row = new Adw.ActionRow({title: _(title), use_markup: false});
        const edit = new Gtk.Button({label: _("Change"), valign: Gtk.Align.CENTER});
        const reset = new Gtk.Button({icon_name: 'edit-undo-symbolic', valign: Gtk.Align.CENTER,
            tooltip_text: _("Restore the default shortcut for this action")});
        row.add_suffix(edit); row.add_suffix(reset); row.activatable_widget = edit;
        signals.add(edit, 'clicked', () => open(key));
        signals.add(reset, 'clicked', () => settings.reset(key));
        signals.add(settings, `changed::${key}`, refresh);
        rows[key] = row; editButtons[key] = edit; resetButtons[key] = reset;
        group.add(row);
    }
    for (const source of sources) signals.add(source.settings, 'changed', refresh);
    refresh();
    return {group, rows, editButtons, resetButtons, get capture() { return capture; }, dispose() {
        if (disposed) return;
        disposed = true; capture?.dispose(); signals.clear();
    }};
}
