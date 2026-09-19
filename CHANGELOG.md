# Changelog

## 1.0.2

- Open Installed Flatpak details even when Flathub has no matching catalog record
- Fall back to local name, application ID, origin, scope, and installed version
- Show the app's actual Flatpak remote origin instead of assuming Flathub
- Keep Flathub catalog metadata as optional enrichment when a match exists
- Discover/Search remains Flathub-only

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
