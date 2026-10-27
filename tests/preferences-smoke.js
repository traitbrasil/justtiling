// SPDX-License-Identifier: GPL-3.0-or-later
// Real GTK/Adwaita in private Broadway, with memory-only GSettings.
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib';
import {buildPreferences} from '../src/preferences.js';

const {default: Gettext} = await import('gettext');
Gettext.bindtextdomain('trait-justtiling', GLib.getenv('TRAIT_TEST_LOCALEDIR'));
Adw.init();
function assert(value, message) { if (!value) throw new Error(message); }
function flush() {
    const context = GLib.MainContext.default();
    for (let n = 0; n < 200 && context.pending(); n++) context.iteration(false);
}
const settings = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.justtiling'});
const window = new Adw.PreferencesWindow();
const ui = buildPreferences(window, settings, {'version-name': '9.8.7', version: 99});
const english = GLib.getenv('LANGUAGE') === 'en';
assert(ui.about.versionRow.title === (english ? 'Version' : 'Versão') && ui.about.versionRow.subtitle === '9.8.7',
    'About must display the metadata version-name rather than the store revision');
assert(ui.controls['tiling-enabled'].title === (english ? 'Tile windows automatically' : 'Organizar janelas automaticamente'), 'Session language applies to preferences');
assert(window.title === 'Trait JustTiling' && ui.page.title === 'Trait JustTiling', 'Updated extension branding');
assert(ui.about.page.title === (english ? 'About' : 'Sobre') && ui.about.developerRow.title === 'Dudu Broering', 'About page credits');
assert(ui.about.developerLink.uri === 'https://trait.li/dudu?utm_source=trait_justtiling&utm_medium=extension&utm_campaign=sobre',
    'Developer contact link with UTMs');
assert(ui.about.developerLink.label === 'trait.li/dudu', 'Visible developer contact label');
assert(ui.about.projectRow.title === 'Trait Just' && ui.about.projectLink.label === 'trait.li/just' &&
    ui.about.projectLink.uri === 'https://trait.li/just?utm_source=trait_justtiling&utm_medium=extension&utm_campaign=sobre',
    'Trait Just project link with matching campaign parameters');
assert(ui.about.contactLink.label === 'just@trait.com.br' &&
    ui.about.contactLink.uri === 'mailto:just@trait.com.br', 'Public contact email');
assert(ui.controls['learn-layouts'].active && !ui.learning.forgetAll.sensitive,
    'Learning defaults on with an empty list');
assert(!ui.learning.expander.expanded && !ui.exceptionExpander.expanded,
    'Long application lists must start collapsed');
assert(ui.learning.expander.title === (english ? 'Learned applications' : 'Aplicativos com aprendizado') &&
    ui.exceptionExpander.title === (english ? 'Application list' : 'Lista de aplicativos'),
    'Collapsible list titles must follow the session language');
assert(!ui.pinning.expander.expanded && !ui.pinning.unpinAll.sensitive,
    'Pinned applications start empty and collapsed');
assert(ui.pinning.expander.title === (english ? 'Pinned applications' : 'Aplicativos fixados'),
    'Pinned application list must be translated');
const pinSamples = {'app-id:Example.desktop': {x: 0, y: 0, width: 0.5, height: 1},
    'wm-class:<b>Literal</b>': {x: 0.5, y: 0, width: 0.5, height: 1}};
settings.set_string('pinned-layouts', JSON.stringify({version: 1, apps: pinSamples}));
assert(ui.pinning.unpinButtons.length === 2 && ui.pinning.unpinAll.sensitive && !ui.pinning.expander.expanded,
    'Saved pins refresh without expanding the list');
assert(ui.pinning.rows[1].title === '<b>Literal</b>' && !ui.pinning.rows[1].use_markup,
    'Application identities must be displayed literally');
ui.pinning.unpinButtons[0].emit('clicked');
assert(Object.keys(JSON.parse(settings.get_string('pinned-layouts')).apps).length === 1,
    'Unpinning one application preserves the other');
ui.pinning.unpinAll.emit('clicked');
assert(!ui.pinning.unpinAll.sensitive && ui.pinning.unpinButtons.length === 0,
    'Unpin all clears stored application regions');
assert(settings.get_strv('toggle-pin')[0] === '<Super>y' && ui.shortcuts.rows['toggle-pin'],
    'Pin shortcut defaults to Super+Y and has a configurable preferences row');
const learned = {'app-id:Example.desktop': {x: 0, y: 0, width: 0.5, height: 1},
    'wm-class:<b>Other</b>': {x: 0.5, y: 0, width: 0.5, height: 1}};
settings.set_string('learned-layouts', JSON.stringify({version: 1, apps: learned}));
assert(ui.learning.forgetButtons.length === 2 && ui.learning.forgetAll.sensitive, 'Learned apps must refresh live');
assert(!ui.learning.expander.expanded &&
    ui.learning.expander.subtitle === (english ? 'Applications: 2' : 'Aplicativos: 2'),
    'New learning must update the count without expanding the list');
ui.learning.expander.expanded = true;

assert(ui.learning.rows[1].title === '<b>Other</b>' && !ui.learning.rows[1].use_markup, 'Learned identifiers are literal');
ui.learning.forgetButtons[0].emit('clicked');
assert(Object.keys(JSON.parse(settings.get_string('learned-layouts')).apps).length === 1, 'Forget one keeps other app');
assert(ui.learning.expander.expanded && ui.learning.expander.subtitle.endsWith('1'),
    'Forgetting one profile must preserve expansion and update the count');
ui.learning.forgetAll.emit('clicked');
assert(Object.keys(JSON.parse(settings.get_string('learned-layouts')).apps).length === 0 &&
    !ui.learning.forgetAll.sensitive, 'Forget all clears local learning');
settings.set_string('learned-layouts', 'invalid');
assert(ui.learning.forgetButtons.length === 0, 'Malformed learned data cannot break preferences');
settings.reset('learned-layouts');
const defaults = settings.get_strv('floating-apps');
assert(settings.get_user_value('floating-apps') === null && defaults.length === 30,
    'Fresh profile must load all 30 packaged app exceptions without writing user values');
assert(defaults.includes('app-id:discord.desktop') && defaults.includes('app-id:org.gnome.Settings.desktop') &&
    defaults.includes('sandbox-id:io.github.kolunmi.Bazaar') &&
    defaults.includes('app-id:overgrive.desktop'), 'Current application rules and new overGrive default must be preserved');
assert(ui.removeButtons.length === 30, 'Packaged exceptions must be editable in Preferences');
assert(!ui.exceptionExpander.expanded && ui.exceptionExpander.subtitle.endsWith('30'),
    'Default exceptions must remain collapsed with a live count');
ui.exceptionExpander.expanded = true;
ui.removeButtons[0].emit('clicked');
assert(!settings.get_strv('floating-apps').includes(defaults[0]) && settings.get_strv('floating-apps').length === 29,
    'A packaged default must remain individually removable');
assert(ui.exceptionExpander.expanded && ui.exceptionExpander.subtitle.endsWith('29'),
    'Removing a rule must preserve expansion and update the count');
settings.set_strv('floating-apps', []);
assert(settings.get_strv('floating-apps').length === 0, 'Explicit empty list must override defaults');
settings.set_strv('floating-apps', ['wm-class:CustomOnly']);
assert(settings.get_strv('floating-apps').length === 1 && ui.removeButtons.length === 1,
    'Custom lists must not be silently merged with defaults');
settings.reset('floating-apps');
assert(settings.get_strv('floating-apps').length === 30, 'Reset must restore packaged defaults');

assert(ui.controls['inner-gap'].value === 15 && ui.controls['outer-gap'].value === 15, 'Initial gaps');
ui.controls['inner-gap'].value = 12;
assert(settings.get_int('inner-gap') === 12, 'Spin must save integer to own settings');
settings.set_int('outer-gap', 24);
assert(ui.controls['outer-gap'].value === 24, 'External gap change must update widget');
ui.controls['inner-gap'].value = 999;
assert(settings.get_int('inner-gap') === 64, 'Spin upper bound');
ui.controls['outer-gap'].value = -20;
assert(settings.get_int('outer-gap') === 0, 'Spin lower bound');
assert(ui.controls['new-window-side'].selected === 0, 'Insertion side must default to left');
ui.controls['new-window-side'].selected = 1;
assert(settings.get_string('new-window-side') === 'right', 'Combo must save right insertion');
settings.set_string('new-window-side', 'left');
assert(ui.controls['new-window-side'].selected === 0, 'External insertion side must update combo');
assert(ui.controls['preserve-focused-window'].active, 'Focus size preservation must default on');
assert(ui.controls['layout-assistant'].active, 'Layout presets must be enabled by default and optional');
assert(ui.controls['layout-assistant'].title === (english ? 'Show layout presets when dragging' : 'Mostrar layouts ao arrastar'),
    'Layout assistant option must be translated');
assert(ui.controls['float-browser-popups'].active, 'Browser popup detection must default on');
assert(ui.controls['float-browser-popups'].title === (english ? 'Float browser pop-ups' : 'Deixar pop-ups dos navegadores flutuantes'), 'Browser popup preference must be translated');
ui.controls['float-browser-popups'].active = false;
assert(!settings.get_boolean('float-browser-popups'), 'Popup switch must save its disabled value');
settings.set_boolean('float-browser-popups', true);
assert(ui.controls['float-browser-popups'].active, 'Popup switch must track external settings');
assert(!ui.controls['hide-panel-icon'].active, 'The panel icon must remain visible by default');
assert(ui.controls['hide-panel-icon'].title === (english ? 'Hide the panel icon' : 'Ocultar ícone do painel'),
    'Panel icon preference must follow the session language');
assert(ui.controls['focus-border'].active, 'Focus border must default on');
assert(ui.controls['focus-border-width'].value === 2, 'Border thickness must default to two pixels');
assert(ui.controls['focus-border-width'].title === (english ? 'Focus border width (px)' : 'Espessura da borda de foco (px)'),
    'Border thickness field must be translated');
ui.controls['focus-border-width'].value = 7;
assert(settings.get_int('focus-border-width') === 7, 'Thickness edits must persist');
settings.set_int('focus-border-width', 2);
assert(ui.controls['focus-border-width'].value === 2, 'External thickness edits must update the control');
ui.controls['focus-border-width'].value = 100;
assert(settings.get_int('focus-border-width') === 8, 'Thickness upper bound must be enforced');
ui.controls['focus-border-width'].value = 0;
assert(settings.get_int('focus-border-width') === 1, 'Thickness lower bound must be enforced');
settings.reset('focus-border-width');
assert(ui.controls['corner-radius'].value === 8, 'Corner radius must preserve the previous eight-pixel default');
assert(ui.controls['corner-radius'].title === (english ? 'Corner radius (px)' : 'Arredondamento dos cantos (px)'),
    'Corner radius field must be translated');
ui.controls['corner-radius'].value = 16;
assert(settings.get_int('corner-radius') === 16, 'Editing corner radius must persist');
settings.set_int('corner-radius', 24);
assert(ui.controls['corner-radius'].value === 24, 'External radius change must update Preferences');
ui.controls['corner-radius'].value = 999;
assert(settings.get_int('corner-radius') === 64, 'Radius upper bound must be enforced');
ui.controls['corner-radius'].value = -1;
assert(settings.get_int('corner-radius') === 0, 'Square corners must be allowed');
settings.reset('corner-radius');

assert(ui.controls['round-window-corners'].active, 'Rounded corners must default on');
assert(ui.controls['round-window-corners'].title === (english ? 'Round window corners' : 'Arredondar cantos das janelas'),
    'Rounded corner setting must be translated');
for (const key of ['layout-assistant', 'hide-panel-icon', 'tiling-enabled', 'resize-splits', 'drag-swap', 'focus-border', 'round-window-corners', 'preserve-focused-window', 'learn-layouts']) {
    ui.controls[key].active = false;
    assert(!settings.get_boolean(key), `${key} was not saved`);
    settings.set_boolean(key, true);
    assert(ui.controls[key].active, `${key} external change was lost`);
}
settings.set_strv('floating-apps', ['wm-class:Editor', 'gtk-app-id:org.test.App']);
assert(ui.removeButtons.length === 2, 'External app rules must refresh list');
assert(ui.exceptionRows[0].title === 'Editor', 'Display app identifier');
ui.removeButtons[0].emit('clicked');
assert(JSON.stringify(settings.get_strv('floating-apps')) === JSON.stringify(['gtk-app-id:org.test.App']),
    'Remove must preserve other rules');
settings.set_strv('floating-apps', ['wm-class:<b>&App</b>', 'legacy-value']);
assert(ui.exceptionRows[0].title === '<b>&App</b>' && !ui.exceptionRows[0].use_markup, 'Untrusted IDs must be literal');
assert(ui.exceptionRows[1].title === 'legacy-value', 'Unknown rules remain removable');
ui.removeButtons[0].emit('clicked'); ui.removeButtons[0].emit('clicked');
assert(ui.removeButtons.length === 0 && ui.exceptionRows.length === 1, 'Empty list placeholder');
settings.set_strv('floating-apps', ['wm-class:Keep']);
settings.set_strv('toggle-tiling', ['<Super>g']);
settings.set_int('corner-radius', 12);
settings.set_int('focus-border-width', 7);
ui.reset.emit('clicked');
assert(settings.get_int('focus-border-width') === 7, 'Reset gaps must preserve border thickness');
assert(settings.get_int('corner-radius') === 12, 'Reset gaps must preserve the chosen corner radius');
assert(settings.get_int('inner-gap') === 15 && settings.get_int('outer-gap') === 15, 'Reset only gaps');
assert(settings.get_strv('floating-apps')[0] === 'wm-class:Keep' &&
    settings.get_strv('toggle-tiling')[0] === '<Super>g', 'Reset touched other preferences');
// Exercise the real key controller signal path and buttons; no physical key injection.
window.present(); flush();
const shortcuts = ui.shortcuts;
for (const key of ['swap-select', 'cycle-focus', 'swap-left', 'swap-right', 'swap-up', 'swap-down'])
    assert(shortcuts.rows[key] && shortcuts.editButtons[key] && shortcuts.resetButtons[key], 'Missing directional shortcut editor');
assert(settings.get_strv('cycle-focus')[0] === '<Super>f', 'Focus shortcut defaults to Super+F');
assert(settings.get_strv('swap-select')[0] === '<Super>c', 'Number selection defaults to Super+C');
shortcuts.editButtons['cycle-focus'].emit('clicked'); flush();
let focusCapture = shortcuts.capture;
focusCapture.controller.emit('key-pressed', Gdk.KEY_c, 0, Gdk.ModifierType.SUPER_MASK | Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.ALT_MASK);
assert(focusCapture.save.sensitive, 'Focus shortcut should accept custom accelerator');
focusCapture.save.emit('clicked'); flush();
assert(settings.get_strv('cycle-focus')[0] === '<Control><Alt><Super>c', 'Focus shortcut saves custom accelerator');
shortcuts.resetButtons['cycle-focus'].emit('clicked'); flush();
assert(settings.get_strv('cycle-focus')[0] === '<Super>f', 'Focus shortcut reset');
const superMask = Gdk.ModifierType.SUPER_MASK;
const press = (capture, key, mods = 0) => capture.controller.emit('key-pressed', key, 0, mods);
shortcuts.editButtons['swap-left'].emit('clicked'); flush();
let arrowCapture = shortcuts.capture;
arrowCapture.controller.emit('key-pressed', Gdk.KEY_Left, 0, superMask);
assert(arrowCapture.save.sensitive, 'Authorized Super+Left must be configurable despite native arrow bindings');
arrowCapture.save.emit('clicked'); flush();
assert(settings.get_strv('swap-left')[0] === '<Super>Left', 'Arrow capture did not save');
settings.set_strv('toggle-tiling', ['<Super>g', '<Super>h']);
assert(shortcuts.rows['toggle-tiling'].subtitle.includes(english ? ' or ' : ' ou '), 'Existing multiple bindings must remain visible');
shortcuts.editButtons['toggle-tiling'].emit('clicked'); flush();
let capture = shortcuts.capture;
assert(capture && !capture.save.sensitive, 'Capture starts without a candidate');
assert(capture.controller.emit('key-pressed', Gdk.KEY_Tab, 0, 0) === false, 'Tab must remain available for dialog navigation');
press(capture, Gdk.KEY_g);
assert(!capture.save.sensitive, 'Plain letters cannot become global shortcuts');
press(capture, Gdk.KEY_q, superMask | Gdk.ModifierType.LOCK_MASK);
assert(capture.save.sensitive, 'Super+letter should be valid even with Caps Lock');
press(capture, Gdk.KEY_Escape); flush();
assert(!shortcuts.capture && settings.get_strv('toggle-tiling').length === 2, 'Cancel must preserve all custom bindings');
shortcuts.editButtons['toggle-tiling'].emit('clicked'); flush(); capture = shortcuts.capture;
press(capture, Gdk.KEY_q, superMask); press(capture, Gdk.KEY_Return); flush();
assert(settings.get_strv('toggle-tiling')[0] === '<Super>q' && settings.get_strv('toggle-tiling').length === 1,
    'Enter should commit exactly the selected shortcut');
shortcuts.editButtons['toggle-floating'].emit('clicked'); flush(); capture = shortcuts.capture;
const rotationSettings = new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.media-keys'});
const rotationBefore = rotationSettings.get_strv('rotate-video-lock-static');
press(capture, Gdk.KEY_o, superMask);
assert(!capture.save.sensitive && capture.status.label.includes('GNOME'),
    'GNOME media shortcut Super+O must be identified as occupied in preferences');
assert(JSON.stringify(rotationSettings.get_strv('rotate-video-lock-static')) === JSON.stringify(rotationBefore),
    'Shortcut editor must never change GNOME rotation lock settings');
press(capture, Gdk.KEY_q, superMask);
assert(!capture.save.sensitive && capture.status.label.includes(english ? 'Already used' : 'Já usado'), 'Duplicate own actions must be rejected');
// A GNOME shortcut changes while the capture dialog remains open.
const system = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.keybindings'});
system.set_strv('maximize', ['<Super>z']);
press(capture, Gdk.KEY_z, superMask);
assert(!capture.save.sensitive && capture.status.label.includes('GNOME'), 'Known system conflicts must be rejected');
assert(system.get_strv('maximize')[0] === '<Super>z', 'Editor modified a system binding');
system.reset('maximize');
assert(capture.save.sensitive, 'Conflict removal must update capture without reopening');
capture.save.emit('clicked'); flush();
assert(settings.get_strv('toggle-floating')[0] === '<Super>z', 'Replacement was not saved');
shortcuts.editButtons['toggle-floating'].emit('clicked'); flush(); capture = shortcuts.capture;
press(capture, Gdk.KEY_BackSpace); capture.save.emit('clicked'); flush();
assert(settings.get_strv('toggle-floating').length === 0 &&
    shortcuts.rows['toggle-floating'].subtitle === (english ? 'Disabled' : 'Desativado'), 'Backspace must disable only the chosen action');
shortcuts.resetButtons['toggle-floating'].emit('clicked');
assert(settings.get_strv('toggle-floating')[0] === '<Super>g', 'Per-action reset must restore its schema default');
assert(settings.get_strv('toggle-tiling')[0] === '<Super>q', 'Per-action reset modified another action');
settings.set_strv('toggle-tiling', ['<Super>x']);
assert(shortcuts.rows['toggle-tiling'].subtitle.toLowerCase().includes('x'), 'External shortcut edit must refresh row');
shortcuts.editButtons['toggle-tiling'].emit('clicked'); flush();
assert(shortcuts.capture, 'Final capture should be open for parent-close cleanup');
window.present(); flush(); window.close(); flush();
assert(!shortcuts.capture, 'Parent close must release active capture');
assert(ui.disposed, 'Closing preferences must detach settings observers');
const oldShortcut = shortcuts.rows['toggle-tiling'].subtitle;
settings.set_strv('toggle-tiling', ['<Super>j']); flush();
assert(shortcuts.rows['toggle-tiling'].subtitle === oldShortcut, 'Shortcut settings observer survived close');
const oldValue = ui.controls['inner-gap'].value;
settings.set_int('inner-gap', 18); flush();
assert(ui.controls['inner-gap'].value === oldValue, 'Settings binding survived close');
ui.dispose();
for (let n = 0; n < 10; n++) {
    const next = new Adw.PreferencesWindow();
    const form = buildPreferences(next, settings, {version: 42});
    assert(form.about.versionRow.subtitle === '42', 'Numeric metadata version fallback');
    assert(!form.learning.expander.expanded && !form.exceptionExpander.expanded,
        'Reopening Preferences must collapse both lists again');
    assert(form.controls['inner-gap'].value === 18, 'Reopen did not load saved settings');
    form.dispose(); next.destroy();
}
print('Preferences smoke OK: real GTK/Adwaita controls, bounds, bidirectional settings, live exceptions, literal IDs, scoped reset, shortcut capture/cancel/save/disable/conflicts and cleanup. Private Broadway, memory settings, no session Shell.');
