# DeckDepot

**Linux apps, right from Gaming Mode.**

DeckDepot is a [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin. Browse, install, update, and uninstall Flatpaks from Steam Gaming Mode. [AppMan](https://github.com/ivan-hc/AM) is an optional second provider for portable apps.

**Add to Steam** is optional. Steam, not DeckDepot, launches the app.

## Requirements

- Steam Gaming Mode with Decky Loader
- User-scoped and/or system-scoped Flatpak, with Flathub available for the scopes you use
- AppMan is optional. Install and configure it yourself if you want that provider; DeckDepot does not bundle it

The plugin is unprivileged (`flags: []`). It does not use root or custom polkit rules. System Flatpak install, update, and uninstall go through a verified `systemd-run --user` session bridge when the host already allows that path.

## What it does

- **Flatpak** — search configured remotes, browse Flathub categories with third-party apps merged in, install and manage user and system Flatpaks
- **AppMan** — search and manage AppMan apps when AppMan is installed
- **Installed** — user Flatpaks, AppMan apps, and system Flatpaks, kept as distinct identities. Installed Flatpak details use Flathub metadata when the origin is Flathub, otherwise local AppStream or name, application ID, origin, scope, and version
- **Updates** — Flatpak pending updates by scope, plus AppMan updater actions (AppMan has no pending-update list)
- **Settings** — default Flathub install scope, optional SteamGridDB API key for Add to Steam artwork, and AppMan search scope

Open it from Decky’s Quick Access menu (**Open DeckDepot**). On some Steam Gaming Mode builds, DeckDepot also appears in Steam’s main menu. That menu row is unofficial and may disappear after a Steam UI update; the QAM button is the supported way in.

## What it does not do

- It does not launch apps from the plugin
- It does not switch Gaming/Desktop sessions
- It does not remove your apps if you uninstall the plugin (only plugin settings/runtime files)

## Install

From a release zip, in Gaming Mode: Decky → Developer → **Install Plugin from ZIP**.

Reload the plugin from Decky’s plugin list after installing or updating.

## Optional SteamGridDB artwork

Add to Steam works without an API key. To fill library artwork automatically, add a SteamGridDB API key in Settings. DeckDepot uses the first matching game and the first image in each supported slot. For browsing or picking art by hand, use the dedicated SteamGridDB plugin.

## Build from source

Requires Node.js and pnpm:

```bash
pnpm i
pnpm run build
pnpm run package
```

The zip is written to `out/DeckDepot.zip`.

## Logs

Plugin Loader:

```bash
journalctl -u plugin_loader.service -f
```

Plugin logs (dated files under this directory):

```text
~/homebrew/logs/DeckDepot/
```

## Acknowledgements

DeckDepot was inspired in part by existing Decky plugins:

- [AutoFlatpaks](https://github.com/jurassicplayer/decky-autoflatpaks) by jurassicplayer — Flatpak management from Gaming Mode
- [SteamGridDB Decky Plugin](https://github.com/SteamGridDB/decky-steamgriddb) — non-Steam shortcuts and artwork patterns

DeckDepot is an independent project. Those plugins are references, not source trees it was copied from.

## License

BSD-3-Clause. This project starts from the official [Decky plugin template](https://github.com/SteamDeckHomebrew/decky-plugin-template).
