# Installation and updates

[Documentation](README.md) · [Everyday use](user-guide.md)

## Requirements

- GNOME Shell **50 or 51** with **one logical monitor**.
- For a source build: `git`, `make`, `gjs`, `python3`, and `glib-compile-schemas`.
- Run installation commands as your desktop user, without `sudo`.

Check your Shell version with `gnome-shell --version`. Other GNOME versions and multiple-monitor tiling are outside the current support scope.

Version 0.28.0 is being prepared for its first GNOME Extensions submission. There is no approved store listing linked from this repository yet. While the repository is private, cloning requires authorized GitHub access.

## Build and install

```bash
git clone https://github.com/traitbrasil/justtiling.git
cd justtiling
make package
gnome-extensions install --force dist/trait-justtiling-0.28.0.zip
```

`make package` checks syntax and schemas, runs the pure tests, compiles translations, and creates the ZIP. It does not install or enable the extension.

**Log out and log back in.** Then:

```bash
gnome-extensions enable justtiling@trait.com.br
gnome-extensions info justtiling@trait.com.br
gnome-extensions prefs justtiling@trait.com.br
```

Open two compatible application windows to try tiling. The panel menu provides the main controls.

## Update an existing installation

From your checkout:

```bash
git pull --ff-only
make package
gnome-extensions disable justtiling@trait.com.br
gnome-extensions install --force dist/trait-justtiling-0.28.0.zip
```

Log out and back in, then run:

```bash
gnome-extensions enable justtiling@trait.com.br
```

Installing an update with the same schema keeps existing preferences, application exceptions, and learned layouts. Disable/enable alone does not reliably replace JavaScript already loaded in the Shell process.

For an optional backup before updating:

```bash
dconf dump /org/gnome/shell/extensions/justtiling/ > "$HOME/trait-justtiling-preferencias.ini"
```

Keep that export private. It may contain application preferences and learned layouts.

## Migrating from a previous UUID

Disable `just@trait.com.br` before installing the new UUID:

```bash
gnome-extensions disable just@trait.com.br
gnome-extensions install --force dist/trait-justtiling-0.28.0.zip
```

Log out and back in, then enable the new extension:

```bash
gnome-extensions enable justtiling@trait.com.br
```

The settings schema and storage path remain unchanged. Shortcuts, floating application rules, learned layouts and all other preferences are shared with the previous UUID; no export, import or reset is needed. Keep the old extension disabled. The new extension refuses to start if a previous UUID is still active.

If `justtiling@dudu.local` is installed, disable it as well. The public contact email remains `just@trait.com.br`; it is independent of the extension UUID.

## Disable or uninstall

Pause tiling with **Super+T**, or disable the extension completely:

```bash
gnome-extensions disable justtiling@trait.com.br
```

To uninstall:

```bash
gnome-extensions uninstall justtiling@trait.com.br
```

These commands are not a request to reset your preferences. See [Troubleshooting](troubleshooting.md) if system shortcuts need recovery after an interrupted session.
