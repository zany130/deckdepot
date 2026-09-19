# v1.1.0 multi-remote proofs (2026-09-19)

Harness: `spikes/python/multi_remote_spike.py`  
Raw capture: `spikes/results/multi-remote-spike.json`  
Host: Flatpak 1.18.2, AppStream 1.1.3, Decky PluginLoader 3.2.9, Steam CEF on `https://steamloopback.host/routes/deckdepot`.

No remotes were added, removed, or reconfigured. No installs.

## 1. Icons in Steam CEF

AppStream icon on disk:

```text
/var/lib/flatpak/appstream/pontoon/x86_64/active/icons/128x128/org.harbourmasters.soh.png
```

9387 bytes. CEF origin is `https://steamloopback.host`.

| Source | `Image()` | `fetch()` |
|---|---|---|
| HTTPS screenshot (`raw.githubusercontent.com` SoH) | **yes** 2880×1620 | **yes** HTTP 200 |
| `file://` AppStream PNG | no | Failed to fetch |
| `data:image/png;base64,…` of that PNG | **yes** 128×128 | n/a |
| Plugin static (`/plugins/DeckDepot/assets/store.png`, loopback, `:1337`) | no | HTTP 404 |
| Copied SoH PNG into live `assets/` then same plugin URLs | no | HTTP 404 |

Production implication:

- Do **not** point `AppTile.iconUrl` at `file:///var/lib/flatpak/appstream/…`.
- Decky does not expose plugin `assets/` as a working CEF image URL on this host.
- Backend can read the local PNG (cache path, not API) and return a **data URL**. CEF loads that.
- HTTPS screenshot / Flathub icon URLs already work; keep them for Flathub overlay.
- Missing icon still uses the existing placeholder.

## 2. `appstreamcli` under PluginLoader-like env

Binary: `/usr/bin/appstreamcli`. PluginLoader PyInstaller extract: `/tmp/_MEI…` with `libcrypto.so.3` / `libssl.so.3`.

| Child env | `appstreamcli --version` | SoH (`org.harbourmasters.soh`) | RetroArch | Goopie (`xyz.goopie.launcher`) |
|---|---|---|---|---|
| Host/Cursor `LD_LIBRARY_PATH` | 1.1.3 | details + icon filename + HTTPS screenshot + `Game`/`AdventureGame` | same richness | exit 4, not in pool |
| PluginLoader `LD_LIBRARY_PATH=/tmp/_MEI…` | fail | fail | fail | fail |
| `sanitized_host_env()` (`LD_LIBRARY_PATH` popped) | 1.1.3 | same details as host | same | exit 4, not in pool |

PluginLoader failure (same class as Flatpak P0.5):

```text
/usr/bin/appstreamcli: /tmp/_MEI…/libssl.so.3: version `OPENSSL_3.2.0' not found (required by /usr/lib64/libcurl.so.4)
```

Production implication: call `appstreamcli` with the same sanitized child env as Flatpak. Do not inherit PluginLoader `LD_LIBRARY_PATH`. `no-enumerate` remotes (Goopie) stay out of AppStream; Installed fallback already covers that.

## 3. Flathub HTTP vs system `remote-ls` filter

`/usr/share/ublue-os/flatpak-blocklist`:

```text
deny com.valvesoftware.Steam/*
deny net.lutris.Lutris/*
```

| App | Flathub HTTP search exact hit | Flathub Games category page 1 (50) | User `remote-ls --cached flathub` (3351) | System `remote-ls --cached flathub` (3349) |
|---|---|---|---|---|
| `com.valvesoftware.Steam` | yes | **yes** | yes | **no** |
| `net.lutris.Lutris` | yes | **yes** | yes | **no** |
| `org.libretro.RetroArch` (control) | yes | yes | yes | yes |

`remote-ls --cached` for system Flathub was 71 ms; user 62 ms. Do not rebuild the Games tab from 3000+ local rows.

Production implication:

- Keep Flathub HTTP for the seven category tabs.
- Before **system** Flathub Install, reconcile against `remote-ls` (or `remote-info`) so a blocklisted Games-tab hit is not treated as installable.
- User Flathub is unfiltered on this host; Steam/Lutris remain installable there.
- Unfiltered HTTP must not be the installable set for system Flathub.

## Verdict for v1.1.0 production

The three proofs are enough to start the implementation milestones. Icons: data URL or placeholder. Metadata: sanitized `appstreamcli`. System Flathub: HTTP browse + CLI filter reconcile at install time.
