# Everyday use

[Documentation](README.md) · [Configuration](configuration.md)

Open a few application windows. Trait JustTiling places compatible windows into a layout and reclaims their space when they close. Each workspace has its own layout during the management session.

## Keyboard controls

| Default | Action |
| --- | --- |
| Super+T | Toggle automatic tiling |
| Super+F | Toggle the active window between tiled and floating |
| Super+C | Cycle focus through tiled windows |
| Super+Left | Swap with the tile on the left |
| Super+Right | Swap with the tile on the right |
| Super+Up | Swap with the tile above |
| Super+Down | Swap with the tile below |

Change any of these in **Preferences → Keyboard shortcuts**. Select an action, press your combination, and save. In the capture dialog, Backspace disables the action, Enter saves, and Escape cancels. The menu remains available when a shortcut is disabled.

Focus cycling goes from top to bottom and left to right, wrapping to the first tiled window. Swapping keeps focus on the window being moved; it does not wrap at the screen edge. A swap requires both windows to fit their destination cells.

The default Super+Arrow swaps temporarily take over the corresponding GNOME bindings while tiling is active. They are restored when management stops. Other conflicting combinations are rejected instead of silently replacing system shortcuts.

## Mouse controls

- **Resize a shared edge:** resize the window normally, then release. The neighboring split adjusts after release, respecting window constraints.
- **Swap windows:** drag a tiled window and release the pointer over another tile. If both windows fit, they exchange positions without changing the split sizes.
- **Float a window:** use Super+F. Moving outside a valid tile destination or resizing an outer edge can also release a window from tiling.

During a native drag, neighboring windows wait. The extension does not continuously rearrange the grid under the pointer. Split resizing and drag swapping can be toggled independently in the panel menu.

## Choose what stays floating

To make an application always float:

1. Focus one of its windows.
2. Open the Trait JustTiling panel menu.
3. Enable **Always float this application**.

The rule applies to windows recognized as belonging to that application. Explicit child windows, native application identity, and supported helper identification can establish the association. Helpers with no unambiguous identity may need a separate exception.

Remove a persistent rule in **Preferences → Always-floating applications**. Super+F is useful for an individual, temporary choice; it cannot force an incompatible window to fit.

Dialogs, special windows, fixed-size windows, and windows that cannot fit the available layout stay floating automatically. An automatic per-window fallback does not add a permanent application rule.

## Keep your main window comfortable

**Preserve the focused window size** is enabled by default. When you open another window, the layout tries to shrink other windows first. The focused window can still shrink if the available space requires it.

**New window position** defaults to **Left**. Choose **Right** in Preferences if preferred. For vertically stacked splits, the setting corresponds to above or below. Other viable positions may be used when the preferred split cannot fit.

## Teach the layout your preferences

Manually resize a shared split or swap windows using the mouse or keyboard. Successful changes are learned after the windows settle into their new geometry. Future openings use those preferred positions and sizes when a valid layout allows it.

Learning is enabled by default. It does not train from automatic opening, closing, focus changes, or resolution changes, and it excludes applications with multiple tiled windows. An application alone still fills the available area. Open another compatible application to see how a learned preference influences the split.

Use **Preferences → Layout learning** to pause learning and use of saved profiles, forget one application, or clear them all. Forgetting does not immediately rearrange existing windows.

## Workspaces and monitors

Workspace layouts remain independent while management is active. Moving a window between workspaces updates its source and destination. Exact workspace trees are not restored across sessions; learned application preferences are stored separately.

Connecting a second logical monitor pauses tiling and requests restoration. After returning to one monitor, resume explicitly using the menu or Super+T.
