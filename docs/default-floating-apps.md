# Default floating applications

[Documentation](README.md) · [Configuration](configuration.md)

The extension ships with these 30 floating application identifiers. Identifiers are exact and preserve namespace and case. The source of truth is the `floating-apps` default in the settings schema.

- `app-id:discord.desktop`
- `gtk-app-id:org.gnome.Calculator`
- `app-id:spotify.desktop`
- `gtk-app-id:com.canonical.Myna.Config`
- `gtk-app-id:org.gnome.Extensions`
- `app-id:org.gnome.Settings.desktop`
- `wm-class:nm-connection-editor`
- `sandbox-id:snap-store_snap-store`
- `wm-class:rambox`
- `app-id:rustdesk.desktop`
- `app-id:openlogi.desktop`
- `gtk-app-id:org.gnome.Resources`
- `wm-class:update-manager`
- `sandbox-id:firmware-updater_firmware-updater-app`
- `wm-class:nvidia-settings`
- `wm-class:gnome-language-selector`
- `gtk-app-id:org.gnome.Characters`
- `gtk-app-id:org.gnome.seahorse.Application`
- `gtk-app-id:org.gnome.font-viewer`
- `gtk-app-id:org.gnome.baobab`
- `gtk-app-id:org.gnome.DiskUtility`
- `gtk-app-id:org.gnome.Logs`
- `gtk-app-id:org.gnome.Sysprof`
- `gtk-app-id:org.gnome.Yelp`
- `sandbox-id:io.github.kolunmi.Bazaar`
- `app-id:org.openrgb.OpenRGB.desktop`
- `wm-class:vlc`
- `sandbox-id:io.github.nokse22.teleprompter`
- `app-id:vicinae.desktop`
- `app-id:overgrive.desktop`

New installations without a custom value receive this list. An explicit list, including an empty one, takes precedence. Remove rules individually in Preferences; resetting the settings key restores this list. New choices made through the panel remain local preferences and do not automatically change package defaults.
