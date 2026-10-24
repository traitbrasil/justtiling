# Troubleshooting

[Documentation](README.md) · [Installation](installation.md)

## “Extension does not exist” after installation

For a manually installed ZIP, log out and log back in before enabling it. Then check the public UUID:

```bash
gnome-extensions info just@trait.com.br
```

Run commands in the desktop account where you installed it, without `sudo`. The old development UUID, `justtiling@dudu.local`, is a separate package.

## New code does not appear after updating

Disabling and enabling the extension does not reliably unload imported JavaScript. Install the new ZIP, end the session, sign in again, and enable it. Check the visible version with `gnome-extensions info just@trait.com.br`.

## Windows are not being tiled

Check that automatic tiling is on, the session is GNOME Shell 51, and only one logical monitor is connected. If tiling paused after a second monitor was connected, return to one monitor and resume explicitly.

Confirm that the application is not in **Always-floating applications**. Dialogs and special windows are excluded automatically. Fixed-size windows and windows that cannot fit are also left floating. Super+F cannot override those constraints.

Other window managers may conflict. The extension checks for known conflicts and may refuse activation or pause management when one becomes active.

## A helper window does not inherit its application's exception

The extension needs an unambiguous link to the application. Some helpers omit native identity and parent-window information. The installed-package fallback is optional and requires a usable `dpkg-query` association with exactly one visible application. If that cannot be established, add a separate application exception for the helper when available.

## No layout has been learned yet

Confirm **Learn application positions and sizes** is enabled. Use two different applications with one tiled window each, resize a shared split or swap their positions, release the mouse, and let the geometry settle. Check **Layout learning** in Preferences.

Simply opening windows does not train the model. Duplicate tiled windows from the same application, canceled swaps, failed resizes, or changing layout constraints can prevent a profile from being saved. Learned preferences influence new insertions; forgetting one does not immediately change the current grid.

## A shortcut is unavailable

Choose another combination in Preferences. Most system conflicts are rejected. Only the default directional swap combinations have the special behavior that temporarily reserves the corresponding Super+Arrow system shortcuts.

If a crash interrupted restoration, disable the extension first. From the source checkout, run the recovery tool as the affected desktop user:

```bash
gnome-extensions disable just@trait.com.br
python3 tools/restore-shortcuts.py
```

This tool restores entries recorded in the extension's recovery journal and preserves later user edits. It does not reset all GNOME shortcuts.

## Preferences remain in Portuguese

They follow the GNOME service's session language. Use the [standalone English preview](configuration.md#language) to inspect English strings, or sign into an English session to test the complete interface.

## Report a problem

Open an [issue](https://github.com/traitbrasil/justtiling/issues) with the extension version, GNOME version, display setup/scaling, application, steps to reproduce, and expected/actual behavior.

Share only relevant, redacted logs. Do not upload an entire session journal, preference export, or private screenshot by default. See [Contributing](../CONTRIBUTING.md).
