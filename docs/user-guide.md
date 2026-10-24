# Everyday use

[Documentation](README.md) · [Configuration](configuration.md)

Open a few application windows. Trait JustTiling places compatible windows into a layout and reclaims their space when they close. Each workspace has its own layout during the management session.

## Keyboard controls

| Default | Action |
| --- | --- |
| Super+T | Toggle automatic tiling |
| Super+Y | Pin or unpin the active application |
| Super+G | Toggle the active window between tiled and floating |
| Super+F | Cycle focus through tiled windows |
| Super+C | Choose a numbered tile to swap with the active window |
| Super+Left | Swap with the tile on the left |
| Super+Right | Swap with the tile on the right |
| Super+Up | Swap with the tile above |
| Super+Down | Swap with the tile below |

Change any of these in **Preferences → Keyboard shortcuts**. Select an action, press your combination, and save. In the capture dialog, Backspace disables the action, Enter saves, and Escape cancels. The menu remains available when a shortcut is disabled.

Focus cycling goes from top to bottom and left to right, wrapping to the first tiled window. Swapping keeps focus on the window being moved; it does not wrap at the screen edge. A swap requires both windows to fit their destination cells.

The default Super+Arrow swaps temporarily take over the corresponding GNOME bindings while tiling is active. They are restored when management stops. Other conflicting combinations are rejected instead of silently replacing system shortcuts.

New eligible windows that open maximized are unmaximized before entering the grid. Maximizing an already tiled window releases it into temporary floating mode and preserves its maximized size. Restoring that window automatically returns it to the grid, unless its application is set to always float or it no longer fits. The focus border is hidden while a window is maximized and returns when it is restored. Application exceptions, dialogs, fullscreen windows and size constraints still apply.

## Mouse controls

- **Resize a shared edge:** resize the window normally, then release. The neighboring split adjusts after release, respecting window constraints.
- **Swap windows:** drag a tiled window over another tile. A translucent overlay in the GNOME accent color highlights a compatible receiving window. Release to exchange their positions without changing the split sizes. The preview clears when there is no valid target or the drag is canceled.
- **Float a window:** use Super+G. Resizing an outer edge can also release a window from tiling. With the layout palette disabled, dropping outside a valid tile destination retains the original drag-to-float behavior.

During a native drag, neighboring windows wait. The extension does not continuously rearrange the grid under the pointer. Split resizing and drag swapping can be toggled independently in Preferences. The panel menu keeps the temporary tiled/floating action between separators, with application pinning and floating rules in their own group.

## Choose what stays floating

To make an application always float:

1. Focus one of its windows.
2. Open the Trait JustTiling panel menu.
3. Enable **Always float this application**.

The rule applies to windows recognized as belonging to that application. Explicit child windows, native application identity, and supported helper identification can establish the association. Helpers with no unambiguous identity may need a separate exception.

Remove a persistent rule in **Preferences → Always-floating applications**. Super+G is useful for an individual, temporary choice; it cannot force an incompatible window to fit.

Dialogs, special windows, fixed-size windows, and windows that cannot fit the available layout stay floating automatically. An automatic per-window fallback does not add a permanent application rule.

## Keep your main window comfortable

**Prefer splitting other windows** is enabled by default. It favors splitting a window other than the previous focus when equally balanced layouts fit. Pinned regions and learned sizes take priority; focus alone does not reserve an unsaved size.

**New window position** defaults to **Left**. Choose **Right** in Preferences if preferred. For vertically stacked splits, the setting corresponds to above or below. Other viable positions may be used when the preferred split cannot fit.

## Teach the layout your preferences

Manually resize a shared split or swap windows using the mouse or keyboard. Successful changes are learned after the windows settle into their new geometry. Future openings use those preferred positions and sizes when a valid layout allows it.

Learning is enabled by default. It does not train from automatic opening, closing, focus changes, or resolution changes, and it excludes applications with multiple tiled windows. An application alone still fills the available area. Open another compatible application to see how a learned preference influences the split.

Use **Preferences → Layout learning** to pause learning and use of saved profiles, forget one application, or clear them all. Forgetting does not immediately rearrange existing windows.

## Workspaces and monitors

Workspace layouts remain independent while management is active. Moving a window between workspaces updates its source and destination. Exact workspace trees are not restored across sessions; learned application preferences are stored separately.

Connecting a second logical monitor pauses tiling and requests restoration. After returning to one monitor, resume explicitly using the menu or Super+T.

## Swap by number

Press **Super+C** with a tiled window focused. All other tiles on the current workspace receive an accent-colored preview with a number in the center. Type a number to exchange those two windows; focus stays with the original window. **Esc** or the same shortcut again cancels without rearranging anything. The shortcut is configurable in Preferences.

With ten or more destinations, type the digits in sequence. A number that is also a prefix (such as 1 when 10 is visible) waits 650 ms for another digit; Enter confirms immediately. Backspace clears the digits. Keypad digits work too. Invalid numbers do not rearrange windows. Workspace, window or layout changes cancel the selection. Windows must still fit their destination sizes.

Set **Focus border width (px)** in **Preferences → Gaps** to make the focus border thinner or thicker. The range is 1–8 logical pixels, with a 2-pixel default. Changes apply immediately and draw inward without changing window geometry. Use **Highlight the focused window** to turn the border off.

## Rounded window corners

Enable **Round window corners** in Preferences to visually round application windows with the same radius used by the focus border. The option is on by default. Set **Corner radius (px)** in the **Gaps** section: 0–64 logical pixels, initially 8. Changes apply immediately to the focus border and forced rounding without rearranging windows. Zero makes the focus border square and removes the forced rounding effect. GNOME does not expose a universal window-corner-radius preference; this value is manual. It applies to tiled and floating windows, including unfocused windows, independently of automatic tiling and focus highlighting.

Maximized, fullscreen and minimized windows have no rounding effect. Restoring a window reapplies it. Menus, tooltips, notifications and desktop surfaces are excluded. Turning the option off or disabling the extension removes the effect immediately and restores the original rendering. Window geometry and application settings are unchanged. Existing transparency inside the frame is preserved. The original exterior border/shadow is replaced by a soft rounded shadow while the option is enabled. Frames with translucent native margins suppress the additional shadow to avoid a second rectangular halo. Transparency and faint shadows drawn inside the application frame itself remain under application control; native corners that are already more rounded cannot be filled back in by this visual mask.

## Conflicting extensions

If another known window manager is active, Trait JustTiling stays enabled with tiling paused. Its notification starts with the conflicting extension names. The panel menu shows each conflicting extension on a separate row, with its full name and UUID, and offers **Open Extension Manager**. The list remains available if you dismiss the notification. Disable the conflicting tiler there. Trait JustTiling then offers **Resume automatic tiling**; it waits for your choice before managing windows again.

Trait JustTiling never disables another extension automatically. If a conflicting tiler is activated later, tiling pauses again. GNOME Extensions is the preferred manager; Extension Manager is supported when available instead. If neither application is installed, the notification explains what to install. You can reopen the manager from the panel if you dismiss the notification.

## Focus border

The optional focus border highlights the focused application window, including Preferences, dialogs and windows excluded from tiling. It remains available when automatic tiling is switched off or paused. Highlighting a window does not move it, resize it or insert it into the grid.

The border is hidden for maximized and fullscreen windows, minimized or unmapped windows, desktop panels, menus, tooltips, notifications, the overview and the lock screen. Only windows visible on the active workspace are highlighted. Disable the border separately in Preferences if desired.

## Pinned application regions

Arrange a tiled window at the position and size you prefer, then enable **Pin this application's position and size** in the panel menu or press **Super+Y**. A notification confirms pinning or unpinning, including when using a customized shortcut. Other windows use the remaining regions. This explicit preference takes priority over focus preservation and learned layouts, and works with layout learning disabled.

When application minimum sizes prevent an exact reservation, the pinned window yields space temporarily. Closing windows restores its saved region when possible. Automatic adjustments never overwrite the saved preference. Manual split resizing or swapping updates the affected pinned window's saved region after the layout settles.

Pins are stored locally by application, as proportions of the work area, and survive reopening and session restarts. One tiled instance per application reserves space on each workspace; additional instances tile normally. Floating exceptions, manual floating, minimization and maximization take precedence while active, without deleting the saved pin. Rejoining the grid applies it again.

Toggle the menu option or shortcut to unpin, or remove one or all pins in **Preferences → Pinned applications**. The list starts collapsed. **Preferences → Keyboard shortcuts** allows changing the default Super+Y shortcut; occupied shortcuts are reported instead of replacing system bindings. Empty reserved regions are never numbered swap targets.

## Balanced automatic layouts

Opening or closing a tiled window recalculates the unconfigured areas. Without saved preferences, three windows receive approximately one third of the usable area each. If a pinned or learned window occupies half the screen, two other unconfigured windows share the remaining half. Gaps, integer rounding and application size limits can require small differences.

Pinned positions and sizes take precedence over learned preferences. Learned preferences then guide the remaining regions, with a balanced distribution for other windows. When saved regions conflict or minimum sizes require more room, the layout relaxes them without changing the stored profiles. Manual resizing and swaps remain effective; their normal learning rules still apply. Automatic rebalancing never creates or overwrites learned sizes. Layouts on inactive workspaces wait until that workspace is visited.

## Panel icon visibility

Enable **Hide the panel icon** in Preferences to hide the indicator immediately. Tiling and keyboard shortcuts continue working. The choice persists across sessions. Disable the same switch to show the icon again. When the icon is hidden, reopen Preferences through your extension manager or run:

```bash
gnome-extensions prefs justtiling@trait.com.br
```

Automatic layouts favor wider window shapes over narrow, full-height columns. Learned sizes remain preferred when they leave usable shapes for the other applications. If a learned region would squeeze other windows into tall strips, it can yield temporarily so windows can be stacked in wider rows. This never changes the stored learning; it can be restored after windows close. Explicitly pinned regions keep their stronger priority. Application minimum sizes can still require portrait shapes when no wider arrangement fits.

## Dragging into a preset layout

With **Show layout presets when dragging** enabled in Preferences, dragging a tiled window reveals a palette near the top center of the work area. It offers halves, thirds, quarters, a wider center column, and horizontal halves. Move onto one of the small regions to preview the destination in the GNOME accent color, then release to pin that application's position and size there. A sole tiled window also supports this palette.

Only the selected application is pinned. Other windows keep using the normal adaptive grid. The saved pin uses the same local application rules, notifications, menu option, Super+Y shortcut, and Preferences list as ordinary pinning. Repeating the gesture updates that application's saved region. Existing floating exceptions remain excluded.

Regions that cannot accommodate the application's size limits or overlap another application's fixed region are unavailable. Releasing on an unavailable region or an empty part of the palette returns the window to the grid without modifying pins. Esc cancels the native drag. Leaving the palette keeps the usual swap preview. Releasing over a compatible window swaps them; releasing without a valid destination restores the original grid position and size, including for a sole window filling the work area. Pins and learning remain unchanged on cancellation; the palette never captures keyboard or pointer input. The palette can be disabled independently of drag swapping, and works when drag swapping is disabled.

The palette and destination preview disappear when dragging ends, tiling pauses, the overview or lock screen opens, or the extension is disabled. The assistant adjusts only the chosen window's pin when explicitly dropped on a valid region; hovering does not change geometry or stored preferences.
