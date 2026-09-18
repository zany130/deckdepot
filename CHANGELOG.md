# Changelog

## 1.0.1

- Manage system-scoped Flatpaks through the verified user-systemd session bridge
- Restore AppMan detail-page descriptions from catalog/search metadata
- Stop AppMan installs hanging on curl progress output
- Show shared operation progress and one success or failure toast per action
- Fix Settings dropdown sizing
- Add installed AppMan apps to Steam with the existing shortcut and SteamGridDB artwork path

## 1.0.0

First public release.

- Browse, install, update, and uninstall user-scoped Flatpaks from Steam Gaming Mode
- Optional AppMan provider for portable apps
- Installed, Updates, and Settings pages
- Optional Add to Steam, with optional SteamGridDB artwork
- Unprivileged plugin (`flags: []`); system Flatpaks are visible and read-only
- No in-plugin Launch; Steam launches library shortcuts
- QAM action is **Open DeckDepot**; optional unofficial Steam main-menu entry where GamepadUI allows it
