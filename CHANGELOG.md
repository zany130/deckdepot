# Changelog

## 2.0.0

- Browse Trending and the main Flathub categories on the Flatpak bar. New Arrivals, Recently Updated, Popular, and the remaining categories, including AI and Finance, are in All Categories
- Merge third-party Flatpak remotes into category browse. The same app from the same remote in user and system scope stays one tile
- Load Flatpark's AI section with Decky's certificate helper. AI is not an AppStream category; membership comes from flatpark.org
- Browse every AppMan database the installed CLI can install, including AM utils, BusyBox, Coreutils, Python, AppBundle, and Soar when those modules are enabled
- Add AppMan categories for Emulators, GNOME, KDE, Metapackages, and Wine, plus an All Categories index. Category browse is paginated and is not limited to the first 40 results
- Keep AppMan install, update, and uninstall flags specific to the database that owns the app
- Show the AppMan Update All result from AppMan's version comparison. Apps that were already current are not reported as updated
- Show the remote error text when a catalog source fails to load

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
