# P0.5 Flatpak list/install contract (2026-09-16)

Host capture: `~/homebrew/data/DeckDepot/p0-flatpak-host.json`  
Decky capture (after plugin reload): `~/homebrew/data/DeckDepot/p0-flatpak-list.json`

## List command

```text
flatpak list --user --app --columns=application,name,version,branch,arch,origin,active
```

Observed on Flatpak 1.18.2, Bazzite 44.20260915.0:

- Exit code 0, empty stderr
- No header row
- Fields separated by **tab** (`\t`), not spaces
- Names may contain spaces and apostrophes (`Rosalie's Mupen GUI`)
- `active` is the **active commit** (12 hex characters in this sample), not a boolean
- `flatpak list --columns=help` documents `active` as "Show the active commit"
- No empty columns in the current 13 user apps; parser must still preserve empty fields via tab split
- `LC_ALL=C` did not change the list table

Example row:

```text
org.kde.kwrite	KWrite	26.04.3	stable	x86_64	flathub	95cbe5d36448
```

## Install output

Disposable test app: `org.kde.kwrite` (~1.7 MB app; `org.kde.Platform/6.11` already present). Uninstalled afterward. Other user apps unchanged.

Piped `flatpak install --user -y flathub org.kde.kwrite` (no `--noninteractive`):

- Human progress bars, percentages, and speeds (`Installing 1/2… ████ 31%`)
- **Do not parse this for production progress**

`flatpak install --user -y --noninteractive flathub org.kde.kwrite` with `LC_ALL=C`:

```text
Installing runtime/org.kde.kwrite.Locale/x86_64/stable
Installing app/org.kde.kwrite/x86_64/stable
```

Phase-level lines only. Matches the spec: CLI MVP uses indeterminate/phase progress.

## Update / uninstall

`flatpak update --user -y --noninteractive org.kde.kwrite` when already current:

```text
Nothing to update.
```

`flatpak update --dry-run` is **not** a supported option on 1.18.2.

`flatpak uninstall --user -y --noninteractive org.kde.kwrite`:

```text
Uninstalling app/org.kde.kwrite/x86_64/stable
Uninstalling runtime/org.kde.kwrite.Locale/x86_64/stable
```

## PluginLoader

Inherited Decky env (22:01:59, instance `6cf52098`):

- `flatpak --version` and `flatpak list ...` exit 1
- stderr: PyInstaller OpenSSL `OPENSSL_3.4.0` / `OPENSSL_3.2.0` not found via `LD_LIBRARY_PATH` under `/tmp/_MEI...`

Sanitized child env (`LD_LIBRARY_PATH` removed):

- `flatpak --version` → `Flatpak 1.18.2` exit 0
- list → exit 0, 13 rows, 0 malformed, tab delimiter, no header, `active` looks like commit
- `LC_ALL=C` variant identical

Production Flatpak exec from the plugin **must** sanitize `LD_LIBRARY_PATH`. That is not a different CLI; it is the same argv with a host-safe child environment.

