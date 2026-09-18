# APPMAN-CONTRACT (2026-09-17)

Host capture: `~/homebrew/data/DeckDepot/p0-appman-host.json`  
Decky capture (after plugin reload + diagnostics button): `~/homebrew/data/DeckDepot/p0-appman-contract.json`

AppMan is **present** as a user-installed script, not vendored by DeckDepot.

```text
/home/zany130/.local/bin/appman
AMVERSION=10.5-1
```

`appman -v` / `--version` / `version` all print `10.5-1` and exit 0. Fake PyInstaller `LD_LIBRARY_PATH` does not break this bash script.

Config:

```text
~/.config/appman/appman-config
/var/home/zany130/Applications
```

That location is user-writable and is not `/opt`. Upstream `appman_location=/path appman …` only applies when this file does **not** already exist.

## Detection

Prefer `~/.local/bin/appman` over a privileged `am` in `/opt`. PluginLoader `PATH` may omit `~/.local/bin`; production detection MUST search `DECKY_USER_HOME/.local/bin/appman` explicitly, then `which`.

Simulated PluginLoader `PATH=/usr/bin:/bin` still found `/home/zany130/.local/bin/appman`. AppMan then printed:

```text
⚠️ WARNING: "/home/zany130/.local/bin" is not in PATH, local apps may not run.
```

on **every** command, including `-v` and `-f --less`. Production child env SHOULD prepend `~/.local/bin` to `PATH` so that warning does not contaminate parsers. `-f --less` is then a bare count (`31`); with the warning it is banner + count.

This target uses a **user-installed** AppMan. DeckDepot MUST NOT vendor/pin a copy.

## Commands (device-observed)

| Need | Command | Notes |
|---|---|---|
| Version | `appman -v` | stdout `10.5-1` |
| Search | `appman -q {keyword}` | Human paragraphs; zero hits still exit 0 |
| Installed list | `appman -f` / `-f --byname` | Unicode `◆` pipe table, no JSON |
| Installed count | `appman -f --less` | stdout is a number (`31`) |
| Available catalog | `appman -l` / `-l --all` | `-l` mixes installed then available |
| Details | `appman -a {name}` | `STATUS: installed` or `not installed` |
| Install | `appman -i {name}` | Downloads an AM database **script**, wget progress bars |
| Noninteractive yes | `appman -y …` / `--assume-yes` | Must precede other options |
| Remove (help: confirm) | `appman -r {name}` | See mutation note below |
| Remove (no prompt) | `appman -R {name}` | Documented no-confirm |
| Update | `appman -u` / `appman -u {name}` | |
| Extra/github | `appman -e user/project {APPNAME}` | Outside the main DB |
| 3rd-party install flags | `--busybox --coreutilsh --python --appbundle --soarpkg` | |

No `--json`. `appman --json` prints `ERROR: unknown option "--json"` and still **exits 0**.

## Exit codes

Missing names, empty search, unknown options, and failed installs observed here all **exit 0**. Production MUST parse stdout/stderr. Do not treat rc!=0 as the failure signal, and do not treat rc=0 as success.

Empty search text:

```text
SEARCH RESULTS FOR "ZZZZZNOTAREALAPP12345":
  No search results, please retry this query using the "--all" flag
```

Missing install:

```text
💀 ERROR: "zzzzznotarealapp12345" does NOT exist in the "AM" database
```

## Mutation / confirmation (host, not PluginLoader)

`appman -r sas` with **closed stdin** printed `"sas" has been removed!` and deleted the app. Help text says `-r` requires confirmation; headless/Decky has no reliable TTY prompt. `-R` is the documented no-prompt remove.

Reinstall used `appman -y -i sas`: wget percentage bars (do **not** parse for progress), then `Checksum cannot be verified, missing download URL. INSTALLATION ABORTED!` still **exit 0**. The app was listed again afterward (`-f --less` 31, binary at `~/Applications/sas/sas`).

Cancellation: no documented cancel API. Only process-group signals, same class as Flatpak.

## Desktop files / launchers

AppMan creates `~/.local/bin/<name>` symlinks and often `~/.local/share/applications/*.desktop` (examples: `am-gui-AM.desktop`). Those are **AppMan’s own desktop files**, not a DeckDepot Launch feature. Do not execute `Exec=` from them.

## Architecture / trust

`ARCH=$(uname -m)` with `amd64` mapped to `x86_64`. Database lists live under `~/.local/share/AM/x86_64-*`.

Installations fetch scripts from `https://raw.githubusercontent.com/ivan-hc/AM/main`. Trust model is **remote shell scripts**, not Flathub sandboxes. UI MUST label AppMan as a distinct provider if M11 is built. Checksums can fail.

## Gate status

**PASS_WITH_LIMITATIONS**

Production AppMan (M11) MAY proceed only with:

- explicit `appman` path detection (not PATH-only);
- text parsing, not exit codes / JSON;
- UI confirmation; never rely on `-r` prompts; use `-y`/`-R` only after the user confirms in DeckDepot;
- no Launch action;
- no `/opt` / root `am`;
- no vendored AppMan;
- no AppMan tab until that provider is implemented;
- no AppMan-specific category UI; shared tabs stay Games | Utilities | Audio & Video | Graphics | Network | Office | Development;
- do not mix AppMan catalog rows into those tabs until a first-class category source exists (catalog text is not enough).

Do not treat AppMan apps as equivalent to Flathub Flatpaks.

## Shared category taxonomy (user-facing)

DeckDepot browse tabs stay the existing seven slugs. Do **not** add an AppMan-specific category sidebar (PLA has ~30 website chips: AI, Comic, Emulator, Wine, Steam, YouTube, separate Audio vs Video, …).

| Slug | Label |
|---|---|
| `game` | Games |
| `utility` | Utilities |
| `audiovideo` | Audio & Video |
| `graphics` | Graphics |
| `network` | Network |
| `office` | Office |
| `development` | Development |

Flatpak today fills those tabs from Flathub `GET /api/v2/collection/category/{slug}` and search-hit `main_categories` (a single lowercase string such as `game`). Audio and Video were already combined as `audiovideo`. AppMan must use the **same** slugs if it ever appears in those tabs.

### What AppMan actually exposes

| Source | Category metadata? |
|---|---|
| `appman -q` / `-l` / `~/.local/share/AM/x86_64-apps` | Name + one-line description only |
| `appman -a` / Portable-Linux-Apps markdown | Description, sites, screenshots. **No category key** |
| `appman -f --byname` `TYPE` | Package format: `appimage`, `appimage*`, `posix-script`, `dynamic-binary` — **not** Games/Utilities |
| Third-party lists (`busybox`, `soarpkg`, `python`, …) | Format/database, not user taxonomy |
| Install scripts | Categories appear only after extracting a `.desktop` from the payload |
| Installed `*-AM.desktop` | Freedesktop `Categories=` **after install**, when the app shipped a desktop file |

AppMan CLI has no category query comparable to Flathub `collection/category/{slug}`.

### Website regex is not a provider API

Portable-Linux-Apps (`pla-site.toml`) classifies the **same one-line descriptions** with keyword regex. That is a static site generator, not `appman`. Measured on this machine’s `x86_64-apps` (3643 rows, snapshot `p0-appman-categories.json`):

- **48.8% unmatched** (including `abiword` “word processing” with no “office”, `sas` sandbox tool, `7zip` archiver)
- **17.1% multi-match**
- False positives if those hits were trusted as DeckDepot tabs: `steamdepotdownloadergui` → Games (`steam`/`game`); `wine` → Games; `moonlight` → Games **and** Audio & Video (`stream`); PLA `ai` includes the word `cursor`

Do **not** vendor that toml, fetch PLA HTML category pages, or treat regex hits as equivalent to Flathub `main_categories`.

### Proposed mapping (contract for M11, not implemented)

**Catalog / search (now):** AppMan rows stay out of category browse. Shared tabs remain Flathub-backed. AppMan discovery is search + installed inventory. Internally MAY keep `amType`, `amDb`, description, and optional regex hits as provider-private fields — never as extra QAM tabs.

**If a later M11 pass must show AppMan inside the seven tabs**, prefer post-install Freedesktop `Categories=` (observed on this host) over description regex. Map to **one** DeckDepot slug (same shape as Flathub’s single `main_categories`):

| Freedesktop tokens | DeckDepot slug |
|---|---|
| `Game`, `*Game`, `Emulator` | `game` |
| `Audio`, `Video`, `AudioVideo`, `Player`, `Recorder`, `TV`, `Music` | `audiovideo` |
| `Graphics`, `2DGraphics`, `3DGraphics`, `RasterGraphics`, `VectorGraphics`, `Photography` | `graphics` |
| `Network`, `Email`, `WebBrowser`, `InstantMessaging`, `Chat`, `FileTransfer`, `P2P`, `RemoteAccess` | `network` |
| `Office`, `Spreadsheet`, `WordProcessor`, `Presentation`, `Calendar`, `ContactManagement`, `Dictionary`, `Finance`, `ProjectManagement`, `Publishing` | `office` |
| `Development`, `IDE`, `Debugger`, `GUIDesigner`, `Building`, `RevisionControl`, `Translation`, `Database`, `WebDevelopment` | `development` |
| `Utility`, `System`, `Settings`, `Accessibility`, `Archiving`, `Compression`, `FileTools`, `FileManager`, `TerminalEmulator`, `TextEditor`, `Calculator`, `Clock`, `Monitor`, `Security`, `PackageManager`, `Science`, `Education`, `Documentation`, `Core` | `utility` |

Conflict order (first hit wins): `game` > `audiovideo` > `graphics` > `network` > `office` > `development` > `utility`. Empty `Categories=` (example: `steamdepotdownloadergui-AM.desktop`) or CLI-only apps → **uncategorized**: search/installed only, not stuffed into Utilities by default.

PLA-only chips (Wine, Steam, YouTube, AI, Comic, GNOME, KDE, AppImages, …) fold into the seven slugs or stay uncategorized. Do not resurrect separate Audio vs Video tabs.

Desktop files are still **not** a DeckDepot Launch path. Installed examples here: `cursor-AM.desktop` `Development;IDE` (correct Development; PLA would have called it AI), `azahar-enhanced-AM.desktop` `Game;Emulator`, `pcloud-AM.desktop` `Network`, `am-gui-AM.desktop` `Utility;System;PackageManager`. Even desktops lie sometimes (`slippi-AM.desktop` is `Development`).

### Gate implication

Shared-taxonomy browse of the **AppMan catalog** is **not reliable** with current metadata. That does **not** fail APPMAN-CONTRACT for install/search/remove. It **does** forbid mixing AppMan heuristic hits into the existing Games/Utilities/… tabs until a first-class category source exists. Keep `PASS_WITH_LIMITATIONS`.
