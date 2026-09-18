# SESSION-BRIDGE (2026-09-17)

Research spike that later became the production system-Flatpak path.

**Production (after Gaming Mode `SESSION_BRIDGE_PASS`):** DeckDepot uses transient `systemd-run --user` only for system Flatpak install/update/uninstall. No Decky `root` flag, no custom polkit, no `/etc` edits, no sudo wrappers, no persistent user units. AppMan and user Flatpak stay on their existing paths. See `py_modules/deckdepot/session_bridge.py`.

The rest of this file is the original Desktop-mode spike record. Gaming Mode mutation proof is in `~/homebrew/data/DeckDepot/session-bridge-gaming.json` (backend pid 2193, gamescope session 4, `org.kde.kcharselect` install/remove).

Host: Bazzite `44.20260915.0` (`bazzite-deck`), Flatpak `1.18.2`, Decky `v3.2.9`, uid `1000` (`zany130`) in `wheel`. The first spike ran in **Desktop Mode** (Plasma Wayland on `seat0` / logind session `3`).

Helpers used (not shipped): `spikes/python/session_bridge_probe.py`, `spikes/python/capture_polkit_subjects.sh`, `spikes/python/session_bridge_from_plugin.py`, `spikes/python/session_bridge_child.py`.

Snapshot from the real backend: `spikes/results/session-bridge-from-plugin.json`.

## Outcome

**`SESSION_BRIDGE_PASS`**

Desktop Plasma and Gaming Mode both authorized a PluginLoader-origin `systemd-run --user` helper for existing Flatpak system-helper + distro polkit policy. PluginLoader itself remains `auth_admin`. Production integration uses this helper only for system Flatpak mutations.

## Step 1 — control subjects

| Subject | UID | Supplementary groups | loginuid | kernel sessionid | cgroup | logind | pkcheck install / uninstall | pkcheck update |
|---|---|---|---|---|---|---|---|---|
| Plasma login (`startplasma-wayland` 28111) | 1000 | includes `wheel` (gid 10) | 1000 | **3** | `session-3.scope` | seat0, local, active, type=wayland, class=user | `yes` | rc 0 (implicit yes) |
| Cursor agent / this shell | 1000 | wheel | 1000 | **1** | `user@1000.service` / `app-cursor-*.scope` | `show-process` empty; env `XDG_SESSION_ID=3` | `yes` | rc 0 |
| Steam (`app-steam@*.service`) | 1000 | wheel | 1000 | **1** | `user@1000.service` | same | `yes` | rc 0 |
| `systemd-run --user` probe | 1000 | wheel | 1000 | **1** | `user@1000.service` / transient unit | same | `yes` | rc 0 |
| DeckDepot plugin (1537146) | 1000 | **empty** | **4294967295** | **4294967295** | `system.slice/plugin_loader.service` | none | **`auth_admin` rc 2** | **`auth_admin` rc 2** |
| PluginLoader binary (2005) | **0** | none | unset | unset | `system.slice/plugin_loader.service` | none | pkcheck of this PID from uid 1000 is denied | — |

Logind sessions:

- Session **1**: class=`manager`, seat empty, remote=no, active=yes, leader=`user@1000` systemd (pid 2315). Linger=yes.
- Session **3**: class=`user`, seat=`seat0`, tty1, type=wayland, desktop=KDE, remote=no, active=yes, leader=`sddm-helper`.

`plugin_loader.service` is `User=root`. The DeckDepot child is uid 1000 but was spawned **without** `initgroups` (empty `Groups:`) and **without** a logind session (`loginuid` unset). Same UID as the desktop user is not the same polkit subject.

Polkit authentication agent present in this Desktop session: `polkit-kde-authentication-agent-1` (pid 28555). `polkitd` is the system daemon.

Matching UID is not matching polkit subject. Matching `XDG_SESSION_ID` in the environment is not matching kernel/logind session either: this Cursor shell has env `XDG_SESSION_ID=3` but `/proc/self/sessionid=1`.

## Step 2 — upstream / on-disk policy

On-disk files match upstream Flatpak templates (`privileged_group=wheel`):

- `/usr/share/polkit-1/actions/org.freedesktop.Flatpak.policy`
- `/usr/share/polkit-1/rules.d/org.freedesktop.Flatpak.rules`

No extra Flatpak rule under `/etc/polkit-1/` (only an unrelated Bitwarden action). Bazzite `bazzite-autologin.rules` and `org.valve.steamos.rules` do **not** mention Flatpak.

Policy defaults:

| Action | allow_any | allow_inactive | allow_active | wheel rule YES? |
|---|---|---|---|---|
| `org.freedesktop.Flatpak.app-install` | auth_admin | auth_admin | auth_admin_keep | yes if active && local && wheel |
| `org.freedesktop.Flatpak.app-uninstall` | auth_admin | auth_admin | auth_admin_keep | same |
| `org.freedesktop.Flatpak.runtime-install` / `runtime-uninstall` | auth_admin | auth_admin | auth_admin_keep | same |
| `org.freedesktop.Flatpak.modify-repo` | auth_admin | auth_admin | **yes** | same YES overlay |
| `org.freedesktop.Flatpak.app-update` | auth_admin | auth_admin | **yes** | no (policy `allow_active=yes` is enough) |
| `org.freedesktop.Flatpak.runtime-update` | auth_admin | auth_admin | **yes** | no |

Why Desktop authorizes and PluginLoader does not, from **subject properties**, not from command success:

1. **Install/uninstall** succeed on Desktop because the JS rule returns `YES` for `subject.active && subject.local && subject.isInGroup("wheel")`. Plasma session-3 and user-systemd processes (session-1 manager + wheel) both got `pkcheck` `yes`.
2. **Update** succeeds on those same processes because they are polkit-**active** (`allow_active=yes`), even without the wheel overlay.
3. **PluginLoader DeckDepot** is not in a logind session, so it is not active. `pkcheck` returns `auth_admin` for install **and** update. It also lacks supplementary groups, so it would miss the wheel YES rule even if session were fixed.
4. Interactive `auth_admin` from PluginLoader previously failed with no agent. This Desktop session has a KDE agent, but PluginLoader is still not that session’s subject.

## Step 3 — session-bridge candidates

Supported / attempted (no credential spoofing, no `/proc` loginuid fakes, no `/etc`):

| Candidate | Result |
|---|---|
| Direct child of PluginLoader (`flatpak` / `pkcheck --process` on DeckDepot PID) | **Fail.** `auth_admin`. |
| `systemd-run --user` transient **service** | **Pass subject.** Child ppid=`user@1000` systemd, groups include wheel, loginuid=1000, sessionid=1, cgroup under `user@1000.service`. Self and external `pkcheck` = `yes` / update rc 0. |
| `systemd-run --user` with sparse caller env (`HOME`/`USER`/`PATH` + `XDG_RUNTIME_DIR=/run/user/1000` only) | **Pass.** User systemd still starts the unit. The unit **inherits the user manager environment**, including `XDG_SESSION_ID=3`, `DISPLAY=:0`, session bus. |
| Caller **without** `XDG_RUNTIME_DIR` / session bus | **Fail to start.** `Failed to connect to user scope bus... $DBUS_SESSION_BUS_ADDRESS and $XDG_RUNTIME_DIR not defined`. |
| `systemd-run --machine=zany130@.host --user` from empty env | **Fail.** `Permission denied` on machine transport. |
| `systemd-run --user -p PAMName=login` | **Fail.** exit `216/GROUP` (user instance cannot apply PAMName/initgroups). |
| `machinectl shell --uid=zany130 .host` | **Fail.** `Access denied`. |
| Joining `session-3.scope` from an unprivileged caller | **No supported API found.** Would require privileges or cgroup/session spoofing. Not attempted. |

`systemd-run --user` is a public systemd interface. It does **not** place the helper in `session-3.scope`. It places it in `user@1000.service`. On this image that is still enough for polkit `yes`.

Unix access needed to start that unit: uid 1000 can use `/run/user/1000/bus` and `/run/user/1000/systemd/private`. DeckDepot is uid 1000, so that is possible **if** the plugin sets `XDG_RUNTIME_DIR=/run/user/1000` (PluginLoader does not provide it). AutoFlatpaks already does that env fix for its own subprocesses; that is a reference observation, not copied code.

Verification spike 2 **did** exec `systemd-run` from a PID in `plugin_loader.service` (see below). Unix access needed: uid 1000 can use `/run/user/1000/bus` after the client sets `XDG_RUNTIME_DIR`. AutoFlatpaks already does that env fix for its own subprocesses; that is a reference observation, not copied code.

## Step 4 — authorization probe

Used `pkcheck --action-id <Flatpak action> --process <pid>` (no `-u`, no internal agent).

Exact actions, not a generic polkit dummy:

- `org.freedesktop.Flatpak.app-install`
- `org.freedesktop.Flatpak.app-update`
- `org.freedesktop.Flatpak.app-uninstall`

(`runtime-install` / `runtime-update` / `runtime-uninstall` / `modify-repo` were also sampled on the control subjects; PluginLoader DeckDepot was `auth_admin` for all of them.)

`systemd-run --user` helper:

- install: `polkit.result=yes` rc 0
- uninstall: `polkit.result=yes` rc 0
- update: rc 0, empty stdout (policy `allow_active=yes`)

DeckDepot backend PID:

- all three: `polkit.result=auth_admin` rc 2, “Authorization requires authentication and -u wasn't passed.”

No real Flatpak mutation was performed. pkcheck already used the action IDs Flatpak’s helper uses.

## Step 5 — mutation

Not run. Authorization probe already distinguished install/update/uninstall on the candidate PID class.

## Answers

1. **Why Desktop authorizes and PluginLoader does not.** Desktop/user-systemd processes are polkit-active (and local) with `wheel`. The bundled Flatpak rule then returns `YES` for install/uninstall; updates use `allow_active=yes`. PluginLoader’s DeckDepot child has **no logind session** (`loginuid` unset, `system.slice`) and **no supplementary groups**, so it is `auth_admin` for every sampled Flatpak action. Same uid is not enough.

2. **Can DeckDepot create a legitimate child that polkit treats as the active local user?** **Yes on Desktop, via `systemd-run --user`**, executed from the real PluginLoader DeckDepot PID. Gaming Mode still unknown.

3. **Mechanism.** `systemd-run --user` (transient service) after setting `XDG_RUNTIME_DIR=/run/user/<decky-uid>` so the unprivileged plugin can reach the user bus. The helper is parented by `user@UID.service`, not by PluginLoader. Do not use `PAMName=`, `machinectl`, or `--machine=`.

4. **Existing helper + existing policy?** **Yes for that helper class on this Desktop Bazzite image**, by `pkcheck` of the real Flatpak action IDs. Not by mutating apps.

5. **Gaming Mode?** **Unknown this run.** Session 3 is Plasma, not gamescope. No gamescope PID. Steam-as-user-unit on Desktop was `yes`, which is encouraging for other `user@1000.service` children, not proof of Gamescope-as-session.

6. **Auth dialog/agent?** Not for the passing helper: wheel `YES` / `allow_active=yes` need no prompt. PluginLoader still needs `auth_admin` and has no usable agent. Desktop currently has `polkit-kde-authentication-agent-1`; Gaming Mode may not.

7. **Stable enough for a store plugin?** `systemd-run --user` is a supported systemd API. The **polkit classification** of `user@.service` processes as active/local is logind/polkit behavior, not a Flatpak contract. It worked here with linger + an active seat session + `wheel`. Distro `privileged_group` and Gaming Mode session layout can differ. Less brittle than private Steam UI hooks; not as boring as a documented Flatpak API.

8. **Keep non-root DeckDepot / leave AppMan and user Flatpaks alone?** **Yes, architecturally.** No `root` flag and no host policy change are required for this path. User-scoped Flatpak and AppMan would stay as today’s direct children. Only a future system-mutation helper would be the user-systemd transient.

## Limitations (why not `SESSION_BRIDGE_PASS`)

- Gaming Mode / Gamescope session was **not measured**. Active logind user session remained Plasma `session-3`. Switching via `steamos-session-select` would terminate this Plasma/Cursor environment; Steam-on-Plasma is not a substitute.
- No real system install/remove cycle (explicitly gated on Gaming Mode authorization).
- Helper is kernel session **1** (`class=manager`, no seat), not `session-3.scope`. Desktop `pkcheck` is still `yes`; that may depend on the user also having an active seat session.
- Caller must inject `XDG_RUNTIME_DIR=/run/user/<uid>` (PluginLoader does not provide it). Direct `loginctl`/`systemctl` from the backend failed because inherited PyInstaller `LD_LIBRARY_PATH` breaks host systemd libs — `systemd-run` itself worked only because the probe used a sanitized client env.
- Install/uninstall silent `YES` needs `wheel` (or whatever Flatpak was built with). Updates need polkit-active, not wheel.
- Linger file exists on this host; it is **not** a DeckDepot setup requirement for an active login (see linger section). It would only matter after logout.
- Distro-specific: Bazzite/Flatpak `privileged_group=wheel`, uid 1000 in wheel, existing on-disk policy only.
- PluginLoader’s empty supplementary groups remain a Decky spawn fact; the bridge works by **not** using that process as the polkit subject.

## Minimal architecture if this is taken later

Do **not** implement now.

1. Keep `plugin.json` `flags: []`.
2. Keep user Flatpak + AppMan as today’s sanitized PluginLoader children.
3. For system mutations only: `systemd-run --user --wait` (or equivalent user-systemd transient) of a tiny helper that runs `flatpak --system …` with the existing sanitized child env (`LD_LIBRARY_PATH` popped).
4. Ensure the `systemd-run` client env includes `XDG_RUNTIME_DIR=/run/user/<uid>` from `DECKY_USER` / `pwd.getpwuid`.
5. Capability-detect: if `systemd-run --user` cannot connect, or `pkcheck`/helper gets `auth_admin`, keep system rows read-only.
6. Never treat PluginLoader `pkcheck` success as the test; always test the helper PID.

## Remaining design choices if this is rejected later

Unchanged, and not chosen here:

- optional custom polkit rule, plugin stays non-root;
- Decky root backend with a user-context drop for AppMan/user Flatpaks;
- keep system mutations read-only.

v1.0 product policy is unchanged: system inventory stays read-only.

---

# Verification spike 2 — PluginLoader origin (2026-09-17)

Temporary isolated probe: live `_main` called `run_session_bridge_spike(PLUGIN_DIR)` once, then live `main.py` and the probe modules were removed. Repo production `main.py` was never hooked. Snapshot: `spikes/results/session-bridge-from-plugin.json`.

## Step 1 — actual DeckDepot backend → `systemd-run --user`

Origin: PluginLoader child **DeckDepot pid 1733482**, ppid 1713801 (`Decky Loader v3.2.9`), cgroup `system.slice/plugin_loader.service`. Journal: `session-bridge spike systemd-run rc=0 helper_uid=1000`. Elapsed 128 ms.

Exact argv:

```text
/usr/bin/systemd-run --user --collect --wait --pipe --quiet
  --unit=deckdepot-session-bridge-spike.service
  -- /usr/bin/python3
     /home/zany130/homebrew/plugins/DeckDepot/py_modules/deckdepot/session_bridge_child.py
```

Client env (not the PluginLoader env): `HOME`/`USER`/`PATH=/usr/bin:/bin` + `XDG_RUNTIME_DIR=/run/user/1000` + session bus. **Exit status 0.** stdout = child JSON. stderr empty. Spawned unit: `deckdepot-session-bridge-spike.service` under `user@1000.service` / `app.slice`. Helper pid **1733504**, ppid **2315** (`user@1000` systemd).

Backend still has no `XDG_RUNTIME_DIR` / session bus of its own. The bridge works because the probe injects them for `systemd-run` only.

## Step 2 — bridged process identity vs backend vs known-good Desktop subject

| Property | DeckDepot backend (PluginLoader child) | Bridged helper | Known-good Desktop (spike 1 Plasma / user-systemd) |
|---|---|---|---|
| UID/EUID | 1000 | 1000 | 1000 |
| Groups | **empty** (`id` only gid 1000) | **wheel + others** (10, 18, 104, …) | wheel + others |
| PID | 1733482 | 1733504 | transient under `user@1000` |
| PPID | 1713801 PluginLoader | **2315 user systemd** | user systemd |
| cgroup | `system.slice/plugin_loader.service` | `user@1000.service/app.slice/deckdepot-session-bridge-spike.service` | `user@1000.service` |
| kernel sessionid | **4294967295** | **1** (class=`manager`, no seat, Active=yes, Remote=no) | 1 |
| loginuid | **4294967295** | **1000** | 1000 |
| `XDG_SESSION_ID` | unset | **3** (inherited from user manager; Plasma) | 3 |
| `XDG_RUNTIME_DIR` | unset | `/run/user/1000` | `/run/user/1000` |
| session bus | unset | unix path exists | yes |
| SELinux | `system_u:system_r:unconfined_service_t` | `unconfined_u:unconfined_r:unconfined_t` | unconfined user |

Uid 1000 on the backend is **not** a good polkit subject. The helper matches the previously known-good Desktop user-systemd subject class.

## Step 3 — exact Flatpak `pkcheck` from the helper (and backend)

No generic dummy action. No `-u`.

| Action | Backend rc / auth | Helper rc / auth | Agent required (helper) |
|---|---|---|---|
| `org.freedesktop.Flatpak.app-install` | 2 / `auth_admin` | **0 / yes** | **no** |
| `org.freedesktop.Flatpak.app-update` | 2 / `auth_admin` | **0 / yes** (empty stdout; `allow_active=yes`) | **no** |
| `org.freedesktop.Flatpak.app-uninstall` | 2 / `auth_admin` | **0 / yes** | **no** |

## Step 4 — Gaming Mode

**Not proven.** At capture time:

- logind session 3 = Plasma Wayland KDE, seat0, `sddm-autologin`, tty1, active, local
- session 1 = `systemd-user` manager
- `startplasma-wayland` running; **no gamescope compositor PID**
- SDDM packaged default session is `gamescope-session-ogui-steam.desktop`, but this login is Desktop Mode
- `steamos-session-select gamescope` would replace this Plasma session and kill the measurement environment

Desktop `pkcheck` `yes` is **not** treated as Gaming Mode success.

## Step 5 — linger

Host has `/var/lib/systemd/linger/zany130` (root-owned, born 2025-09-16) and `Linger=yes`. Linger was **not** disabled.

Observation, not a destructive test:

- `user@1000.service` is **WantedBy=`session-3.scope`** (`systemctl list-dependencies --reverse` shows only that session scope)
- `loginctl` manpage: linger spawns the user manager **at boot** and **keeps it after logouts** so users who are not logged in can run services
- During an **active** graphical login, logind already pulls `user@.service` via the session scope

**Linger not required during active Gaming Mode login.** Linger is only relevant for keeping the user manager alive after logout. Not added as a DeckDepot setup requirement. (Gaming Mode itself was not running; the WantedBy relationship is the same logind mechanism any active user session uses.)

## Step 6 — mutation

**Not performed.** Gaming Mode bridged authorization was not proven.

## Step 7 — classification

**`SESSION_BRIDGE_PASS_WITH_LIMITATIONS`**

`SESSION_BRIDGE_PASS` is rejected because Gaming Mode authorization and a verified system install/remove cycle are missing.

Credible as a **candidate** production architecture (no root plugin, no custom polkit, AppMan/user Flatpak unchanged) **on Desktop**. **Not** credible enough to integrate until the same PluginLoader → `systemd-run --user` → `pkcheck`/mutation chain is measured while Gamescope is the active seat session.
