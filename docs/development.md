# Development

[Documentation](README.md) · [Contributing](../CONTRIBUTING.md)

Trait JustTiling is a JavaScript/GJS extension for GNOME Shell 51, licensed under GPL-3.0-or-later. There are no npm dependencies. The published extension ZIP contains runtime modules, metadata, a license, schemas, and compiled translation catalogs; development tools and tests stay in the source repository.

## Environment

For pure tests and packaging: GJS, Python 3, `make`, and `glib-compile-schemas`. The integration checks additionally require the installed Mutter/Meta and Shell 51 libraries. Preferences tests require GTK 4, libadwaita, `gtk4-broadwayd`, private Unix socket support, and an installed `pt_BR.UTF-8` locale used by the bilingual test runner.

Package-identity smoke tests use the local installed-package database where available. No check installs dependencies or activates the extension automatically.

## Commands

| Command | Scope |
| --- | --- |
| `make check` | Parse ES modules and validate schemas without loading the extension |
| `make test` | Pure layout/controller tests using simulated windows and clocks |
| `make check-api` | Check installed Meta/Shell/St 51 interfaces without starting a compositor |
| `make test-shell` | Isolated integration with real GLib/Meta and memory settings, replacing Shell UI with doubles; runs in Portuguese and English |
| `make test-preferences` | Real GTK/Adwaita in private Broadway, memory settings, both languages, and the English preview |
| `make test-package` | Read-only installed-package query smoke tests |
| `python3 tests/capture-tool-test.py` | Capture-tool cleanup and interruption checks using fakes |
| `make package` | Run syntax/schema and pure tests, then build the installable ZIP |
| `make submission` | Build and validate the exact GNOME submission ZIP and write a SHA-256 file |

The 0.26.1 pure suite has 196 tests. Integration checks complement those tests; they do not replace manual testing in a dedicated GNOME account or VM.

## Architecture

| Area | Files and responsibilities |
| --- | --- |
| Lifecycle | `extension.js` owns initialization, settings, scheduling, and cleanup |
| Window management | `src/controller.js` handles eligibility, workspace trees, bounded geometry confirmation, floating fallback, and restoration |
| Layout | `src/layout/tree.js`, `balance.js`, `resize.js`, and `drag.js` implement pure BSP solving, balanced insertion and reflow, split resizing, and swaps |
| Native integration | `src/shellAdapter.js` bridges Meta/Shell state and signals into plain data |
| Rules and identity | `src/rules.js`, `processInfo.js`, `packageIdentity.js`, and `packageLookup.js` handle exact application rules and optional helper identification |
| Keyboard | `src/keybindings.js` and `shortcutOverrides.js` register actions, handle conflicts, and journal reversible system bindings |
| Pinning | `src/pinning.js` reserves explicit app regions, uses empty BSP leaves for unoccupied space, and relaxes saved sizes without changing the profiles when constraints require it |
| Learning | `src/learning.js` validates local normalized profiles and scores feasible insertion candidates |
| Shell UI | `src/indicator.js`, `focusBorder.js`, and `swapPreview.js` provide the panel menu and native actor decorations. The swap preview samples the pointer only during a tile drag and shares validation with the final drop |
| Preferences | `prefs.js`, `src/preferences.js`, and `preferencesShortcuts.js` run in a separate GTK process |
| Translation | `src/i18n.js`, `strings.js`, and `po/` provide Gettext messages and catalogs |

The controller and layout remain independent of GNOME UI imports. The Shell entry point must not reach GTK/Gdk/Adw, and Preferences must not reach Meta/Shell/St/Clutter. Objects, signal connections, timers, shortcuts, and subprocess work created during enable must be cleaned up on disable, including partial activation failures.

## Translations

English is the source language. Portuguese translations are in `po/pt_BR.po`; the template is `po/trait-justtiling.pot`. The metadata declares the `trait-justtiling` Gettext domain, initialized by GNOME for both the Shell and Preferences.

When changing visible text, update source markers and catalogs together. Keep `%s` and `%%` placeholders intact. The build checks exact catalog/template coverage, empty translations, and placeholders, and verifies generated MO files with Python's GNUTranslations reader. It generates both `pt_BR` and `pt` catalogs; other languages use English fallback.

To add another language, add its complete `<locale>.po` catalog under `po/` and verify the compiled interface in that locale. The current isolated UI runners explicitly exercise English and Portuguese.

## Packaging and release scope

`tools/build.py` stages the runtime in a temporary directory and creates `dist/trait-justtiling-0.26.1.zip`. `tools/check-submission.py` verifies the package against current sources, translation catalogs, metadata, schema, and import boundaries.

Do not package logs, tests, tools, backups, or local preferences. The UUID is `justtiling@trait.com.br`; the settings schema remains `org.gnome.shell.extensions.justtiling`. Keep numeric `version` absent in the submission source because GNOME Extensions assigns it; `version-name` is the human-readable release.

For manual installation, use the [installation guide](installation.md). Before a GNOME Extensions submission, review the [official guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html). Neither building nor running the isolated suite installs or publishes the extension.

The optional corner mask uses GNOME 51's `Clutter.ShaderEffect` and a configurable shared radius with the focus border. `make test-corners` compiles and renders the shipped GLSL using a private surfaceless Mesa software GLES context (EGL and GLES libraries required). It verifies corner alpha, straight edges, removal of opaque exterior outlines, rounded shadow falloff, translucent native margins (with and without focus highlighting) and synchronized animation opacity, premultiplied alpha and 100%/150%/200% scale. This complements native API introspection, pure geometry tests and lifecycle tests with Shell doubles; real GNOME visual testing is still necessary. The framebuffer-coordinate mapping credits its GPL source in `src/cornerGeometry.js`.
