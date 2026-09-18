# P0.7–P0.11 Steam / launch harness (2026-09-16)

These gates cannot be marked PASS from source reading. The diagnostics route
now auto-dumps P0.7 and runs explicit buttons for P0.8–P0.11.

## P0.7 SteamClient capability dump

On `/deckdepot` mount the frontend records presence/type of:

`AddShortcut`, `RemoveShortcut`, `SetAppLaunchOptions`, `SetShortcutExe`,
`SetShortcutIcon`, `SetShortcutLaunchOptions`, `SetShortcutName`,
`SetShortcutStartDir`, `SetCustomArtworkForApp`, `ClearCustomArtworkForApp`

plus interesting App method names and `appStore` / `appDetailsStore` /
`collectionStore` **names only**. `GetShortcuts` is never called.

Snapshot: `~/homebrew/data/DeckDepot/p0-steam-capabilities.json`

## P0.8 Readiness

`AddShortcut` name is **not** kept. Identity A/B/C all showed as `flatpak` in the
library search grid (exe basename).

`SetShortcutName` after the overview exists **is** kept. Details page showed
`DeckDepot P0 Probe readiness @2000ms`. First `GetAppOverviewByAppID` hit ~256 ms.

## P0.9 Identity / persistence

Returned AppIDs do not match CRC32. Plugin reload still resolved the three IDs.

**Steam restart: user-confirmed, shortcuts still present.** Reboot not separately
logged; do not claim reboot-proof durability.

## P0.10 Artwork

Magenta **Capsule** is visible in the Gaming Mode library grid on the first
identity shortcut. That is the visual Capsule proof.

## P0.11 Launch

Direct `flatpak run` from PluginLoader:

1. Empty DISPLAY → immediate abort (RetroArch exit 1, Dolphin exit 134)
2. Borrowed `DISPLAY=:1` → **process stays running**. PPSSPP window exists at
   1280x720 on `:1` underneath `Steam Big Picture Mode`.
3. gamescope `--steam` focus stays `GAMESCOPE_FOCUSED_APP=769`. Setting
   `STEAM_GAME` on the PPSSPP window did not change focus.

Direct plugin launch is **omitted from MVP** (`GAMING-MODE-LAUNCH` =
`FAIL_USE_FALLBACK`). Steam still launches apps added to the library.
