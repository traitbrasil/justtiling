# Configuration and privacy

[Documentation](README.md) · [Everyday use](user-guide.md)

Open Preferences from the panel menu or run:

```bash
gnome-extensions prefs justtiling@trait.com.br
```

Changes are saved automatically. They belong to the current desktop user. The About page shows the installed extension version from its metadata, along with developer and project contacts.

## Defaults

| Preference | Default | Behavior |
| --- | --- | --- |
| Automatic tiling | On | Organizes compatible windows |
| Resize splits on release | On | Adjusts shared splits after a resize |
| Drag-and-drop swaps | On | Exchanges windows when dropped on another tile |
| Hide the panel icon | Off | Hides the indicator immediately; tiling and shortcuts continue working |
| Highlight the focused window | On | Uses the GNOME accent color, independently of tiling |
| Pinned application regions | Empty | Explicit local position and size priorities; removable individually or all at once |
| Focus border width | 2 px | Draws inward; adjustable from 1 to 8, independent of gaps and corner radius |
| Corner radius | 8 px | Shared by the focus border and forced rounding; 0–64, with zero disabling forced rounding |
| Round window corners | Off | Visually rounds tiled and floating applications to match the focus border |
| Prefer splitting other windows | On | Uses the previous focus as an insertion tie-breaker; equal areas and saved preferences take priority |
| New window position | Left | Prefers insertion before the active tile |
| Layout learning | On | Learns successful manual resizing and swaps |
| Gap between windows | 15 | Layout units, adjustable from 0 to 64 |
| Gap at work area edges | 15 | Layout units, adjustable from 0 to 64 |

The gaps reset button restores only the two gaps and preserves the corner radius and focus border width. Shortcut actions have their own reset controls. Resetting those controls does not clear learned application layouts.

Learned applications and always-floating application lists start collapsed to keep Preferences compact. Expand either list to manage its entries; the application count updates automatically. The learning switch and clear-all action remain visible.

## Application exceptions

The extension ships with [30 default floating application identifiers](default-floating-apps.md). A customized list, including an explicitly empty one, takes precedence over those defaults. New rules added through the panel menu remain local preferences; they do not change the source code or defaults for other users.

Rules match application identifiers rather than document titles. Recognized application children can inherit the rule. On Debian/Ubuntu, an optional, read-only installed-package lookup helps identify otherwise unrecognized helper windows. Missing tools or ambiguous matches leave the helper unassociated.

Floating exceptions preserve normal GNOME stacking and focus behavior. The extension does not enable or disable **Always on Top** for them. An explicit Always on Top choice remains under your control.

## Local learning

Learning stores a stable application identifier and preferred normalized position and size. It does not store window titles, browser URLs, document contents, or a screenshot of your workspace.

Turn learning off to pause both recording and application of saved profiles. Existing profiles remain available until you forget an application or clear all learned layouts. The default profile is empty on a new installation.

Window constraints and available space take priority over a learned position. The saved preferences guide new insertions; they are not a complete session restore.

## Language

The menu, Preferences, and notifications follow the session language. Portuguese sessions use Portuguese; other languages fall back to English.

For a standalone English Preferences preview from the source checkout:

```bash
python3 tools/preview-english.py
```

This preview uses default, memory-only settings. Changes are discarded on close. It does not change the Shell language or the installed extension.

`LANGUAGE=en gnome-extensions prefs justtiling@trait.com.br` does not reliably force English: the command requests a window from the GNOME service, which uses the session environment. To test the panel menu in English, use a GNOME session configured in English.

## Data and external links

Preferences are stored in GSettings under `org.gnome.shell.extensions.justtiling`, at `/org/gnome/shell/extensions/justtiling/`. They include shortcuts, application exceptions, learned layouts, and a recovery journal for temporarily replaced system shortcuts.

The extension makes no background network requests and does not use a remote learning service. About links open only when selected. Developer and project links include fixed `utm_source`, `utm_medium`, and `utm_campaign` parameters, with no generated unique visitor identifier. External sites have their own privacy policies.

Debug logging is off by default. Optional captures can contain application identifiers, geometry, process IDs, and executable paths, so review and redact them before sharing. Logs and preference backups are excluded by the repository's `.gitignore`; manually attaching a file still shares its contents.
