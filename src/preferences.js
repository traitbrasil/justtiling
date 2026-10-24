// SPDX-License-Identifier: GPL-3.0-or-later
import {_} from './i18n.js';
import {format} from './strings.js';
// Preferences run in a separate GTK process. Never import this module in extension.js.
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import {shortcutPreferences} from './preferencesShortcuts.js';
import {readLearning, writeLearning} from './learning.js';
import {Connections} from './resources.js';

export function buildPreferences(window, settings, metadata = {}) {
    window.title = 'Trait JustTiling';
    const signals = new Connections();
    const bindings = [];
    const controls = {};
    const page = new Adw.PreferencesPage({title: 'Trait JustTiling', icon_name: 'view-grid-symbolic'});
    const behavior = new Adw.PreferencesGroup({title: _("Tiling"),
        description: _("Changes are saved automatically. Tiling supports one monitor.")});
    for (const [key, title] of [
        ['hide-panel-icon', _("Hide the panel icon")],
        ['tiling-enabled', _("Tile windows automatically")],
        ['layout-assistant', _("Show layout presets when dragging")],
        ['resize-splits', _("Resize splits when releasing a window edge")],
        ['drag-swap', _("Swap windows by dragging and dropping")],
        ['focus-border', _("Highlight the focused window")],
        ['round-window-corners', _("Round window corners")],
        ['preserve-focused-window', _("Prefer splitting other windows")],
    ]) {
        const row = new Adw.SwitchRow({title,
            subtitle: key === 'layout-assistant' ? _("Drop on a preset region to pin the application. Dragging outside the bar keeps the usual behavior.") :
                key === 'hide-panel-icon' ? _("Tiling and keyboard shortcuts keep working while the icon is hidden.") :
                key === 'focus-border' ? _("A border using the GNOME accent color.") :
                key === 'round-window-corners' ? _("Applies to tiled and floating windows. Maximized and fullscreen windows keep their original appearance.") :
                key === 'preserve-focused-window' ?
                    _("For equally balanced layouts, prefer splitting another window. Pinned and learned sizes take priority.") : ''});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        bindings.push([row, 'active']);
        controls[key] = row;
        behavior.add(row);
    }
    const sides = ['left', 'right'];
    const sideRow = new Adw.ComboRow({title: _("New window position"),
        subtitle: _("Within the space chosen for the new window. In stacked splits: above or below."),
        model: Gtk.StringList.new([_("Left"), _("Right")])});
    let updatingSide = false;
    const refreshSide = () => {
        updatingSide = true;
        try { sideRow.selected = sides.indexOf(settings.get_string('new-window-side')); }
        finally { updatingSide = false; }
    };
    signals.add(sideRow, 'notify::selected', () => {
        const value = sides[sideRow.selected];
        if (!updatingSide && value) settings.set_string('new-window-side', value);
    });
    signals.add(settings, 'changed::new-window-side', refreshSide);
    refreshSide();
    controls['new-window-side'] = sideRow;
    behavior.add(sideRow);
    page.add(behavior);
    const learning = new Adw.PreferencesGroup({title: _("Layout learning"),
        description: _("Learns from manual split adjustments and window swaps. Saved preferences guide new windows when space allows.")});
    const learningSwitch = new Adw.SwitchRow({title: _("Learn application positions and sizes"),
        subtitle: _("Only when the application has a single tiled window. Turning this off pauses both learning and the use of saved preferences.")});
    settings.bind('learn-layouts', learningSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    bindings.push([learningSwitch, 'active']); controls['learn-layouts'] = learningSwitch;
    learning.add(learningSwitch);
    const forgetAll = new Gtk.Button({label: _("Clear all"), valign: Gtk.Align.CENTER});
    const forgetAllRow = new Adw.ActionRow({title: _("Clear all learned layouts")});
    forgetAllRow.add_suffix(forgetAll); forgetAllRow.activatable_widget = forgetAll;
    learning.add(forgetAllRow);
    const learnedList = new Adw.ExpanderRow({title: _("Learned applications"), expanded: false});
    learning.add(learnedList);
    let learnedRows = [], forgetButtons = [];
    const learnedSignals = new Connections();
    const refreshLearning = () => {
        learnedSignals.clear();
        for (const row of learnedRows) learnedList.remove(row);
        learnedRows = []; forgetButtons = [];
        const apps = readLearning(settings.get_string('learned-layouts'));
        forgetAll.sensitive = Object.keys(apps).length > 0;
        learnedList.subtitle = format(_("Applications: %s"), Object.keys(apps).length);
        for (const [key, frame] of Object.entries(apps).sort(([a], [b]) => a.localeCompare(b))) {
            const percent = value => Math.round(value * 100);
            const row = new Adw.ActionRow({title: key.slice(key.indexOf(':') + 1), use_markup: false,
                subtitle: format(_("Position: %s%%, %s%% · Size: %s%% × %s%%"), percent(frame.x), percent(frame.y), percent(frame.width), percent(frame.height))});
            const button = new Gtk.Button({label: _("Forget"), valign: Gtk.Align.CENTER});
            row.add_suffix(button);
            learnedSignals.add(button, 'clicked', () => {
                const current = readLearning(settings.get_string('learned-layouts'));
                delete current[key];
                settings.set_string('learned-layouts', writeLearning(current));
            });
            learnedList.add_row(row); learnedRows.push(row); forgetButtons.push(button);
        }
        if (!learnedRows.length) {
            const row = new Adw.ActionRow({title: _("No learned applications"),
                subtitle: _("Rearrange windows manually to save your preferences.")});
            learnedList.add_row(row); learnedRows.push(row);
        }
    };
    signals.add(settings, 'changed::learned-layouts', refreshLearning);
    signals.add(forgetAll, 'clicked', () => settings.set_string('learned-layouts', writeLearning({})));
    refreshLearning(); page.add(learning);
    const pinning = new Adw.PreferencesGroup({title: _("Pinned applications"),
        description: _("Pin an application from the panel menu. Its saved region takes priority when space allows, independently of layout learning.")});
    const unpinAll = new Gtk.Button({label: _("Clear all"), valign: Gtk.Align.CENTER});
    const unpinAllRow = new Adw.ActionRow({title: _("Unpin all applications")});
    unpinAllRow.add_suffix(unpinAll); unpinAllRow.activatable_widget = unpinAll;
    pinning.add(unpinAllRow);
    const pinnedList = new Adw.ExpanderRow({title: _("Pinned applications"), expanded: false});
    pinning.add(pinnedList);
    let pinnedRows = [], unpinButtons = [];
    const pinnedSignals = new Connections();
    const refreshPinning = () => {
        pinnedSignals.clear();
        for (const row of pinnedRows) pinnedList.remove(row);
        pinnedRows = []; unpinButtons = [];
        const apps = readLearning(settings.get_string('pinned-layouts'));
        unpinAll.sensitive = Object.keys(apps).length > 0;
        pinnedList.subtitle = format(_("Applications: %s"), Object.keys(apps).length);
        for (const [key, frame] of Object.entries(apps).sort(([a], [b]) => a.localeCompare(b))) {
            const percent = value => Math.round(value * 100);
            const row = new Adw.ActionRow({title: key.slice(key.indexOf(':') + 1), use_markup: false,
                subtitle: format(_("Position: %s%%, %s%% · Size: %s%% × %s%%"), percent(frame.x), percent(frame.y), percent(frame.width), percent(frame.height))});
            const button = new Gtk.Button({label: _("Unpin"), valign: Gtk.Align.CENTER});
            row.add_suffix(button);
            pinnedSignals.add(button, 'clicked', () => {
                const current = readLearning(settings.get_string('pinned-layouts'));
                delete current[key];
                settings.set_string('pinned-layouts', writeLearning(current));
            });
            pinnedList.add_row(row); pinnedRows.push(row); unpinButtons.push(button);
        }
        if (!pinnedRows.length) {
            const row = new Adw.ActionRow({title: _("No pinned applications"),
                subtitle: _("Select a tiled window and enable pinning in the panel menu.")});
            pinnedList.add_row(row); pinnedRows.push(row);
        }
    };
    signals.add(settings, 'changed::pinned-layouts', refreshPinning);
    signals.add(unpinAll, 'clicked', () => settings.set_string('pinned-layouts', writeLearning({})));
    refreshPinning(); page.add(pinning);
    const shortcuts = shortcutPreferences(window, settings);
    page.add(shortcuts.group);
    const gaps = new Adw.PreferencesGroup({title: _("Gaps"),
        description: _("Changes apply immediately to gaps, corners and the focus border.")});
    for (const [key, title] of [['inner-gap', _("Between windows")], ['outer-gap', _("At the work area edges")],
        ['corner-radius', _("Corner radius (px)")],
        ['focus-border-width', _("Focus border width (px)")]]) {
        const row = new Adw.SpinRow({title, digits: 0, numeric: true,
            subtitle: key === 'focus-border-width' ? _("From 1 to 8 px, drawn inside the window.") : key === 'corner-radius' ? _("Used by the focus border and rounded windows. Zero disables forced window rounding.") : '',
            adjustment: new Gtk.Adjustment({lower: key === 'focus-border-width' ? 1 : 0,
                upper: key === 'focus-border-width' ? 8 : 64, step_increment: 1, page_increment: 4})});
        settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        bindings.push([row, 'value']);
        controls[key] = row;
        gaps.add(row);
    }
    const reset = new Gtk.Button({label: _("Reset"), valign: Gtk.Align.CENTER,
        tooltip_text: _("Reset only the two gaps to 15")});
    const resetRow = new Adw.ActionRow({title: _("Reset gaps"), subtitle: _("Restore default values")});
    resetRow.add_suffix(reset); resetRow.activatable_widget = reset;
    signals.add(reset, 'clicked', () => {
        settings.reset('inner-gap'); settings.reset('outer-gap');
    });
    gaps.add(resetRow); page.add(gaps);
    const exceptions = new Adw.PreferencesGroup({title: _("Always-floating applications"),
        description: _("To add an application, select one of its windows and enable “Always float this application” in the panel menu.")});
    const exceptionList = new Adw.ExpanderRow({title: _("Application list"), expanded: false});
    exceptions.add(exceptionList);
    let rows = [];
    let removeButtons = [];
    const rowSignals = new Connections();
    const refresh = () => {
        rowSignals.clear();
        for (const row of rows) exceptionList.remove(row);
        rows = []; removeButtons = [];
        const rules = settings.get_strv('floating-apps');
        exceptionList.subtitle = format(_("Applications: %s"), rules.length);
        for (const rule of rules) {
            const colon = rule.indexOf(':');
            const name = colon >= 0 ? rule.slice(colon + 1) : rule;
            const row = new Adw.ActionRow({use_markup: false});
            row.title = name || rule || _("(empty identifier)");
            row.subtitle = rule;
            const button = new Gtk.Button({icon_name: 'user-trash-symbolic',
                tooltip_text: format(_("Remove exception for %s"), name || rule), valign: Gtk.Align.CENTER});
            row.add_suffix(button);
            rowSignals.add(button, 'clicked', () => {
                // Always read the latest list: preserve changes made from the panel.
                settings.set_strv('floating-apps', settings.get_strv('floating-apps').filter(item => item !== rule));
            });
            exceptionList.add_row(row); rows.push(row); removeButtons.push(button);
        }
        if (!rows.length) {
            const row = new Adw.ActionRow({title: _("No application exceptions"),
                subtitle: _("Automatic per-window exceptions are not shown in this list.")});
            exceptionList.add_row(row); rows.push(row);
        }
    };
    signals.add(settings, 'changed::floating-apps', refresh);
    refresh(); page.add(exceptions);
    let disposed = false;
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        shortcuts.dispose();
        learnedSignals.clear(); pinnedSignals.clear(); rowSignals.clear(); signals.clear();
        for (const [object, property] of bindings) Gio.Settings.unbind(object, property);
    };
    signals.add(window, 'close-request', () => { dispose(); return false; });
    window.add(page);
    const aboutPage = new Adw.PreferencesPage({title: _("About"), icon_name: 'help-about-symbolic'});
    const aboutGroup = new Adw.PreferencesGroup({title: 'Trait JustTiling',
        description: _("Automatic window tiling for GNOME.")});
    const versionRow = new Adw.ActionRow({title: _("Version"),
        subtitle: String(metadata['version-name'] ?? metadata.version ?? '—'), use_markup: false});
    aboutGroup.add(versionRow);
    const developerRow = new Adw.ActionRow({title: 'Dudu Broering', subtitle: _("Developer")});
    const developerLink = new Gtk.LinkButton({label: 'trait.li/dudu', uri: 'https://trait.li/dudu?utm_source=trait_justtiling&utm_medium=extension&utm_campaign=sobre',
        valign: Gtk.Align.CENTER});
    developerRow.add_suffix(developerLink);
    developerRow.activatable_widget = developerLink;
    aboutGroup.add(developerRow);
    const projectRow = new Adw.ActionRow({title: 'Trait Just'});
    const projectLink = new Gtk.LinkButton({label: 'trait.li/just',
        uri: 'https://trait.li/just?utm_source=trait_justtiling&utm_medium=extension&utm_campaign=sobre',
        valign: Gtk.Align.CENTER});
    projectRow.add_suffix(projectLink);
    projectRow.activatable_widget = projectLink;
    aboutGroup.add(projectRow);
    const contactRow = new Adw.ActionRow({title: _("Contact")});
    const contactLink = new Gtk.LinkButton({label: 'just@trait.com.br', uri: 'mailto:just@trait.com.br',
        valign: Gtk.Align.CENTER});
    contactRow.add_suffix(contactLink);
    contactRow.activatable_widget = contactLink;
    aboutGroup.add(contactRow);
    aboutPage.add(aboutGroup);
    window.add(aboutPage);
    return {controls, reset, page, shortcuts, dispose,
        pinning: {unpinAll, expander: pinnedList, get rows() { return pinnedRows; }, get unpinButtons() { return unpinButtons; }},
        learning: {forgetAll, expander: learnedList, get rows() { return learnedRows; }, get forgetButtons() { return forgetButtons; }},
        about: {page: aboutPage, group: aboutGroup, versionRow, developerRow, developerLink, projectRow, projectLink, contactRow, contactLink}, get disposed() { return disposed; },
        exceptionExpander: exceptionList, get exceptionRows() { return rows; }, get removeButtons() { return removeButtons; }};
}
