# Development

[Documentation](README.md) · [Contributing](../CONTRIBUTING.md)

Trait JustTiling is a JavaScript/GJS extension for GNOME Shell 50 and 51, licensed under GPL-3.0-or-later. There are no npm dependencies. The published extension ZIP contains runtime modules, metadata, a license, schemas, and compiled translation catalogs; development tools and tests stay in the source repository.

## Environment

For pure tests and packaging: GJS, Python 3, `make`, and `glib-compile-schemas`. The integration checks additionally require the installed Mutter/Meta and Shell 50 or 51 libraries. Preferences tests require GTK 4, libadwaita, `gtk4-broadwayd`, private Unix socket support, and an installed `pt_BR.UTF-8` locale used by the bilingual test runner.

Package-identity smoke tests use the local installed-package database where available. No check installs dependencies or activates the extension automatically.

## Commands

| Command | Scope |
| --- | --- |
| `make check` | Parse ES modules and validate schemas without loading the extension |
| `make test` | Pure layout/controller tests using simulated windows and clocks |
| `make check-api` | Check installed Meta/Shell/St 50/51 interfaces without starting a compositor |
| `make test-native-chooser` | Installed Nautilus OpenFile/SaveFile versus main Files window with the full extension and native corner effects in headless GNOME, a private D-Bus session and temporary profile; never connects to the desktop session |
| `make test-shell` | Isolated integration with real GLib/Meta and memory settings, replacing Shell UI with doubles; runs in Portuguese and English |
| `make test-preferences` | Real GTK/Adwaita in private Broadway, memory settings, both languages, and the English preview |
| `make test-security` | Reject linked build inputs and forged diagnostic records using temporary sources and mocked session tools |
| `make test-package` | Read-only installed-package query smoke tests |
| `python3 tests/capture-tool-test.py` | Capture-tool cleanup and interruption checks using fakes |
| `make package` | Run syntax/schema and pure tests, then build the installable ZIP |
| `make submission` | Build and validate the exact GNOME submission ZIP and write a SHA-256 file |

The 0.30.2 pure suite has 248 tests. Integration checks complement those tests; they do not replace manual testing in a dedicated GNOME account or VM.

## Architecture

| Area | Files and responsibilities |
| --- | --- |
| Lifecycle | `extension.js` owns initialization, settings, scheduling, and cleanup |
| Window management | `src/controller.js` handles eligibility, workspace trees, bounded geometry confirmation, floating fallback, and restoration |
| Layout | `src/layout/tree.js`, `balance.js`, `resize.js`, and `drag.js` implement pure BSP solving, balanced insertion and reflow, split resizing, and swaps |
| Native integration | `src/shellAdapter.js` bridges Meta/Shell state and signals into plain data |
| Rules and identity | `src/rules.js`, `processInfo.js`, `packageIdentity.js`, and `packageLookup.js` handle exact application rules and optional helper identification |
| Keyboard | `src/keybindings.js` and `shortcutOverrides.js` register actions, handle conflicts, and journal reversible system bindings |
| Layout palette | `src/layout/presets.js` shares geometry and hit tests between `layoutBar.js` and the controller; `SwapPreview` owns their single drag-only pointer timer |
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

## GitHub connection in Codex

The working remote connection for `traitbrasil/justtiling` is the authenticated **GitHub connector in Codex**. It was used to publish 0.30.1 and is the preferred path for subsequent Codex sessions. Authentication in Chrome or the connector does not configure terminal Git. In this environment, terminal HTTPS has no credentials, `gh` is unavailable, and SSH has no trusted GitHub host key. Keep `origin` at `https://github.com/traitbrasil/justtiling.git`; do not export connector credentials or weaken SSH checks.

For an authorized publication to `main`:

1. Review `git status`, the diff, and the required checks. Commit the intended files locally. Read the current remote `refs/heads/main` through the connector's `fetch` tool and confirm it is the expected parent. If the branch moved, reconcile the new changes before publishing.
2. Build a manifest from the committed Git objects, using `git diff-tree` and `git show HEAD:path`, rather than copying uncommitted working files. Include each changed path, Git mode and UTF-8 content; represent deletions with a null SHA. For binary files, use the connector's blob tool with base64 content and reference the resulting blob SHA.
3. Use the connector's `create_tree` tool with the parent's tree as `base_tree_sha`. Confirm the returned tree SHA equals the intended local commit's tree SHA. Then use `create_commit` with that tree, the verified remote parent, and the intended message.
4. Update `main` through `update_ref`, with `expected_sha` set to the parent read in step 1 and `force=false`. If the update fails because the head changed, inspect the branch again before retrying. Re-read the remote ref and Git commit to verify the published SHA, parent and tree.
5. Synchronize local Git with the exact remote commit. The API sets commit identity/timestamps, so its SHA can differ from the original local commit despite identical files. When terminal fetch is unavailable, reconstruct the unsigned commit object from the connector's Git commit response (`tree`, ordered `parents`, `author`, `committer`, `message`). Verify its Git object hash matches the remote SHA **before** writing it with `git hash-object -w -t commit --stdin`. If the response is signed or cannot be reproduced exactly, stop and obtain the object through an authenticated fetch instead.
6. With a clean working tree and matching tree SHA, move local `refs/heads/main` using `git update-ref` with its previous SHA as a guard, then update `refs/remotes/origin/main` to the verified remote SHA. Confirm `git status --short` is empty and `git rev-list --left-right --count main...origin/main` reports `0 0`. Do not reset files or force the remote branch.

The connector's tools can be discovered by searching tool metadata for GitHub `fetch`, `create_tree`, `create_blob`, `create_commit`, and `update_ref`. Do not assume a successful browser login enables `git push`. GitHub Releases and ZIP uploads are separate operations and require their own user request.

## Packaging and release scope

`tools/build.py` stages the runtime in a temporary directory and creates `dist/trait-justtiling-0.30.2.zip`. `tools/check-submission.py` verifies the package against current sources, translation catalogs, metadata, schema, and import boundaries.

Do not package logs, tests, tools, backups, local preferences, or `gschemas.compiled`. For GNOME 45+, ship the schema XML only; GNOME compiles it during installation. The UUID is `justtiling@trait.com.br`; the settings schema remains `org.gnome.shell.extensions.justtiling`. Keep numeric `version` absent in the submission source because GNOME Extensions assigns it; `version-name` is the human-readable release.

For manual installation, use the [installation guide](installation.md). Before a GNOME Extensions submission, review the [official guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html). Neither building nor running the isolated suite installs or publishes the extension.

The optional corner mask uses `Shell.GLSLEffect` on GNOME 50 and `Clutter.ShaderEffect` on GNOME 51, selected from native API capabilities and a configurable shared radius with the focus border. `make test-corners` compiles and renders the shipped GLSL using a private surfaceless Mesa software GLES context (EGL and GLES libraries required). It verifies corner alpha, straight edges, removal of opaque exterior outlines, rounded shadow falloff, translucent native margins (with and without focus highlighting) and synchronized animation opacity, premultiplied alpha and 100%/150%/200% scale. This complements native API introspection, pure geometry tests and lifecycle tests with Shell doubles; real GNOME visual testing is still necessary. The framebuffer-coordinate mapping credits its GPL source in `src/cornerGeometry.js`.

## Testing both supported GNOME versions

Use the same source checkout in separate GNOME 50 and 51 environments. Test tools default to GNOME 51; for GNOME 50, run `TRAIT_TEST_GNOME=50 make check-api test-shell`. GNOME 50 uses Mutter ABI 18; GNOME 51 uses ABI 51. The environment selector only changes test library discovery; installed extension modules use the libraries supplied by Shell.

Run `make test-native-chooser` in each environment to load the full extension in a headless compositor with private settings, D-Bus and display sockets. It verifies that Files tiles, unparented OpenFile/SaveFile selectors stay excluded, and native corner effects attach without shader errors. The GNOME 50 shader must be constructed inside this compositor because `Shell.GLSLEffect` requires an initialized Shell stage. No fallback disables any feature. Run `make test-preferences` for the GTK interface and `make test-corners` for pixel-level shader checks.

## Monitor coordination

`src/monitors.js` coordinates a layout engine for every physical monitor. `src/monitorAdapter.js` scopes window membership, workspace identity and work area while sharing native objects and observers. Transfers hand off record ownership without restoring old monitor coordinates. During native cross-monitor moves the destination waits for release. Temporary zero-monitor topology changes retain manual floating overrides until displays return. Settings, pin profiles and learned application profiles remain shared, with per-monitor layout caches and unique learning across all tiled instances.

For real two-monitor checks, run `TRAIT_TEST_MONITORS=2 make test-native-chooser`; add `TRAIT_TEST_WORKSPACES=all` to cover workspaces on every monitor. The default two-monitor case covers primary-only workspaces. These commands create two private virtual outputs (1280×900 and 1024×768), load the full extension and verify a separate Files grid on each monitor, floating selectors and native corner rendering. Pure tests additionally cover negative origins, portrait work areas, hotplug, transfers, fullscreen isolation, pinning, focus and swaps.

To verify saved monitor placement in the private compositor, run `TRAIT_TEST_MONITORS=2 TRAIT_TEST_PIN_MONITOR=1 make test-native-chooser`. The fixture seeds a local monitor preference and checks that new Files windows join the secondary grid while file selectors remain floating. Add `TRAIT_TEST_WORKSPACES=all` to cover workspaces on all monitors.
