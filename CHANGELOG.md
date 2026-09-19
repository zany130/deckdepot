# Changelog

## 1.1.0

- Discover, search, and install from already-configured enumeratable Flatpak remotes, not only Flathub
- Keep one card per remote and branch, with source labels when more than Flathub is visible
- Install the selected remote and ref; Settings Automatic/User/System still only chooses the default Flathub scope
- Merge third-party AppStream categories into the existing tabs, and skip `no-enumerate` remotes in Discover
- Fall back to local AppStream details and data-URL icons when Flathub metadata is not the source
- Hide apps the host's system Flatpak policy filters from Discover and Search, including User-scope copies of the same source; Installed management is unchanged
- Add Settings Content Filters for free software, Flathub-only results, Flathub verification, end-of-life apps, and distro policy, applied only to Flatpak Browse/Search

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
