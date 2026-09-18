# IMPLEMENTATION.md
## Frozen v1.0 Implementation Baseline for DeckDepot

**Document status:** FROZEN v1.0 IMPLEMENTATION BASELINE  
**Spec version:** 1.0  
**Supersedes:** the original `IMPLEMENTATION.md` contained in *Decky App Store Specification Plan.pdf*, and all pre-freeze drafts of this file  
**Freeze date:** 2026-09-17  
**Previous reconciliation date:** 2026-09-16  

**Freeze note.** Pre-M2 architecture investigation is complete. M1 is implemented and device-tested. The AutoFlatpaks / SteamGridDB reference-implementation audit and the system-scope Flatpak feasibility spike have been reconciled into this document. The v1.0 product scope below is frozen for implementation.

Do not reopen this document for ordinary new ideas. Future feature ideas belong in a separate future/backlog document. Amend this baseline only when:

1. real-device behavior contradicts it;
2. an upstream API materially changes;
3. implementation exposes a genuine blocker.

**Evidence baseline:** original implementation plan + independent audit + rebuttal + Phase 0 device gates (2026-09-16) + completed M1 device test + DeckDepot M1 Reference Audit (`jurassicplayer/decky-autoflatpaks`, `SteamGridDB/decky-steamgriddb`) + DeckDepot System Scope Spike (Bazzite 44.20260915.0, Flatpak 1.18.2, Decky v3.2.9) + current official upstream evidence reviewed through 2026-09-17.

**Primary target:** Decky Loader in Steam Gaming Mode on SteamOS and Bazzite  
**Primary package source for v1.0:** Flathub / **user-scoped Flatpak** (full management) plus **read-only system-scoped Flatpak discovery**  
**Planned secondary provider:** AppMan / AM local mode for AppImage and other portable applications (does not block the Flatpak v1.0 loop)

**Product identity for this local implementation:** DeckDepot — “Linux apps, right from Gaming Mode.” Placeholder names in this document (`Linux App Store`, `decky-linux-store`, `/decky-linux-store`) are legacy except where they are themselves an architectural contract. The local plugin uses display name `DeckDepot`, package id `deckdepot`, and full-screen route `/deckdepot`.

**v1.0 product loop (normative):**

```text
Discover → Install → Manage → Update → optionally Add to Steam
                                              ↓
                                        Steam Library
                                              ↓
                                   Steam launches the application
```

Steam owns application launching. DeckDepot does not execute installed applications.

---

# 0. How a coding agent MUST use this document

This document intentionally combines the implementation plan and the architecture-validation plan into one source of truth.

The original specification contained several concrete assumptions that were later shown to be incorrect or insufficiently verified. This version therefore distinguishes between facts that may be implemented immediately and behavior that must first be measured on a real Decky/Steam environment.

## 0.1 Status tags

The following tags are normative:

- **[DEVICE-OBSERVED]** — measured on a real Decky/Steam/Flatpak environment. Strongest evidence for runtime behavior.
- **[OFFICIAL-UPSTREAM-SOURCE]** — current upstream source (for example Flatpak system-helper policy, Decky template, maintained SteamClient typings).
- **[OFFICIAL-DOCUMENTATION]** — current official documentation/specification.
- **[VERIFIED-UPSTREAM]** — supported by current official upstream source or official documentation and safe to use as an implementation contract. Equivalent strength to the two official tags above when both agree.
- **[REFERENCE-IMPLEMENTATION]** — observed in a mature third-party plugin. Demonstrates behavior; does **not** establish a permanent API contract. Strength is below device observation and official upstream/docs, and above unsupported assumptions.
- **[CORRECTED]** — replaces a concrete statement or API contract from the original specification that was wrong or misleading.
- **[DEVICE-GATE]** — behavior depends on undocumented or unstable Steam/Decky/runtime behavior. The associated spike MUST pass before dependent production code is finalized.
- **[PROVIDER-GATE]** — behavior is specific to a package provider and blocks only that provider, not the rest of the application.
- **[DEFERRED]** — explicitly outside v1.0, or postponed until a later milestone. Historical closed spikes that were **rejected** (not deferred) are marked as such in the Verification Ledger and MUST NOT be read as “later.”

Evidence conflict priority (highest first):

1. direct real-device behavior **[DEVICE-OBSERVED]**;
2. current official upstream source **[OFFICIAL-UPSTREAM-SOURCE]**;
3. current official documentation/specification **[OFFICIAL-DOCUMENTATION]**;
4. maintained first-party examples;
5. mature reference implementations **[REFERENCE-IMPLEMENTATION]**;
6. prior assumptions in this document.

## 0.2 Agent execution rules

A coding agent MUST follow these rules:

1. Do not treat undocumented Steam APIs as stable merely because a plausible method name exists.
2. Do not invent local TypeScript declarations to make an unavailable Steam API compile.
3. For every **[DEVICE-GATE]**, build and run the smallest diagnostic necessary, record the result in the Verification Ledger in this document, and only then implement the dependent production path.
4. If observed runtime behavior contradicts this document, stop the dependent implementation, update the Verification Ledger, and amend the affected section before continuing.
5. Do not silently substitute a different API or a magic delay.
6. Runtime capability detection is required for undocumented Steam APIs.
7. Graceful degradation is preferred to hard failure when an optional Steam integration is unavailable.
8. Security boundaries must be enforced in backend code even when the frontend already validates input.
9. Human-readable CLI output is not a machine protocol unless the provider explicitly documents it as such.
10. The plugin MUST remain useful as a Flatpak store even if Steam shortcut integration, SteamGridDB, or AppMan is unavailable.
11. Direct application launching by DeckDepot is a **closed historical rejection**, not a deferred feature. Do not implement `launch_application`, a Launch button, or production `flatpak run` from the plugin.
12. Do not treat the host user's interactive shell as equivalent polkit evidence for the Decky PluginLoader backend. Same uid and `wheel` membership are not sufficient; session/active/local subject properties differ.
13. A successful query with zero results is not a request/backend/network/remote failure. Consumers MUST be able to distinguish those states.
14. Completed M1 user-scoped mutation architecture is frozen. Do not rewrite it to absorb later research; later milestones add requirements without reopening the working engine.
15. v1.0 MUST NOT install, update, or remove system-scoped Flatpaks, MUST NOT add or modify system remotes, MUST NOT install custom polkit rules, and MUST NOT run the whole plugin as root solely to obtain system mutations.

---

# 1. Product definition

The product is a controller-first Linux application store integrated into Steam Gaming Mode through Decky Loader.

DeckDepot's v1.0 product loop is:

**Discover → Install → Manage → Update → optionally Add to Steam**

Steam owns application launching. After optional Add to Steam, the user starts the application from the Steam Library. DeckDepot does not directly launch applications.

The intended user flow is:

```text
Discover
   ↓
Install
   ↓
Manage / Update
   ↓
Optional Add to Steam
   ↓
Steam Library
   ↓
Steam launches the application
```

v1.0 MUST allow the user to:

- open a full-screen store UI from Decky's Quick Access Menu;
- browse and search Flathub;
- view application details, screenshots, metadata, and install state;
- install, update, and uninstall **user-scoped** Flatpak applications;
- see currently installed user-scoped Flatpaks;
- discover already-installed **system-scoped** Flatpaks as read-only inventory (no system mutation);
- optionally add an installed application (user- or system-scoped, once capability-tested) to the Steam library without manually editing Steam files;
- optionally populate Steam artwork through a **minimal** SteamGridDB automation path;
- recover cleanly from network, Flatpak, Decky, and Steam API failures.

A later provider phase MAY add AppMan / AM local mode to install and manage AppImages and other portable applications.

## 1.1 Non-goals for v1.0

v1.0 MUST NOT:

- mutate the host OS package layer with `pacman`, `dnf`, `rpm-ostree`, `steamos-readonly`, or equivalent system-package commands;
- require root privileges;
- install a custom polkit rule under `/etc/polkit-1/rules.d` or equivalent;
- install, update, or remove **system-scoped** Flatpaks;
- add or modify system Flatpak remotes;
- depend on direct writes to Steam's `shortcuts.vdf` as its primary integration mechanism;
- claim exact byte-level Flatpak progress unless a supported progress API is proven;
- parse arbitrary `.desktop` `Exec=` lines and execute the result;
- promise 100% SteamGridDB artwork coverage;
- implement a full SteamGridDB client (result-selection UI, artwork browsing, style filtering, cropping, positioning UI, pagination for artwork choice, or manual artwork management);
- promise fixed network latency;
- treat AppMan as production-ready until its provider gate is complete;
- ship an in-plugin Launch action or any production path that executes applications from DeckDepot.

**[DEVICE-OBSERVED]** On this Bazzite/gamescope `--steam` client, backend `flatpak run` can start a process and even create an X11 window, but `GAMESCOPE_FOCUSED_APP` stays `769` (Steam BPM). That measurement closed direct launch. Users run installed apps from Steam after optional Add to Steam, or from Desktop Mode. This is a **rejected** design, not a deferred one.

## 1.2 User vs system Flatpak policy (v1.0)

### User Flatpaks

Full management using the existing M1 user-scoped engine:

```text
Discover, Install, Update, Remove, Manage, Add to Steam
```

### System Flatpaks

**Read-only discovery only.**

DeckDepot MAY query non-mutating system-scope information required to determine what is installed, including:

```bash
flatpak list --system ...
```

and system remotes when needed for inventory. DeckDepot v1.0 MUST NOT mutate system installations.

System mutation support is **post-v1.0 future work**. It is not an active v1.0 dependency. The completed spike conclusion is **SYSTEM MUTATIONS REQUIRE A NEW PRIVILEGE DESIGN**; the recommended future investigation is narrow polkit authorization first, with a Decky root-plugin architecture only if a sufficiently safe portable rule cannot be designed. Neither architecture is chosen or implemented in v1.0.

---

# 2. Reconciled architecture

## 2.1 High-level layers

| Layer | Runtime | Responsibility |
|---|---|---|
| Decky frontend | Steam CEF / SharedJS context | full-screen UI, controller navigation, catalog presentation, route management, SteamClient adapter |
| Decky RPC/event bridge | `@decky/api` + Decky Python bridge | typed RPC and asynchronous task events |
| Python backend | Decky plugin Python runtime | Flatpak/AppMan process orchestration, task state, filesystem-safe operations, validation |
| Flatpak engine (M1, frozen) | host `flatpak` binary, **user scope mutations** | list / install / update / uninstall user-scoped apps; no production `run` |
| System Flatpak inventory (M4) | host `flatpak` binary, **read-only `--system` queries** | discover installed system apps; never mutate |
| Catalog adapter | frontend network path by default | Flathub search and metadata |
| Steam integration adapter | live Steam CEF APIs | non-Steam shortcut creation/removal, optional shortcut setters, optional artwork |
| Optional art provider | SteamGridDB (minimal automation) | first-result cover/hero/logo/etc. lookup for verified Steam asset types |
| Optional portable-app provider | AppMan / AM local mode | AppImage/portable-app discovery and management after provider validation |

## 2.2 Network policy

**[CORRECTED]** The architecture MUST NOT assume ordinary Python HTTPS behaves identically on SteamOS and Bazzite.

For public catalog traffic such as Flathub, the preferred baseline is frontend fetch from the CEF environment, because it uses the browser TLS stack and avoids dependency on Decky's embedded Python certificate configuration.

Backend HTTPS MAY be used only after the Phase 0 TLS diagnostic proves a supported certificate path on the target environment or after a current Decky-provided SSL helper is verified and used.

**[DEVICE-OBSERVED]** On this Decky v3.2.9 runtime, Python stdlib HTTPS failed certificate verification; `helpers.get_ssl_context()` succeeded. **[REFERENCE-IMPLEMENTATION]** The current SteamGridDB Decky plugin uses Decky's `get_ssl_context()` for backend HTTPS. Treat that helper as a concrete implementation candidate observed in a mature current plugin. It is not an eternal stable contract and must still be validated on-device (already recorded as BACKEND-TLS `PASS_WITH_LIMITATIONS` on this target).

Secret-bearing requests, such as SteamGridDB API-key requests, SHOULD remain backend-owned if backend HTTPS is proven. The API key MUST NOT be logged. Do not copy or reuse any API key embedded in another plugin.

---

# 3. Repository layout and toolchain

## 3.1 Repository baseline

**[CORRECTED]** Start from the current official `SteamDeckHomebrew/decky-plugin-template`. Do not reproduce the old nested `frontend/package.json` + root package layout merely because the original specification used it.

The project SHOULD use a layout compatible with the official template:

```text
decky-linux-store/
├── assets/
├── backend/
│   ├── __init__.py
│   ├── config.py
│   ├── models.py
│   ├── security.py
│   ├── flatpak_engine.py
│   ├── task_manager.py
│   ├── steam_metadata.py
│   └── appman_engine.py          # stub until provider gate passes
├── defaults/
├── py_modules/
├── src/
│   ├── index.tsx
│   ├── api/
│   │   ├── backendBridge.ts
│   │   ├── flathubClient.ts
│   │   └── steamGridDbClient.ts
│   ├── components/
│   ├── routes/
│   │   ├── StoreRoute.tsx
│   │   └── DiagnosticsRoute.tsx  # dev-only validation harness
│   ├── providers/
│   │   ├── IPackageProvider.ts
│   │   └── FlatpakProvider.ts
│   ├── steam/
│   │   ├── capabilityProbe.ts
│   │   ├── shortcutManager.ts
│   │   └── artworkManager.ts
│   ├── state/
│   ├── types/
│   └── utils/
├── spikes/
│   └── results/                  # raw diagnostic outputs; not product state
├── main.py
├── decky.pyi
├── package.json
├── plugin.json
├── pnpm-lock.yaml
├── rollup.config.js
├── tsconfig.json
├── README.md
└── IMPLEMENTATION.md
```

The exact presence of template helper directories MAY change upstream. Preserve the current official template rather than deleting template-required files to match this tree.

## 3.2 Dependency policy

**[CORRECTED]** Do not pin the old versions from the original specification.

At project initialization:

1. clone/fork the current official Decky plugin template;
2. use the package versions supported by that template;
3. update `@decky/ui` / `@decky/api` only when required by current Decky guidance;
4. commit the resulting lockfile;
5. record the tested Decky Loader, Steam Client, `@decky/api`, and `@decky/ui` versions in the Verification Ledger.

Do not use a locally invented Steam API declaration merely to satisfy TypeScript.

## 3.3 `plugin.json`

The release plugin MUST use:

```json
{
  "name": "Linux App Store",
  "author": "<project author>",
  "flags": [],
  "api_version": 1
}
```

Additional publish metadata MAY be added.

The plugin MUST NOT request `_root`.

---

# 4. Core data model

The data model MUST separate unknown values from display fallbacks.

## 4.1 Frontend application model

```ts
type ProviderId = "flatpak" | "appman";

type InstallationScope = "user" | "system";

type InstallState =
  | "unknown"
  | "not_installed"
  | "installed"
  | "update_available";

interface AppSummary {
  provider: ProviderId;
  appId: string;
  /**
   * Required for installed Flatpak instances.
   * Catalog-only rows MAY omit it until an install target is chosen.
   * Do not treat appId alone as unique among installed instances.
   */
  installationScope?: InstallationScope;
  name: string;
  summary?: string;
  iconUrl?: string;
  categories: string[];
  installedState: InstallState;
  installedVersion?: string | null;
  latestVersion?: string | null;
}

interface Screenshot {
  url: string;
  width?: number;
  height?: number;
  caption?: string;
}

interface AppDetails extends AppSummary {
  descriptionText?: string;
  developerName?: string;
  projectLicense?: string;
  homepageUrl?: string;
  screenshots: Screenshot[];
  launchableDesktopId?: string;
  bundleRef?: string;
}
```

**[CORRECTED]** The string `"Latest"` MUST NOT be stored as an application version. If no version is known, store `null`/`undefined`; the UI MAY display a human-friendly fallback such as `Latest` or `Version unavailable`.

Installed Flatpak identity for v1.0 discovery is at least `(appId, installationScope)`. If the same application exists in both user and system scopes, the UI MUST show both rows and MUST NOT collapse them into one instance. Mutation operations apply only to `installationScope: "user"`.

## 4.2 Task model

```ts
type TaskPhase =
  | "queued"
  | "starting"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

interface TaskProgress {
  taskId: string;
  provider: ProviderId;
  appId: string;
  operation: "install" | "update" | "uninstall";
  phase: TaskPhase;
  progressKind: "indeterminate" | "fraction";
  progressPercent?: number;
  statusText?: string;
  errorMessage?: string;
  exitCode?: number;
}
```

**[CORRECTED]** `progressPercent` MUST be absent unless a supported provider interface supplies a meaningful value. The v1.0 Flatpak CLI path uses indeterminate/phase progress.

## 4.3 Steam shortcut state

```ts
type SteamShortcutState =
  | "unsupported"
  | "not_added"
  | "adding"
  | "added_live"
  | "known_from_plugin_registry"
  | "error";
```

Do not model `persisted` as a guaranteed state until the persistence device gate proves an observable contract.

---

# 5. Security and trust boundaries

## 5.1 Flatpak/App ID validation

**[PARTIALLY VERIFIED / CORRECTED]**

Flatpak application IDs follow reverse-DNS / D-Bus naming conventions. D-Bus names have a 255-byte maximum. The validator MAY enforce that ceiling, but the validator MUST NOT claim that its regex alone proves a valid or existing Flatpak application.

Validation MUST:

- trim surrounding whitespace;
- reject NUL/control characters;
- reject path separators;
- reject shell metacharacters by using a conservative ASCII allowlist;
- require at least one `.` separator;
- enforce a maximum UTF-8 byte length of 255;
- verify the ID through the relevant provider/catalog before performing a mutation.

A conservative allowlist is acceptable as a security rule even if it accepts fewer identifiers than the complete upstream grammar.

## 5.2 Subprocess safety

All backend process execution MUST use argument arrays through `asyncio.create_subprocess_exec`.

Never use:

- `shell=True`;
- string concatenation passed to a shell;
- `os.system`;
- untrusted command fragments.

## 5.3 Remote metadata

Remote descriptions, screenshots, icons, websites, and other URLs are untrusted.

Rules:

- default to plain-text description rendering for v1.0;
- if HTML rendering is added, sanitize to an explicit allowlist before rendering;
- do not feed raw remote HTML into `dangerouslySetInnerHTML`;
- permit only expected `https:` URLs for remote media/navigation unless a specific feature requires otherwise;
- reject `javascript:`, `file:`, arbitrary `data:`, and other unexpected schemes;
- remote filenames MUST NOT control local filesystem paths.

## 5.4 Desktop files

Installed desktop files are user-controlled content.

The application MUST NOT turn an arbitrary desktop `Exec=` string into a shell command.

DeckDepot does not execute applications. Desktop files MAY be used for presentation metadata only after safe parsing. Steam shortcut construction (executed later **by Steam**) MUST use the validated Flatpak application ID plus explicit installation scope, not reconstructed `Exec=` text. See §8.1 and §11.4.

## 5.5 SteamGridDB key

If SteamGridDB support is enabled:

- never log the key;
- never commit the key;
- store it only in the plugin's resolved writable settings/data area;
- use user-only file permissions where applicable;
- provide a delete/reset action;
- prefer backend requests if the backend TLS gate passes.

## 5.6 AppMan trust disclosure

AppMan/AM consumes a database of installation scripts. That trust model is materially different from Flatpak.

The AppMan provider MUST clearly identify its source/provider and MUST NOT silently present AppMan packages as equivalent to Flathub sandboxed Flatpaks.

---

# 6. Decky frontend/backend bridge

## 6.1 RPC

**[VERIFIED-UPSTREAM]**

Frontend-to-Python calls MUST use the current `@decky/api` `callable` mechanism.

Minimum backend RPC surface for the Flatpak v1.0 mutation path (M1, completed):

```text
get_environment_info()
get_installed_apps()
get_task_status(task_id)
start_install(app_id)
start_update(app_id)
start_uninstall(app_id)
cancel_task(task_id)
get_local_app_metadata(app_id)
check_flathub_remote()
add_flathub_remote()
```

There is **no** production `launch_application` RPC. Do not add one.

M1 `get_installed_apps()` is user-scoped and MUST remain that mutation-engine contract. Read-only system inventory is added later (M4) as an explicit scoped query or as additional rows with `installationScope: "system"`. Do not reopen the M1 engine solely to add `--system` listing.

SteamClient operations remain frontend-side because they execute in the Steam CEF context.

## 6.2 Events

**[CORRECTED]**

Python-emitted Decky events MUST be consumed through `@decky/api` `addEventListener` / `removeEventListener`.

Do NOT use `window.addEventListener` for `decky.emit` events.

Prefer one stable task event:

```text
linux-store:task-event
```

with `taskId` in the payload instead of dynamically registering a browser event name per task.

Backend event emission MUST follow the current Decky template contract, including awaiting `decky.emit(...)` when required by the current API.

All frontend listeners MUST be removed during plugin dismount.

## 6.3 Backend lifecycle

`main.py` MUST implement:

- `_main` — initialize backend state and diagnostics;
- `_unload` — stop/terminate plugin-owned tasks and remove temporary resources;
- `_uninstall` — clean plugin-owned persistent files only; do not uninstall user applications automatically.

Backend unload MUST NOT kill unrelated Flatpak/AppMan processes.

---

# 7. Flatpak engine

Flatpak support is the first production provider.

**M1 status (2026-09-16): implemented and device-tested.** The working user-scope engine remains authoritative for v1.0 mutation operations. Do not rewrite it because later research found additional future requirements.

Preserve in production:

- `asyncio.create_subprocess_exec`;
- argument-array execution;
- no shell command strings;
- no `shell=True`;
- user-scoped mutations (`--user`);
- post-mutation reconciliation via re-query;
- owned process-group cancellation;
- typed task/error state;
- no fake progress parsing;
- no rollback uninstall after failed install;
- validated Flatpak IDs;
- exact user-scope semantics.

## 7.1 Scope

M1 manages **user-scoped application mutations only**.

v1.0 MAY **read** system-scoped installations (M4) but MUST NOT silently or explicitly modify them.

Do not assume `app_id` uniquely identifies an installed Flatpak instance. Use `(app_id, installation_scope)` at least, with scope `user` or `system`.

## 7.2 Binary discovery

Resolve the Flatpak executable using `shutil.which("flatpak")`.

If Flatpak is absent:

- return a typed backend capability error;
- disable Flatpak mutation controls;
- do not attempt to install Flatpak using the OS package manager.

## 7.3 Installed application query

**[CORRECTED]**

The original `active-commit` column is invalid.

Use the validated command contract:

```text
flatpak list --user --app --columns=application,name,version,branch,arch,origin,active
```

The Phase 0 Flatpak contract test MUST execute this exact command on the target and capture its headerless/tabular output before production parsing is accepted.

Parsing MUST:

- preserve empty columns;
- reject malformed rows without crashing the whole query;
- surface backend query failure distinctly from an empty application list.

A successful list with zero applications is **not** a failed query. Do not return `[]` for every backend error. Distinguishing:

```text
successful request with zero results
```

from

```text
request/backend/network/remote failure
```

is mandatory for installed lists, remotes, and update discovery.

`.Locale`, `.Debug`, `.Sources`, other partial refs, and related runtime refs are not normal store applications. The store installed-apps surface remains `--app`. Partials MAY appear as related refs during an update and MUST NOT be counted as additional store apps.

## 7.4 Flathub remote

On startup, check whether a user-scoped `flathub` remote exists.

Do NOT silently mutate remotes on every plugin load.

If Flathub is missing:

1. explain that the store needs a user-scoped Flathub remote;
2. ask the user to enable it;
3. after confirmation run:

```text
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
```

4. check the process return code and surface stderr on failure.

## 7.5 Install

The production CLI path is:

```text
flatpak install --user -y --noninteractive flathub <validated-app-id>
```

M1 uses the validated application ID. Later update/integration milestones MUST prefer full ref identity (`app/<id>/<arch>/<branch>`) when branch/arch is not unique. Do not assume app ID alone is always sufficient. **Do not change completed M1 code solely for this rule**; apply it where mutations are extended (M5).

On success:

- re-query installed Flatpaks;
- update UI state from the re-query, not from optimistic assumptions.

On failure:

- report exit code and sanitized stderr;
- do NOT automatically call uninstall as a generic rollback;
- re-query current state because an interrupted transaction may have partially changed refs/runtimes.

## 7.6 Progress

**[CORRECTED]**

Delete the original regex that attempted to parse percentage/speed from `flatpak install --noninteractive`.

The CLI-based v1.0 path reports phase-level progress only:

```text
STARTING -> RUNNING -> COMPLETED | FAILED | CANCELLED
```

The UI uses an indeterminate progress indicator during `RUNNING`.

Exact percentage/speed MAY be added later only if a supported libflatpak/PyGObject/D-Bus interface is proven viable on the Decky runtime.

## 7.7 Cancellation

Backend task processes SHOULD be started so the plugin can terminate only the process group it owns.

Cancellation flow:

1. mark task `cancelling`;
2. request termination of the owned child/process group;
3. after a bounded grace period, kill only the still-owned process group if necessary;
4. wait for process exit;
5. re-query Flatpak state;
6. emit `cancelled` with the reconciled package state.

Cancellation MUST NOT imply automatic removal of an application or its data.

## 7.8 Update

**[DEVICE-GATE: FLATPAK-UPDATE-CONTRACT]**

Do not compare Flathub display versions to determine whether a Flatpak update exists.

Phase 0 MUST verify the current Flatpak-supported update query on the target Flatpak version. The production implementation MUST use Flatpak's own ref/update semantics.

When the user explicitly updates an identified **user-scoped** app, the mutation path SHOULD use the current supported equivalent of:

```text
flatpak update --user -y --noninteractive <validated-app-id>
```

Do **not** pass `--no-deps` or `--no-related`. **[REFERENCE-IMPLEMENTATION]** AutoFlatpaks hit regressions when update discovery used `--no-deps` and new runtime/`.Locale` refs appeared as separate install operations (`op: i`). An application update MAY install additional related runtime refs. Required dependencies MUST NOT be suppressed.

The exact discovery/listing command for available updates is fixed only after the gate result is recorded.

**Device result (2026-09-16, Flatpak 1.18.2):** Discovery is:

```text
flatpak remote-ls --updates --user --app --columns=application,version,branch,arch,origin,commit,ref
```

Empty stdout with exit 0 means no updates. That empty success is **not** equivalent to a failed query (non-zero exit, unreachable remote, transport error). Display versions are not sufficient: a downgraded `org.kde.kwrite` kept marketing version `26.04.3` while this command listed a newer commit. `flatpak list --columns=latest` stayed `-` and is not a discovery API. `flatpak outdated` and `update --dry-run` do not exist. Mutation remains `flatpak update --user -y --noninteractive <app-id>`. PluginLoader must sanitize `LD_LIBRARY_PATH` as in P0.5.

Additional v1.0 update-surface rules (M5; do not rewrite M1):

- prefer full ref identity when app ID/branch is ambiguous;
- update counts MUST remain consistent when related refs appear during an update (do not treat `.Locale` / runtime pulls as extra store applications);
- installed / remote / update result sets MAY differ legitimately;
- broken or unreachable remotes MUST produce a distinguishable degraded/error state;
- include a concrete test: app update that pulls a new dependency / `.Locale` ref (AutoFlatpaks new-dependency / `.Locale` regression).

v1.0 MUST NOT run `flatpak update --system`.

## 7.9 Uninstall

Use the current user-scoped Flatpak uninstall command for the application.

Default uninstall MUST NOT claim to remove all application data or all runtimes.

If a future UI offers "delete app data", it MUST be an explicit separate choice and map to a documented Flatpak option.

## 7.10 Direct launch — closed historical rejection (not deferred)

**[DEVICE-OBSERVED / DEVICE-GATE: GAMING-MODE-LAUNCH = FAIL_USE_FALLBACK]**

Direct application launching is **not** a v1.0 feature, **not** postponed, and **not** waiting on a better gamescope hack.

Do not implement:

- an in-plugin Launch button;
- a production `launch_application` RPC;
- production `flatpak run` from the DeckDepot backend.

P0.11 is a **closed historical spike**. Keep the measurement so a future implementer cannot revive the design as “deferred until later.”

Measured on this Bazzite/gamescope `--steam` client (2026-09-16):

1. PluginLoader has no `DISPLAY`. Bare `flatpak run` aborted (RetroArch exit 1; Dolphin `could not connect to display` / 134).
2. Borrowing Steam's `DISPLAY=:1` starts the app. PPSSPP created a 1280×720 X11 window on `:1`.
3. That window stays under Steam Big Picture Mode. `GAMESCOPE_FOCUSED_APP` remained `769`. Setting `STEAM_GAME` on the window did not steal focus.

Steam shortcut `launchOptions` MAY still contain `run --user <validated-app-id>` or `run --system <validated-app-id>` so **Steam** can start the app from the library after optional Add to Steam. That is Steam executing a shortcut, not plugin-side loading.

The former implementation milestone “M6 — Direct launch” is **removed**. Later milestones were renumbered. Do not recreate it.

## 7.11 System-scope discovery vs mutation

**[DEVICE-OBSERVED]** System Scope Spike, 2026-09-16, Bazzite `44.20260915.0`, Flatpak `1.18.2`, Decky `v3.2.9`, plugin `flags: []`, backend uid/gid `1000`.

Conclusion: **SYSTEM MUTATIONS REQUIRE A NEW PRIVILEGE DESIGN**.

| Operation | Non-root PluginLoader subject | Notes |
|---|---|---|
| `flatpak list --system` | Works unprivileged | Also `flatpak remotes --system`. System `flathub` was already present (`filtered`). |
| `flatpak update --system` | Authorization `auth_admin` | No safe real update was mutated. `pkcheck` on the backend PID returned `auth_admin`. |
| `flatpak install --system` | Authorization `auth_admin` | Interactive check: authentication required but **no polkit agent** for that subject. |
| `flatpak uninstall --system` | Authorization `auth_admin` | Same subject. Not executed; test app was not installed. |

The Decky backend process:

- runs as the same uid as the desktop user;
- may have the same `wheel` membership;
- is **not** associated with the user's active login session (`loginuid` unset, `system.slice/plugin_loader.service`);
- has **no usable polkit authentication agent**;
- therefore cannot satisfy `auth_admin` from Gaming Mode.

**Do not treat the host user's interactive shell as equivalent evidence.** That shell is an active/local polkit subject and, on this image, `pkcheck` for `org.freedesktop.Flatpak.app-install` returned `yes` without a password because of the bundled wheel rule (`subject.active && subject.local && subject.isInGroup("wheel")`).

**[OFFICIAL-UPSTREAM-SOURCE]** Flatpak system mutations go through `flatpak-system-helper` and polkit `org.freedesktop.Flatpak.*`. Install/uninstall default to `auth_admin` / `auth_admin_keep`. Signed updates use `allow_active=yes` only for an **active** session. The PluginLoader child is not that subject, so even updates require `auth_admin`.

v1.0 policy:

- MAY run read-only system queries (`list --system`, remotes, inventory needed to know what is installed);
- MUST NOT mutate system apps or remotes;
- MUST NOT install custom polkit rules;
- MUST NOT enable Decky `_root` solely for system Flatpaks.

Read-only system discovery belongs in **M4**, not a reopen of M1. System mutation is **post-v1.0** (§27).

---

# 8. Flatpak metadata and desktop integration

## 8.1 Do not reconstruct `Exec=`

**[CORRECTED]**

The original implementation stripped `%u`, `%U`, `%f`, `%F`, `@@u`, and `@@` from arbitrary `Exec=` text. That implementation is removed.

For Steam shortcut construction, derive the command from the verified Flatpak application ID **and installation scope**, not desktop-file `Exec=`. DeckDepot itself does not execute apps. Steam, not DeckDepot, executes the created shortcut.

Example `launchOptions` (capability-tested in the Steam milestone; do not invent a spike during this freeze):

```text
user app:    run --user <validated-app-id>
system app:  run --system <validated-app-id>
```

Preserve installation scope explicitly. System installation does **not** by itself prevent Add-to-Steam. Add-to-Steam for an already-installed system Flatpak is a separate capability from Flatpak mutation.

## 8.2 Desktop-file discovery

Flatpak may export more than only `<APP_ID>.desktop`. Upstream conventions permit forms including:

```text
$FLATPAK_ID.desktop
$FLATPAK_ID.foo.desktop
$FLATPAK_ID-foo.desktop
```

When Flathub/AppStream metadata supplies a `launchable` desktop ID, use that as the preferred presentation/desktop-file mapping.

For installed apps without catalog metadata:

- use the Flatpak ID/name from `flatpak list`;
- resolve icons from exported Flatpak icon directories using bounded known paths;
- do not recursively scan arbitrary user directories;
- fall back to a generic store icon when no trustworthy icon can be resolved.

## 8.3 Local metadata

For a known installed Flatpak, the minimum metadata needed for Steam integration is:

- validated Flatpak app ID;
- display name;
- resolved Flatpak executable path;
- optional local icon path.

No parsed desktop command is required.

---

# 9. Flathub catalog adapter

## 9.1 API baseline

The Flathub v2 endpoints used by the project are treated as an external API whose schema must be validated at runtime.

Known useful endpoints include:

```text
POST https://flathub.org/api/v2/search
GET  https://flathub.org/api/v2/appstream/<app-id>
```

The original hard-coded response interfaces are deleted.

**[CORRECTED]** Do not model AppStream metadata as `icons[]` / screenshot `sizes[]` merely because the old document did. Current observed v2 responses use fields such as singular `icon`, `urls`, `launchable`, `bundle`, and screenshot objects whose available sizes are represented by dimension keys.

## 9.2 Runtime validation

All Flathub responses MUST pass runtime shape validation before entering application state.

Recommended approach: Zod schemas with tolerant optional fields.

The adapter MUST:

- accept absent optional metadata;
- ignore unknown fields;
- reject structurally unusable records;
- never trust remote HTML as already sanitized.

## 9.3 Search

Search uses:

```http
POST /api/v2/search
Content-Type: application/json

{
  "query": "<user query>",
  "filters": []
}
```

The exact returned search record schema MUST be frozen by the Phase 0 schema test against current live responses.

Search failure MUST show a retryable error state, not fabricated cached application data unless a real cache exists.

A successful search that returns zero hits MUST be presented as an empty result, not as a network/backend failure. A CEF/network/HTTP/schema failure MUST be presented as an error, not as zero hits. The existing error model MAY express this without new enum names, but the semantic distinction is mandatory.

## 9.4 Categories

**[DEVICE/SCHEMA-GATE: FLATHUB-CATEGORY]**

The original `/category/<category>?page=...&per_page=...` contract was not sufficiently established.

Do not implement it until one of these is verified:

- a current authoritative category endpoint; or
- a supported search-filter/category mechanism.

Until then, v1.0 may provide curated local category chips that issue verified searches/filters, or omit category browsing.

## 9.5 Details

Application details use the validated `/appstream/<app-id>` response.

Details retrieval MUST distinguish a successful empty/partial-optional payload from HTTP/network/schema failure.

Prefer:

- plain/sanitized description;
- current icon URL;
- screenshots;
- developer;
- license;
- homepage;
- release metadata when present;
- `launchable.value` for desktop-ID mapping;
- bundle/ref metadata when present.

## 9.6 Performance

Do not use a fixed `<500 ms` network response requirement.

Success is:

- UI remains responsive;
- search is debounced;
- requests are cancellable/replaceable when the query changes;
- loading state appears promptly;
- timeouts/retries are bounded;
- errors are recoverable.

---

# 10. Full-screen UI and Decky navigation

## 10.1 Route

The plugin registers a full-screen route such as:

```text
/decky-linux-store
```

and removes it on dismount.

Current Decky has working full-screen route support, but transition details remain client-sensitive.

## 10.2 QAM entry

The Quick Access Menu entry MUST contain one primary action:

```text
Open Linux App Store
```

Activation navigates to the full-screen route.

**[DEVICE-GATE: ROUTE-QAM]** Phase 0 determines whether `Navigation.CloseSideMenus()` is required before/after navigation on the tested Steam client.

**Device result (2026-09-16, this Bazzite client):** `CloseSideMenus()` is not required. `Navigation.Navigate("/deckdepot")` alone hides the QAM and B/back returns to the previous Steam surface. The other two CloseSideMenus orderings also worked and are not harmful.

## 10.3 Controller behavior

The full-screen interface MUST be controller-first.

Requirements:

- all actionable elements are focusable using current Decky UI patterns;
- predictable directional movement;
- visible focus state;
- B/back returns to the previous store surface or Steam surface as appropriate;
- modal close restores focus to the originating element where feasible;
- long grids use virtualization/pagination if needed to avoid focus lag.

## 10.4 Search input

Do not depend on the original invented `SteamClient.System.ShowKeyboard(mode, initialText, description)` signature.

Use the current Decky/Steam-supported text-entry pattern proven by the Phase 0 UI test.

---

# 11. SteamClient integration

SteamClient is an undocumented/internal interface and MUST be isolated behind a small adapter.

## 11.1 Type policy

**[CORRECTED]**

Use current Decky-maintained SteamClient types where available.

Do not maintain a hand-written global `steam.d.ts` that declares methods not present upstream.

At runtime, feature-detect every undocumented method used by the plugin.

## 11.2 Current verified contracts

As of the evidence baseline, current Decky-maintained typings expose:

```ts
Apps.AddShortcut(
  appName: string,
  executablePath: string,
  directory: string,
  launchOptions: string
): Promise<number>;
```

and:

```ts
Apps.SetCustomArtworkForApp(
  appId: number,
  base64: string,
  imageType: "jpg" | "png",
  assetType: ELibraryAssetType
): Promise<void>;
```

They also expose shortcut setters including:

```text
SetShortcutExe
SetShortcutIcon
SetShortcutLaunchOptions
SetShortcutName
SetShortcutStartDir
```

and `RemoveShortcut`.

The original five-argument `AddShortcut` and path-based three-argument `SetCustomArtworkForApp` are removed.

## 11.3 Unsupported original method

**[CORRECTED / DEVICE-GATE: SHORTCUT-ENUMERATION]**

Do not call `SteamClient.Apps.GetShortcuts()`.

It is not part of the verified current `Apps` interface.

Phase 0 must inspect the live CEF environment and current Decky/Steam stores for a supported shortcut enumeration/readback mechanism.

If no reliable mechanism exists, production duplicate protection falls back to a plugin-owned registry:

```text
provider + appId -> returned Steam appId
```

The registry MUST tolerate stale entries and provide a recovery/reset mechanism.

## 11.4 Shortcut creation

For a Flatpak:

```text
name          = resolved display name
executable    = resolved absolute flatpak executable
working dir   = directory containing the flatpak executable or a device-validated safe directory
launchOptions = run --user <validated-app-id>
                OR, for a system-scoped installation:
                run --system <validated-app-id>
```

Call the verified four-argument `AddShortcut`.

Important: the final launch options are passed in the `AddShortcut` call itself. Production creation therefore MUST NOT call `SetAppLaunchOptions` merely to repeat the same launch options after creation.

Steam, not DeckDepot, executes that shortcut. Capability-test `--system` launch options in the Add-to-Steam milestone. Do not assume system installation blocks Add-to-Steam.

## 11.5 Shortcut readiness is eventually consistent — no magic 500 ms rule

**[CORRECTED]**

Delete the statement "a minimum 500 ms delay is strictly required."

**Do not use an arbitrary fixed 500 ms delay for AddShortcut readiness.**

Steam application/shortcut state MAY hydrate asynchronously. A missing field on the first read does **not** automatically mean:

- the shortcut does not exist;
- the API failed;
- the capability is unsupported.

The readiness behavior of newly created shortcuts is a **[DEVICE-GATE: SHORTCUT-READINESS]** (already `PASS_WITH_LIMITATIONS` on this target).

For future shortcut readiness logic, prefer bounded observable-state verification using currently verified Steam APIs. **[DEVICE-OBSERVED]** `AddShortcut` returns an AppID immediately; `appStore.GetAppOverviewByAppID` first populated at ~256 ms; `SetShortcutName` after the overview exists does stick. **[REFERENCE-IMPLEMENTATION]** SteamGridDB hydrates by registering for app-details changes, then polling/re-reading app overview state (`getAppDetails` then `getAppOverview`). Where supported by current evidence, production MAY:

- register for app-details changes;
- poll/re-read app overview state;
- verify materialized shortcut state;
- use `SetShortcutName` only where current evidence shows it is an appropriate refresh mechanism (already measured on this client).

Optional post-create mutation such as icon/name/start-dir adjustments must use the measured strategy from the gate:

- observable readiness + setter + readback, if a readback mechanism exists; or
- a bounded retry policy proven empirically, if no readback API exists.

A hardcoded 500 ms sleep MUST NOT be described as a correctness guarantee for AddShortcut.

Artwork-clear timing is a **separate** behavior. **[REFERENCE-IMPLEMENTATION]** SteamGridDB waits after `ClearCustomArtworkForApp`. That does not revive a global 500 ms AddShortcut rule. Artwork clear MAY use its own bounded wait/readback strategy under STEAM-ARTWORK.

## 11.6 Returned AppID

Use the AppID returned by `AddShortcut` as the primary runtime identifier.

Do not derive the shortcut AppID from CRC32 unless a feature genuinely requires a derived ID and the formula has passed the identity gate.

## 11.7 CRC32 formula

**[DEVICE-GATE: SHORTCUT-ID-FORMULA]**

The historical non-Steam shortcut CRC32 formula MAY be tested for compatibility, but it is not a primary production contract.

Phase 0 compares the formula against IDs actually returned/persisted by Steam across multiple shortcuts.

## 11.8 Persistence

**[DEVICE-GATE: SHORTCUT-PERSISTENCE]**

"Visible immediately" and "durably written to Steam storage" are separate properties.

The gate MUST test:

- immediate library visibility;
- normal Steam restart;
- plugin reload;
- system reboot;
- abnormal Steam termination where safe to test.

The UI MUST NOT claim a stronger durability guarantee than the experiment supports.

---

# 12. Steam artwork and SteamGridDB

## 12.1 Live artwork path

The primary artwork path uses `SetCustomArtworkForApp` with:

- returned Steam AppID;
- base64 image data;
- `"png"` or `"jpg"`;
- an `ELibraryAssetType` value from the current Decky/Steam type.

**[REFERENCE-IMPLEMENTATION]** Current `SteamGridDB/decky-steamgriddb` uses `@decky/api` / `@decky/ui`, four-argument `SetCustomArtworkForApp(appId, base64, "png", eAssetType)`, and backend HTTPS via `get_ssl_context()`. Those are observed practices, not copied code and not a permanent Steam contract.

Do not use the original file-path-based signature.

Do not directly write Steam grid files as the normal live-art mechanism.

Do not make direct `shortcuts.vdf` manipulation DeckDepot's primary implementation for Add-to-Steam or artwork.

## 12.2 Device validation

**[DEVICE-GATE: STEAM-ARTWORK]**

Capsule/grid/hero/logo behavior MUST be capability-tested. For every asset type the plugin intends to support:

1. apply known PNG/JPEG test data;
2. verify immediate appearance;
3. verify replacement;
4. verify clearing when supported (bounded wait/readback; not a global 500 ms AddShortcut rule);
5. restart Steam and inspect persistence;
6. record the actual enum value/type mapping.

Only asset types that pass this gate may be exposed in production. On this target, Capsule magenta PNG was visually confirmed in the Gaming Mode library grid. Other types are not claimed until seen.

## 12.3 SteamGridDB provider — minimal automation

SteamGridDB integration is optional and intentionally **small**. DeckDepot is not a replacement for the dedicated SteamGridDB Decky plugin.

v1.0 behavior:

1. Search SteamGridDB using the application's resolved display name.
2. Use the **first returned game result**.
3. For each supported artwork category:
   - request artwork;
   - use the **first returned image**.
4. Apply only categories supported by DeckDepot's verified Steam artwork capability gate.
5. Missing categories/assets are skipped gracefully.
6. SteamGridDB artwork failure MUST NOT cause the underlying Add-to-Steam operation to fail.

DeckDepot MUST NOT implement:

- result-selection UI;
- alternate game-match selection;
- artwork browsing;
- image-choice UI;
- pagination for artwork selection;
- style filtering;
- cropping;
- positioning UI;
- manual artwork management;
- a full SteamGridDB client.

Users wanting detailed artwork customization are expected to use the dedicated **SteamGridDB Decky plugin**.

**[CORRECTED]** Do not promise that all asset slots will exist. Do **not** require explicit result selection when autocomplete is ambiguous; v1.0 takes the first game result by design.

Do not copy substantial GPL implementation code. Do not copy or reuse the SteamGridDB plugin's embedded API key.

## 12.4 Shortcut icons vs library artwork

Normal library artwork (`SetCustomArtworkForApp`, base64 input, capability testing, bounded verification) is separate from non-Steam **shortcut icon** behavior.

**[REFERENCE-IMPLEMENTATION]** SteamGridDB still uses `shortcuts.vdf` for some non-Steam icon persistence because live artwork APIs do not cover that slot reliably. That workaround does **not** license VDF as DeckDepot's primary path. Shortcut icon handling is a separate and less-proven path. If a reliable live shortcut-icon path cannot be verified, **omit the custom shortcut icon from v1.0**.

Shortcut logos MAY require persisted logo-position state if current Steam behavior requires it (`SaveCustomLogoPosition` or equivalent). Do not force feature parity with the dedicated SteamGridDB plugin.

## 12.5 API-key handling

See Security §5.5.

If secure backend HTTPS is not available on a target runtime, SteamGridDB support MAY be disabled until a safe request path is established rather than exposing a secret through an unreviewed path.

---

# 13. AppMan / AM provider

AppMan is a planned provider, not part of the Flatpak v1.0 dependency chain.

## 13.1 Scope

Use **AppMan/local mode**, not privileged system-wide AM, for Decky integration.

The provider MUST remain rootless.

Current upstream AppMan/AM supports concepts including:

- local installation;
- query/list;
- install;
- remove;
- update;
- local desktop launchers;
- non-interactive initial application location through `appman_location`.

However, it is script/database-driven and requires a separate programmatic-contract validation.

## 13.2 Provider gate

**[PROVIDER-GATE: APPMAN-CONTRACT]**

Before production `AppManProvider` code, the diagnostic harness MUST determine:

1. how to detect `appman` and its version;
2. exact query/search commands;
3. exact installed-list command;
4. whether machine-readable output exists;
5. exit-code guarantees;
6. install command and prompt behavior;
7. remove command and confirmation behavior;
8. update detection/update command;
9. cancellation behavior;
10. installation directory configuration;
11. desktop-file creation timing and naming;
12. architecture handling;
13. behavior for third-party databases;
14. trust implications of installation scripts;
15. whether the project uses a user-installed AppMan or vendors/pins a known version.

Until this gate passes, the UI MUST NOT advertise AppMan installs as implemented.

## 13.3 Installation location

If AppMan support is enabled, the plugin MUST use a user-controlled writable location and MUST NOT require `/opt` or root.

The first-use UX must clearly display the chosen local application directory.

## 13.4 Provider abstraction

The frontend provider contract may expose:

```ts
interface IPackageProvider {
  readonly providerId: ProviderId;
  readonly displayName: string;

  search(query: string): Promise<AppSummary[]>;
  getAppDetails(appId: string): Promise<AppDetails>;
  getInstalledApps(): Promise<AppSummary[]>;

  install(appId: string): Promise<string>;   // taskId
  update(appId: string): Promise<string>;
  uninstall(appId: string): Promise<string>;
}
```

Provider-specific capability flags SHOULD be exposed separately rather than pretending every provider supports identical features.

For Flatpak v1.0, `install` / `update` / `uninstall` apply only to user-scoped instances. System-scoped rows are inventory plus optional Add-to-Steam, not mutation targets.

---

# 14. SteamOS and Bazzite compatibility

## 14.1 Home directory

**[VERIFIED-UPSTREAM]**

Use `decky.DECKY_USER_HOME` when available.

Never hardcode `/home/deck`.

The Phase 0 environment dump records `DECKY_USER_HOME` and `$HOME` on each tested system.

## 14.2 Immutable operating systems

The plugin MUST NOT mutate the base operating system.

On Bazzite, avoid assumptions that the entire filesystem is read-only; the relevant design rule is simply that the plugin must not layer/modify host system packages.

## 14.3 Python version

**[CORRECTED]**

Do not require "Python 3.11+" as an unverified Decky portability guarantee.

Write backend code against the Python version shipped/supported by the current target Decky Loader and record the version in the device matrix.

## 14.4 TLS

The earlier blanket claim "SteamOS embedded Python lacks certificates" is too broad as a universal rule, but the rebuttal correctly identifies it as a real historical/current deployment concern.

Production rule:

- do not assume backend HTTPS works;
- run the TLS capability gate;
- use the validated CEF or Decky-supported SSL path.

**[DEVICE-OBSERVED]** `helpers.get_ssl_context()` works on this Decky v3.2.9 runtime; stdlib verification does not. **[REFERENCE-IMPLEMENTATION]** SteamGridDB's plugin uses the same helper. Record it as a candidate, not an eternal contract.

## 14.5 Architecture

Do not hardcode `x86_64` into icon/catalog paths.

Record the host architecture and use metadata returned by Flatpak/Flathub where relevant.

## 14.6 PluginLoader vs interactive-shell authorization

**[DEVICE-OBSERVED]** See §7.11.

A uid-1000 `wheel` user in an active local session MAY be able to mutate system Flatpaks without a password. The Decky PluginLoader child with the same uid MAY receive `auth_admin` and have no polkit agent. v1.0 therefore does not implement system mutations, regardless of what an interactive terminal can do.

---

# 15. Phase 0 — mandatory architecture validation harness

Phase 0 is part of this implementation, not a separate planning document.

Build a minimal Decky plugin skeleton with a dev-only full-screen `DiagnosticsRoute`. The diagnostics route MUST be removable/disabled for release builds.

Raw results MAY be stored under `spikes/results/`, but the decisions and pass/fail status MUST be copied into the Verification Ledger in §16.

## P0.1 Template/toolchain proof

Record:

- Decky Loader version;
- Steam client channel/build;
- OS/distribution;
- `@decky/api` version;
- `@decky/ui` version;
- Node/pnpm versions used for build;
- Python version;
- build success;
- plugin load/unload success.

Pass condition: official-template-derived plugin builds, installs, loads, unloads, and reloads without errors.

## P0.2 Full-screen route proof

Test:

- route registration;
- QAM button -> route;
- with and without `Navigation.CloseSideMenus()`;
- B/back behavior;
- repeated route enter/exit;
- plugin dismount while route exists;
- plugin reload.

Pass condition: one transition strategy works repeatedly without trapping focus or leaving a broken route.

## P0.3 Decky event bridge proof

Backend emits a small typed payload periodically/on demand.

Frontend receives it using `@decky/api` event APIs.

Test repeated load/unload to confirm no duplicate listener accumulation.

Pass condition: events arrive exactly once per emission and listeners are removed on dismount.

## P0.4 Environment + TLS proof

Backend records:

- `DECKY_USER_HOME`;
- `$HOME`;
- Python version;
- default SSL verify paths;
- available Decky SSL/helper functions relevant to HTTPS;
- `which flatpak`;
- `flatpak --version`;
- host architecture.

Perform one HTTPS GET to a harmless known endpoint using:

1. ordinary Python standard-library SSL path;
2. current Decky SSL helper if available.

Pass condition: document which backend HTTPS method actually works. If neither is reliable, keep external public requests in the CEF frontend.

## P0.5 Flatpak command-contract proof

Run and capture stdout/stderr/return codes for:

```text
flatpak list --user --app --columns=application,name,version,branch,arch,origin,active
```

Also capture a test install/update/uninstall using a disposable/lightweight test app chosen at test time.

Capture install output:

- normally piped;
- with `--noninteractive`;
- under `LC_ALL=C` if useful.

Pass condition: installed-list parser contract is established; production code does not depend on human progress output.

## P0.6 Flatpak update-discovery proof

Determine the current Flatpak-supported method for listing user-scoped application updates.

Pass condition: the command/API is documented in the ledger and does not compare Flathub marketing version strings.

## P0.7 SteamClient capability dump

From the live CEF context, record the presence/type of:

```text
Apps.AddShortcut
Apps.RemoveShortcut
Apps.SetAppLaunchOptions
Apps.SetShortcutExe
Apps.SetShortcutIcon
Apps.SetShortcutLaunchOptions
Apps.SetShortcutName
Apps.SetShortcutStartDir
Apps.SetCustomArtworkForApp
Apps.ClearCustomArtworkForApp
```

Also inspect for a demonstrable shortcut enumeration/readback mechanism without assuming `GetShortcuts`.

Do not dump private Steam account data; record method/capability names only.

Pass condition: production adapter is generated from actual available capabilities plus current Decky types.

## P0.8 Shortcut creation/readiness proof

Create disposable shortcuts using final launch options directly in `AddShortcut`.

For any post-create setter that is needed:

- test at immediate, 50 ms, 100 ms, 250 ms, 500 ms, 1 s, and bounded longer intervals;
- determine whether there is an observable readiness/readback mechanism;
- repeat enough times to distinguish a stable condition from a lucky run.

Pass condition: production code uses the measured readiness strategy. No mandatory fixed 500 ms rule survives unless repeated data specifically justifies it for a narrowly scoped fallback.

## P0.9 Shortcut identity/persistence proof

For multiple disposable shortcuts:

- record returned AppID;
- compare with the historical CRC32 formula;
- test normal Steam restart;
- test Decky/plugin reload;
- test system reboot;
- if safe, test abnormal Steam shutdown.

Pass condition: document what can actually be considered live vs durable and whether the CRC32 formula is needed at all.

## P0.10 Artwork proof

For each current `ELibraryAssetType` needed by the UI:

- set known PNG/JPEG base64;
- verify immediate display;
- replace it;
- clear it when supported;
- restart Steam;
- record persistence.

Pass condition: only proven asset types are enabled in release UI.

## P0.11 Gaming Mode launch proof — closed historical spike

**Closed. Rejected. Not deferred.** Direct plugin launch is omitted from v1.0 and MUST NOT return as a later “nice to have” in this baseline.

Recorded result: backend `flatpak run` is not an acceptable Gaming Mode loader on this target. Do not spend further implementation time on gamescope focus hacks, `RunGame` argument fishing, or a Launch button.

Pass condition: ledger row is `FAIL_USE_FALLBACK`; production has no Launch action and no `launch_application` RPC.

## P0.12 Flathub schema proof

Capture current live examples for:

- search;
- appstream details;
- category/filter mechanism if used.

Generate/update runtime validation schemas from observed/current authoritative contracts.

Pass condition: no production TypeScript interface depends on the old fictitious `icons[]`/`sizes[]` model.

---

# 16. Verification Ledger

Cursor/implementing agents MUST update this table after running the corresponding spike. Do not mark a row PASS from source reading alone when the row is explicitly a device gate.

| Gate | Initial status | Result to record | Production consequence |
|---|---|---|---|
| TEMPLATE-BUILD | PASS | 2026-09-16 Bazzite: official-template plugin built (`pnpm run build`), installed from ZIP, loaded, unloaded, and reloaded without errors. Evidence in `journalctl -u plugin_loader.service` (21:38 ZIP install; 21:39 and 21:47 unload/load cycles). Runtime: Decky `v3.2.9`, Decky Python `3.11.7`, `@decky/api@1.1.3`, `@decky/ui@4.11.0`, Node `v26.8.2`, pnpm `12.3.4`, Bazzite `44.20260915.0` / `bazzite-deck`, arch `x86_64`. Steam client files show `steam_client_ubuntu12.manifest` version `1788652215` plus `steam_client_steamdeck_stable_ubuntu12.manifest` (file-derived, not a SteamClient API). | blocks all later milestones |
| ROUTE-QAM | PASS | 2026-09-16 Gaming Mode on this Bazzite/Steam/Decky client: all three QAM strategies opened `/deckdepot` full-screen, hid the QAM, and **B** returned to the previous Steam surface without trapped focus. `Navigation.Navigate("/deckdepot")` alone is sufficient; `Navigation.CloseSideMenus()` is **not required** before or after navigate, but is also safe. Chosen production sequence: `Navigation.Navigate("/deckdepot")`. | blocks full-screen release route |
| DECKY-EVENTS | PASS | 2026-09-16: `deckdepot:diagnostic-event` emitted via `await decky.emit` and received via `@decky/api` `addEventListener` (not `window.addEventListener`). Files `~/homebrew/data/DeckDepot/p0-events-emitted.jsonl` and `p0-events-received.jsonl`: 9 emits, 9 receipts, each `backendInstanceId+sequence` exactly once, receive latency 0–1 ms. Instance `0cc1ed92` sequences 1–8; after unload/reload instance `7be48dfc` sequence 1 received once (no stacked listeners). Typed dict payload preserved. | blocks task event UI |
| BACKEND-TLS | PASS_WITH_LIMITATIONS | 2026-09-16 Decky runtime: Python stdlib HTTPS to `https://example.com/` failed with `CERTIFICATE_VERIFY_FAILED` / unable to get local issuer certificate (`cafile`/`capath` null; OpenSSL paths `/usr/lib/ssl/cert.pem`). `helpers.get_ssl_context()` (also importable as `decky_loader.helpers.get_ssl_context`, using bundled certifi) succeeded HTTP 200 with verification enabled. Production backend HTTPS MUST use that helper; do not use default stdlib verification. Public catalog should still prefer CEF/frontend fetch. Host `flatpak --version` from inside PluginLoader failed because Decky’s PyInstaller `LD_LIBRARY_PATH` OpenSSL (`OPENSSL_3.2.0`/`OPENSSL_3.4.0` not found); binary path is `/usr/bin/flatpak`. Later Flatpak exec must sanitize the child environment. Snapshot: `~/homebrew/data/DeckDepot/p0-startup.json`. | controls backend network use |
| FLATPAK-LIST | PASS_WITH_LIMITATIONS | 2026-09-16 Flatpak 1.18.2. Exact command `flatpak list --user --app --columns=application,name,version,branch,arch,origin,active` is tab-separated, headerless, 7 columns; `active` is active commit (hex), not a boolean; names may contain spaces. Inside PluginLoader, inherited env fails (`OPENSSL_3.2.0`/`OPENSSL_3.4.0` via PyInstaller `LD_LIBRARY_PATH`); sanitized child env (`LD_LIBRARY_PATH` removed) exit 0, 13 rows, 0 malformed, `Flatpak 1.18.2`. `LC_ALL=C` does not change the table. Host install of disposable `org.kde.kwrite`: piped `-y` prints percentage bars (do not parse); `--noninteractive` prints phase lines only; update when current is `Nothing to update.`; uninstall `--noninteractive` prints `Uninstalling app/...`. Production list/mutation MUST use `asyncio.create_subprocess_exec` with sanitized env, tab-split preserving empty columns, and must not treat exec failure as `[]`. Snapshots: `p0-flatpak-host.json`, `p0-flatpak-list.json`. | blocks installed-state parser |
| FLATPAK-UPDATE-CONTRACT | PASS_WITH_LIMITATIONS | 2026-09-16 Flatpak 1.18.2. Discovery command: `flatpak remote-ls --updates --user --app --columns=application,version,branch,arch,origin,commit,ref`. Empty stdout+exit 0 = no updates. Positive proof: downgraded disposable `org.kde.kwrite` to parent commit `a346741768a8…`; display version stayed `26.04.3` while `--updates` listed commit `95cbe5d36448`. After `flatpak update --user -y --noninteractive org.kde.kwrite`, `--updates` was empty again; app uninstalled. Do **not** use Flathub/list display versions. Do **not** use `list --columns=latest` (always `-`). `outdated` and `update --dry-run` unsupported. `--json` omitted commit on this version; prefer `--columns`. Snapshots: `p0-flatpak-updates-host.json`, `p0-flatpak-updates-downgrade.json`. | blocks Updates screen |
| FLATHUB-SEARCH | PASS_WITH_LIMITATIONS | 2026-09-16 live `POST https://flathub.org/api/v2/search` `{"query":"retroarch","filters":[]}` HTTP 200. Hits use `app_id` (dotted Flatpak ID), separate underscore `id`, string `icon` URL, string `main_categories`. Pagination: `page`/`hitsPerPage`/`totalPages`/`totalHits`. Guessed category filter object HTTP 500 — not used. Host capture `~/homebrew/data/DeckDepot/p0-flathub-schema.json`; CEF fetch still confirmed on `/deckdepot` mount after reload (`p0-flathub-schema-cef.json`). | blocks live catalog |
| FLATHUB-APPSTREAM | PASS_WITH_LIMITATIONS | 2026-09-16 `GET /api/v2/appstream/org.libretro.RetroArch` HTTP 200. `icon` string plus `icons[]` of `{url,width,height,type,scale}`; `screenshots[].sizes[]` use `src`/`width`/`height`/`scale`; `launchable.desktop-id` present. Old fictitious icons/sizes TS interfaces are not this contract. | blocks details view |
| FLATHUB-CATEGORY | PASS_WITH_LIMITATIONS | 2026-09-16 working endpoint `GET /api/v2/collection/category/{category}?page=&per_page=`. Lowercase `game` paginates (`totalHits` 728). `/api/v2/category/*`, `/feed/game`, `/appstream/category/Game` 404. Unpaginated collection is ~425 KB; production must paginate. | blocks category implementation only |
| SHORTCUT-CAPABILITIES | PASS | 2026-09-16 live CEF: required methods all present (`AddShortcut`, `RemoveShortcut`, `SetAppLaunchOptions`, shortcut setters, `SetCustomArtworkForApp`, `ClearCustomArtworkForApp`). `GetShortcuts` absent. `LaunchNonSteamApp` / `RunGame` present but **unused** — production does not launch apps from the plugin. Snapshot `p0-steam-capabilities.json`. | blocks Steam shortcut feature |
| SHORTCUT-ENUMERATION | PASS_WITH_LIMITATIONS | No library-wide enum. `GetShortcutDataForPath` is path-based, not a shortcut list. Readback that worked: `appStore.GetAppOverviewByAppID(returnedId)` after ~250 ms. Production duplicate protection is a plugin-owned `provider+appId → returned Steam appId` registry. | controls duplicate reconciliation |
| SHORTCUT-READINESS | PASS_WITH_LIMITATIONS | `AddShortcut` returns an AppID immediately; `GetAppOverviewByAppID` first populated at **~256 ms**. `AddShortcut`'s name argument is **not** the library title: identity batch A/B/C all displayed as **`flatpak`** (exe basename of `/usr/bin/flatpak`). `SetShortcutName` after the overview exists **does** stick: details page showed `DeckDepot P0 Probe readiness @2000ms`. No 500 ms rule. Production: pass launch options in `AddShortcut`, then `SetShortcutName` once overview readback is present. | controls post-create mutations |
| SHORTCUT-ID-FORMULA | PASS_WITH_LIMITATIONS | Historical `crc32(exe+name)\|0x80000000` matched **none** of the returned IDs (e.g. returned `2389574106` vs variants `3639243966` / `3525531596`). Use AppID returned by `AddShortcut` plus `m_gameid` from overview. Do not derive IDs. | controls any derived-ID use |
| SHORTCUT-PERSISTENCE | PASS_WITH_LIMITATIONS | 2026-09-16 live library visibility yes; plugin reload resolved returned IDs; **user-confirmed Steam restart: shortcuts still present** (identity tiles + readiness entry). System reboot not separately logged. UI MUST NOT claim reboot-proof durability beyond this. | controls durability claims |
| STEAM-ARTWORK | PASS_WITH_LIMITATIONS | `SetCustomArtworkForApp`/`ClearCustomArtworkForApp` returned success for Capsule/Hero/Logo/Header/Icon/HeroBlur. **Capsule magenta PNG is visible in the Gaming Mode library grid** on the first identity shortcut. Other asset types not visually confirmed in that grid shot. Steam-restart persistence not recorded. Enable Capsule in release UI; keep other types behind the same API but do not claim them until seen. | blocks artwork integration |
| GAMING-MODE-LAUNCH | FAIL_USE_FALLBACK | 2026-09-16 gamescope `--steam` on Bazzite: PluginLoader has no display; borrowed `DISPLAY=:1` starts apps (PPSSPP 1280×720 window on `:1`) but `GAMESCOPE_FOCUSED_APP` stays `769` (Steam BPM). `STEAM_GAME` xprop did not steal focus. **Closed historical rejection — not deferred.** Users run apps from Steam after optional Add to Steam, or Desktop Mode. Do not implement `launch_application`. | no Launch UI; no production launch RPC |
| SYSTEM-SCOPE-FLATPAK | FAIL_USE_FALLBACK | 2026-09-16 Bazzite 44.20260915.0, Flatpak 1.18.2, Decky v3.2.9, `flags: []`, uid 1000. `list --system` / `remotes --system` work unprivileged (180 apps; system `flathub` present). PluginLoader subject `pkcheck` for `app-install` / `app-uninstall` / `app-update` = `auth_admin` rc 2. Interactive: “no agent is available.” Host shell same uid is polkit `yes` (active/local/wheel) and is **not** equivalent evidence. Conclusion: **SYSTEM MUTATIONS REQUIRE A NEW PRIVILEGE DESIGN**. v1.0: read-only system discovery; no system install/update/remove; no custom polkit; no root plugin for this. | v1.0 system inventory only; mutations post-v1.0 |
| APPMAN-CONTRACT | PASS_WITH_LIMITATIONS | 2026-09-17 Bazzite: user-installed `/home/zany130/.local/bin/appman` **10.5-1** (bash). Config `~/.config/appman/appman-config` → `/var/home/zany130/Applications` (not `/opt`). Detect via that path — simulated PluginLoader `PATH=/usr/bin:/bin` still found it. AppMan warns if `~/.local/bin` is missing from child PATH (contaminates `-f --less`; prepend it). Search `appman -q`; installed `appman -f` / `-f --less` / `-f --byname`; catalog `appman -l` is mixed. **No JSON**; unknown `--json` and missing-name install/search **exit 0** — parse text. `-y/--assume-yes` exists. Help says `-r` confirms / `-R` does not; **closed-stdin `-r sas` still removed** (reinstalled with `-y -i`; wget bars, checksum abort, listed again). No cancel API. Scripts from GitHub AM DB; extra `-e` / 3rd-party flags. Desktop files are AppMan’s, not DeckDepot Launch. **Categories:** catalog/`-a` have no category field; `-f` TYPE is format. PLA website regex on 3643 `x86_64-apps` rows: 48.8% unmatched, 17.1% multi-match, false positives (`steam`/`wine`→Games, `stream`→Audio & Video). Do **not** add AppMan category UI; do **not** mix heuristic AppMan hits into shared Games\|Utilities\|Audio & Video\|Graphics\|Network\|Office\|Development tabs (Flathub-backed). If M11 later maps, use one DeckDepot slug from installed Freedesktop `Categories=` (Audio+Video→`audiovideo`); keep `amType`/`amDb` internal. Do **not** vendor. Snapshots `p0-appman-host.json`, `p0-appman-contract.json`, `p0-appman-categories.json`. | blocks AppMan provider only |

Allowed final statuses:

```text
PASS
PASS_WITH_LIMITATIONS
FAIL_USE_FALLBACK
DEFERRED
```

### M0 local notes (2026-09-16)

Device snapshots are in `~/homebrew/data/DeckDepot/` (`p0-startup.json`, `p0-environment.json`, `p0-tls.json`, `p0-flatpak-list.json`, `p0-flatpak-host.json`).

| Gate | Ledger status | Evidence |
|---|---|---|
| TEMPLATE-BUILD | **PASS** | ZIP install + repeated unload/reload in PluginLoader logs. See table above for versions. |
| ROUTE-QAM | **PASS** | All three strategies worked. QAM hid on open; B returned to the previous screen. Production: `Navigation.Navigate("/deckdepot")` only. `CloseSideMenus()` not required on this client. |
| DECKY-EVENTS | **PASS** | 9 emit / 9 receive, exactly-once per instance+sequence; post-reload new instance `7be48dfc` seq 1 received once. |
| BACKEND-TLS | **PASS_WITH_LIMITATIONS** | Stdlib TLS fails; `helpers.get_ssl_context` succeeds. |
| FLATPAK-LIST | **PASS_WITH_LIMITATIONS** | Tab-separated headerless list contract proven. Decky inherited env fails; sanitized `LD_LIBRARY_PATH` works (13 rows). |
| FLATPAK-UPDATE-CONTRACT | **PASS_WITH_LIMITATIONS** | `remote-ls --updates --user --app --columns=…commit,ref`. Do not use display versions or `list` `latest` column. |

---

# 17. Production implementation milestones

These milestones supersede the original M0–M11 sequence **and** the pre-freeze draft that still listed “M6 — Direct launch” as an implementation slot.

The former **M6 Direct launch** milestone is **removed**, not deferred. Subsequent milestones are renumbered. Direct launch remains only as historical evidence (§7.10, P0.11, `GAMING-MODE-LAUNCH`).

A milestone MUST NOT begin if one of its required gates is still `PENDING`.

M1 is **complete** (implemented and device-tested). Do not reopen it to add system discovery or launch.

## M0 — Reconciled skeleton + diagnostics harness

**Requires:** none  
**Status:** complete

Implement:

- current official Decky template baseline;
- plugin `main.py` at the repository root;
- dev-only DiagnosticsRoute;
- typed backend bridge;
- logging with secret redaction;
- Verification Ledger workflow.

Run P0.1-P0.4.

Success:

- plugin builds;
- QAM appears;
- diagnostics route opens;
- event bridge works;
- environment/TLS result is recorded.

## M1 — Flatpak command engine

**Requires:** TEMPLATE-BUILD, DECKY-EVENTS, FLATPAK-LIST  
**Status:** complete — implemented and device-tested (user-scoped mutations)

Implement (frozen; do not rewrite):

- Flatpak binary discovery;
- user-scoped installed query;
- typed backend errors;
- remote detection and user-confirmed Flathub add;
- task state machine;
- install;
- cancellation/reconciliation;
- uninstall.

No fake percentage progress. No production `run`. No `--system` mutations.

Success:

- user can install/uninstall a test Flatpak and state remains correct after re-query/reload.

## M2 — Flathub catalog contract

**Requires:** BACKEND-TLS decision, FLATHUB-SEARCH, FLATHUB-APPSTREAM

Implement:

- CEF/front-end Flathub client by default;
- runtime schema validation;
- search;
- application details;
- sanitized/plain description;
- screenshots/icons;
- bounded retries/timeouts;
- empty-success vs network/HTTP/schema failure for search and details.

Category UI only if FLATHUB-CATEGORY passes; otherwise omit/defer it.

Success:

- live search and details work without depending on guessed fields;
- zero hits are not presented as a transport failure, and a failed request is not presented as zero hits.

## M3 — Controller-first full-screen store

**Requires:** ROUTE-QAM, M2

Implement:

- StoreRoute;
- search surface;
- application grid/list;
- detail surface;
- focus restoration;
- controller back behavior;
- loading/error/empty states;
- responsive layout for Steam Deck and 16:9/handheld resolutions.

No Launch action.

Success:

- complete catalog browsing is usable without touch/mouse.

## M4 — Flatpak store integration + read-only system inventory

**Requires:** M1, M3  
**Does not reopen M1 mutation architecture.**

Implement:

- install button (user scope only);
- indeterminate task progress;
- cancellation;
- installed badges;
- installed applications view;
- uninstall confirmation;
- state refresh after every mutation;
- **read-only system discovery** via the current supported equivalent of `flatpak list --system --app ...` (and other non-mutating queries needed for inventory);
- explicit `installationScope` (`user` | `system`) on installed rows;
- dual user+system instances of the same `appId` shown separately;
- system-only rows communicate the equivalent of **Installed system-wide** and that DeckDepot v1.0 does not manage system installations;
- no working Update/Remove actions on system-scoped rows;
- never silently attempt a user-scope mutation against a system installation.

Success:

- catalog and local user-scope state remain consistent across install/uninstall/plugin reload;
- system-installed apps are visible and clearly non-mutable.

## M5 — Updates (user-scoped)

**Requires:** FLATPAK-UPDATE-CONTRACT, M4

Implement:

- Flatpak-native update discovery;
- per-app **user-scoped** update;
- optional Update All if command semantics are verified for `--app` rows;
- error recovery and state refresh;
- no `--no-deps` / `--no-related`;
- related runtime / `.Locale` refs MUST NOT inflate store update counts as extra apps;
- prefer full ref identity when app ID/branch is ambiguous;
- broken/unreachable remotes as a distinguishable degraded state;
- empty successful `remote-ls --updates` ≠ failed query;
- concrete test: update that pulls a new dependency / `.Locale` ref (AutoFlatpaks regression class).

Do not update system-scoped installations.

Success:

- update availability reflects Flatpak's own ref semantics, not Flathub version strings;
- user-scope only.

## M6 — Steam shortcut diagnostics and adapter

**Requires:** SHORTCUT-CAPABILITIES, SHORTCUT-ENUMERATION, SHORTCUT-READINESS, SHORTCUT-ID-FORMULA, SHORTCUT-PERSISTENCE

*(Formerly M7. The old M6 Direct launch slot does not exist.)*

Implement a minimal production Steam adapter using only proven capabilities.

Rules:

- four-argument `AddShortcut`;
- use returned AppID;
- pass final launch options during creation, including explicit `--user` or `--system`;
- no `GetShortcuts`;
- no magic 500 ms for AddShortcut readiness;
- bounded observable-state verification (register for app-details changes / poll `GetAppOverviewByAppID` / `SetShortcutName` after overview exists, as currently evidenced);
- local registry fallback when enumeration is unavailable;
- `RemoveShortcut` only for a known returned/mapped ID;
- treat missing first-read fields as possible hydration, not automatic failure.

Success:

- shortcut can be added repeatedly without uncontrolled duplicates under the chosen reconciliation strategy.

## M7 — Add-to-Steam UX

**Requires:** M6

*(Formerly M8.)*

Implement:

- Add to Steam for user-scoped installs;
- Add to Steam for already-installed system Flatpaks as a **separate capability test** (shortcut must preserve `--system`); system mutation is still forbidden;
- Remove from Steam when the plugin has a known mapping;
- error/retry state;
- registry recovery/reset UI if readback is unavailable;
- clear distinction between unsupported and failed.

Steam, not DeckDepot, executes the shortcut.

Success:

- feature degrades gracefully on unsupported Steam builds.

## M8 — Artwork + minimal SteamGridDB

**Requires:** STEAM-ARTWORK, BACKEND-TLS decision, M7

*(Formerly M9.)*

Implement:

- SteamGridDB API-key settings (backend-owned; `get_ssl_context()` candidate);
- search by resolved display name;
- **first** game result;
- **first** image per supported, gate-proven category;
- skip missing categories/assets;
- base64 conversion;
- live Steam artwork assignment with current `SetCustomArtworkForApp`;
- artwork failure MUST NOT fail Add-to-Steam;
- omit custom shortcut icon from v1.0 unless a live non-VDF path is verified.

Do not implement result-selection UI, artwork browsing, style filters, cropping, positioning UI, or a full SGDB client.

Do not require 100% artwork coverage.

## M9 — Reliability, security, and recovery

**Requires:** M1–M8 as applicable

*(Formerly M10.)*

Implement/test:

- process cleanup on Decky unload;
- stale task reconciliation;
- network timeout/backoff;
- plugin reload during idle/task states;
- no duplicate event listeners;
- secret redaction;
- URL validation;
- malformed remote metadata;
- low/no network;
- low disk;
- Flatpak command failures;
- Steam API disappearance/change;
- empty-success vs failure across catalog, remotes, and update discovery.

## M10 — AppMan provider research spike

**Requires:** stable Flatpak v1.0 loop; does not block Flatpak release

*(Formerly M11.)*

Run APPMAN-CONTRACT gate.

Do not build full provider UI until the gate passes. AppMan “local desktop launchers” are AppMan’s own desktop files, not a DeckDepot Launch feature.

## M11 — AppMan provider

**Requires:** APPMAN-CONTRACT = PASS or PASS_WITH_LIMITATIONS

*(Formerly M12.)*

Implement provider-specific:

- search/query;
- app details sufficient for store UI;
- local install;
- installed list;
- update;
- remove;
- explicit trust/source labeling;
- local-path configuration;
- task/error semantics.

Do not force AppMan into Flatpak-specific semantics where upstream behavior differs. Do not add a DeckDepot Launch action for AppMan.

## M12 — Release qualification

*(Formerly M13.)*

**Status:** complete on this Bazzite/Decky target, with documented limitations

Test on the supported compatibility matrix.

Release only with all required gates resolved to:

```text
PASS
PASS_WITH_LIMITATIONS
FAIL_USE_FALLBACK
DEFERRED
```

No release-required gate may remain `PENDING`. `GAMING-MODE-LAUNCH` and `SYSTEM-SCOPE-FLATPAK` as `FAIL_USE_FALLBACK` are acceptable because their production consequence is omission (no plugin launch; no system mutations).

### M12 local notes (2026-09-17)

Device: Bazzite `44.20260915.0` / `bazzite-deck`, arch `x86_64`, Flatpak `1.18.2`, AppMan `10.5-1`, Decky `v3.2.9`, Decky Python `3.11.7`, `@decky/api@1.1.3`, `@decky/ui@4.11.0`. SteamOS was **not** available on this machine.

| Check | Result |
|---|---|
| Ledger gates | None remain `PENDING`. Closed fallbacks unchanged: `GAMING-MODE-LAUNCH`, `SYSTEM-SCOPE-FLATPAK`. |
| plugin.json | `flags: []`, no `_root`. |
| Mutations | `asyncio.create_subprocess_exec` only; no `create_subprocess_shell`; user-scoped Flatpak mutations; system inventory read-only. |
| Launch | No production Launch UI. `run_flatpak_app` returns `CAPABILITY_UNAVAILABLE`. |
| QAM | Single action **Open DeckDepot**. Diagnostics route is not registered in the release frontend. |
| Host Flatpak | User list 14 rows / 0 malformed. `remote-ls --updates --user --app` empty-success (0 pending). System list 180 apps, readable. |
| AppMan | Binary present; updater list is support, not confirmed pending updates. |
| Package | `out/DeckDepot.zip` built. |
| Reload | Full plugin unload/reload is required after Python RPC changes. A frontend-only reload at 19:22 left `start_appman_update_all` missing on the still-running Plugin instance. |

SteamOS remains an untested matrix row. Do not implement system mutations or in-plugin Launch as part of v1.0 close-out.

---

# 18. UI architecture

## 18.1 Main surfaces

Recommended release surfaces:

```text
Home / Discover
Search
Installed
Updates
Settings
Diagnostics (development builds only)
```

## 18.2 Application card

Each card may show:

- icon;
- name;
- summary;
- provider badge;
- Installed / Update available state.

Do not show fake version data.

## 18.3 Detail surface

Show:

- name/icon;
- summary;
- sanitized/plain description;
- developer/license when known;
- screenshots;
- provider/source;
- installed/current version when known;
- installation scope when installed (`user` vs **Installed system-wide**);
- primary action: Install / Update (user-scoped only);
- secondary actions: Add to Steam / Remove from Steam / Uninstall as capabilities allow.

System-scoped rows MUST NOT expose working Update/Remove mutation actions.

There is no Launch action.

## 18.4 Capability-driven UI

Buttons MUST be hidden or disabled from capability state, not merely from optimistic assumptions.

Examples:

- no Steam `AddShortcut` -> hide Add to Steam;
- GAMING-MODE-LAUNCH failed -> **no Launch button** (closed historical rejection, not a capability to retry in v1.0);
- system-scoped install -> no Update/Remove; show read-only system messaging;
- Flathub missing -> offer Enable Flathub;
- SteamGridDB key absent -> artwork integration remains optional; Add-to-Steam still succeeds;
- AppMan gate not passed -> no AppMan store tab.

---

# 19. Error model

Backend responses SHOULD use typed error codes instead of only strings.

Recommended categories:

```text
CAPABILITY_UNAVAILABLE
INVALID_ARGUMENT
FLATPAK_NOT_FOUND
FLATHUB_REMOTE_MISSING
NETWORK_ERROR
REMOTE_SCHEMA_ERROR
PROCESS_FAILED
PROCESS_CANCELLED
STEAM_API_UNAVAILABLE
STEAM_OPERATION_FAILED
STORAGE_ERROR
PROVIDER_UNAVAILABLE
INTERNAL_ERROR
```

The frontend MAY show a friendly message while logging diagnostic detail locally.

Do not expose API keys, arbitrary environment secrets, or full sensitive paths in toast messages.

Empty successful result sets MUST use the success path with an empty collection (or an explicit empty state), not `NETWORK_ERROR` / `PROCESS_FAILED` / `REMOTE_SCHEMA_ERROR`. Failures MUST use a failure code, not an empty collection. Existing codes are sufficient if applied this way; do not invent a new name solely for emptiness.

---

# 20. Persistence

## 20.1 Plugin-owned state

Persist only what the plugin owns, such as:

- user settings;
- SteamGridDB key/settings;
- provider configuration;
- provider/app -> returned Steam AppID mapping;
- optional cache metadata.

Do not treat plugin state as authoritative package-manager state.

On startup:

- query Flatpak for real installed state (user-scoped mutations; plus M4 system read-only inventory);
- reconcile pending/previous task UI;
- validate stored Steam mappings when a readback mechanism exists.

## 20.2 Cache

Catalog/screenshot caches are optional.

If implemented:

- bound their size;
- expire stale metadata;
- allow clearing them;
- never make cached data mandatory for uninstall/update.

---

# 21. Quality assurance matrix

At minimum test:

| Area | Cases |
|---|---|
| Decky lifecycle | install, load, unload, reload, update plugin |
| Routing | QAM -> store, B/back, modal back, repeated route entry |
| Controller | d-pad/stick, A/B, long list, focus restoration |
| Flatpak | none installed, many installed, user install/cancel/update/uninstall, system row visible and non-mutable, dual user+system same appId |
| Remote | Flathub missing, remote add accepted/declined/fails, unreachable remote ≠ empty update list |
| Network | offline, timeout, HTTP error, malformed JSON, empty successful search vs failed search |
| Metadata | missing icon, missing screenshot, missing version, unusual HTML |
| Steam | API available, API partially missing, add/remove shortcut, Steam restart, first-read hydration miss, `--user` / `--system` launchOptions |
| Artwork | each enabled asset slot, missing SGDB art skipped, first-result automation, Add-to-Steam still succeeds if SGDB fails |
| OS | supported SteamOS target, supported Bazzite target |
| Architecture | no x86_64-only path assumptions |
| Security | malicious URL schemes, malformed App ID, task ID, path traversal attempts |
| Recovery | plugin reload after task, interrupted task, stale Steam registry mapping |
| AppMan | only after provider gate: prompts, failures, install/update/remove, trust labeling |

---

# 22. Acceptance criteria

The Flatpak v1.0 loop is ready for release when:

1. it installs and runs as an unprivileged Decky plugin (`flags: []`, no `_root`);
2. the full-screen route and controller flow pass on the supported device matrix;
3. Flathub responses are runtime-validated, and empty success is distinct from request failure;
4. installed-state parsing uses a verified Flatpak command contract;
5. install/uninstall/update paths re-query package-manager state after mutations;
6. progress never fabricates unsupported percentages;
7. no package mutation invokes a shell;
8. no arbitrary desktop `Exec=` line is executed;
9. DeckDepot does not execute applications; Steam launches created shortcuts;
10. all Decky backend events use the Decky event API;
11. every release-required Verification Ledger gate is resolved;
12. Steam integration uses only runtime-detected/current typed APIs;
13. SteamGridDB automation is first-result/first-image and cannot fail Add-to-Steam;
14. system-scoped Flatpaks are discoverable and non-mutable;
15. the plugin still works as a Flatpak store when optional Steam/SGDB features are unavailable;
16. AppMan is not advertised unless its provider gate has passed.

---

# 23. Reconciliation decisions from the audit/rebuttal

The following original claims are explicitly retired:

| Original claim | Final decision |
|---|---|
| five-argument `AddShortcut(..., icon, launchOptions)` | **Removed.** Use current four-argument contract. |
| `SetCustomArtworkForApp(appId, filePath, artworkType)` | **Removed.** Use base64 + image format + current asset enum. |
| `SteamClient.Apps.GetShortcuts()` | **Removed as a production assumption.** Device-test for an alternative or use plugin registry. |
| Python `decky.emit` -> `window.addEventListener` | **Removed.** Use `@decky/api` event listeners. |
| Flatpak `active-commit` column | **Removed.** Use verified `active` contract. |
| regex percentage/speed parser with `--noninteractive` | **Removed.** Use phase/indeterminate progress unless a real progress API is added. |
| desktop `Exec=` token stripping | **Removed.** DeckDepot does not execute apps. Steam shortcuts use validated app ID plus `--user`/`--system`, never reconstructed `Exec=`. |
| exact guessed Flathub `icons[]` / screenshot `sizes[]` interfaces | **Removed.** Runtime-validate current schema. |
| in-plugin Launch / `launch_application` / production `flatpak run` | **Rejected, not deferred.** `GAMING-MODE-LAUNCH = FAIL_USE_FALLBACK`. Former M6 Direct launch milestone removed and later milestones renumbered. |
| system Flatpak install/update/remove in v1.0 | **Rejected for v1.0.** Spike: SYSTEM MUTATIONS REQUIRE A NEW PRIVILEGE DESIGN. v1.0 is read-only system discovery. Host-shell polkit `yes` is not PluginLoader evidence. |
| AutoFlatpaks shell strings / `create_subprocess_shell` / `flags: ["root"]` | **Not adopted.** [REFERENCE-IMPLEMENTATION] only. M1 stays argv `create_subprocess_exec`, `--user`, `flags: []`. |
| SteamGridDB result-selection / full client | **Not in v1.0.** First game result, first image, skip missing, never fail Add-to-Steam. |
| `shortcuts.vdf` as primary Add-to-Steam or icon path | **Not primary.** Live `AddShortcut` / `SetCustomArtworkForApp`. Omit custom shortcut icon from v1.0 if no live path is verified. |
| mandatory 500 ms Steam delay | **Removed.** Measure readiness; pass final launch options in `AddShortcut`. Artwork-clear timing is a separate bounded strategy. |
| CRC32-derived AppID as primary identity | **Removed.** Prefer AppID returned by Steam. |
| direct Steam grid-file writes as primary art path | **Removed.** Prefer live artwork API. |
| Python 3.11+ portability guarantee | **Removed.** Record/test actual Decky Python. |
| universal backend CA-certificate assumption | **Reframed.** TLS is an environment capability gate; frontend fetch remains safe baseline for public catalog traffic. |
| 255-character limit was arbitrary | **Reconciled.** D-Bus has a 255-byte name ceiling; enforce as a conservative upper bound but do not confuse it with complete Flatpak-ID validation. |
| `"Latest"` stored as version | **Removed from model.** UI fallback only. |
| `<500 ms` search success requirement | **Removed.** Responsiveness/cancellation/error handling are the real criteria. |
| 100% detection/artwork guarantees | **Removed.** Scope measurable behavior and graceful degradation. |
| AppMan represented only by `"appimage"` provider enum | **Removed.** AppMan gets an explicit research/provider phase. |

---

# 24. Current upstream references

These links are evidence anchors, not a substitute for the device gates.

## Decky

- Official plugin template:  
  https://github.com/SteamDeckHomebrew/decky-plugin-template
- Template frontend example (`@decky/api` event usage):  
  https://github.com/SteamDeckHomebrew/decky-plugin-template/blob/main/src/index.tsx
- Template Python backend (`decky.emit`, lifecycle):  
  https://github.com/SteamDeckHomebrew/decky-plugin-template/blob/main/main.py
- `@decky/api`:  
  https://github.com/SteamDeckHomebrew/loader-api
- Decky frontend library:  
  https://github.com/SteamDeckHomebrew/decky-frontend-lib
- SteamClient Apps typing:  
  https://github.com/SteamDeckHomebrew/decky-frontend-lib/blob/main/src/globals/steam-client/App.ts
- Decky Loader releases:  
  https://github.com/SteamDeckHomebrew/decky-loader/releases

## Flatpak / desktop integration

- Flatpak application-ID and desktop conventions:  
  https://docs.flatpak.org/en/latest/conventions.html
- Flatpak usage:  
  https://docs.flatpak.org/en/latest/using-flatpak.html
- Desktop Entry specification:  
  https://specifications.freedesktop.org/desktop-entry/latest-single/
- D-Bus specification:  
  https://dbus.freedesktop.org/doc/dbus-specification.html

## Flathub

- Flathub:  
  https://flathub.org/
- Flathub documentation:  
  https://docs.flathub.org/
- v2 API endpoint used by the project:  
  https://flathub.org/api/v2/appstream/

Because the v2 API schema is not treated here as a permanently frozen public contract, the project must keep runtime validation and schema tests.

## SteamGridDB

- SteamGridDB:  
  https://www.steamgriddb.com/
- SteamGridDB GitHub organization:  
  https://github.com/SteamGridDB
- SteamGridDB Decky plugin (reference implementation, GPL-3.0-or-later):  
  https://github.com/SteamGridDB/decky-steamgriddb

## AutoFlatpaks

- AutoFlatpaks Decky plugin (reference implementation, BSD-3-Clause):  
  https://github.com/jurassicplayer/decky-autoflatpaks

## Flatpak authorization (system helper)

- Polkit policy template:  
  https://github.com/flatpak/flatpak/blob/main/system-helper/org.freedesktop.Flatpak.policy.in
- Polkit rules template:  
  https://github.com/flatpak/flatpak/blob/main/system-helper/org.freedesktop.Flatpak.rules.in

On-disk Bazzite copies under `/usr/share/polkit-1/` matched these templates on 2026-09-16 (`privileged_group` = `wheel`). Distro policy MAY differ; do not assume SteamOS equals Bazzite.

## AppMan / AM

- AM upstream:  
  https://github.com/ivan-hc/AM
- AppMan upstream:  
  https://github.com/ivan-hc/AppMan

---

# 25. Reference implementations and acknowledgements

DeckDepot is an **independent implementation** with its own architecture. The following projects were studied as **[REFERENCE-IMPLEMENTATION]** evidence. Study behavior and architecture. Do not copy substantial GPL code unless DeckDepot intentionally adopts a compatible licensing strategy.

## AutoFlatpaks

https://github.com/jurassicplayer/decky-autoflatpaks  

License: **BSD-3-Clause**

Credit: helped demonstrate Flatpak management from Gaming Mode; update/dependency edge cases (including new runtime / `.Locale` refs and `--no-deps` pitfalls); remote-failure and degraded-state lessons; queue/transaction behavior.

Do **not** copy: system/root-only assumptions, `plugin.json` `root` flag, shell-command strings, `create_subprocess_shell`, human-readable CLI parsing as a machine protocol, or old Decky frontend APIs.

## SteamGridDB Decky Plugin

https://github.com/SteamGridDB/decky-steamgriddb  

License: **GPL-3.0-or-later**

Credit: helped demonstrate mature Steam/Decky integration patterns (`@decky/api` / `@decky/ui`); `SetCustomArtworkForApp` + base64 artwork; non-Steam shortcut hydration/eventual consistency; backend HTTPS via `get_ssl_context()`; Gaming Mode integration lessons.

Do **not** copy: substantial GPL implementation code; the plugin's embedded API key; `shortcuts.vdf` as DeckDepot's primary path; a full artwork-selection client.

# 26. Final implementation principle

The central rule of this project is:

> **Documented APIs are contracts. Undocumented Steam behavior is a hypothesis until measured on the real client. External CLI text is a user interface until proven to be a machine interface. A reference plugin demonstrates behavior; it does not mint a permanent contract.**

The coding agent should therefore be aggressive about implementing verified layers and equally aggressive about refusing to invent certainty for the few layers that Steam, Decky, Flatpak, Flathub, or AppMan do not formally guarantee.

The result should be a store that remains useful even when optional integrations degrade, rather than a store whose core functionality depends on one fragile undocumented assumption.

This document is the **frozen v1.0 implementation baseline**. Ordinary new ideas belong in a separate future/backlog document.

# 27. Post-v1.0 future work (not v1.0 dependencies)

Recorded here so they are not mistaken for active milestones:

- **System-scoped Flatpak mutations** (install / update / uninstall / remote modification). Spike conclusion: **SYSTEM MUTATIONS REQUIRE A NEW PRIVILEGE DESIGN**. Investigate **narrow polkit authorization first** because it may preserve the unprivileged M1 architecture. Investigate a Decky root-plugin architecture with deliberate user-child privilege drop **only if** a sufficiently safe and portable authorization rule cannot be designed. Do not choose or implement either in v1.0.
- In-plugin application launching. **Rejected** on this target (`GAMING-MODE-LAUNCH`). Not future work unless device behavior changes.
- Full SteamGridDB client features (selection UI, browsing, filters, cropping, positioning). Out of v1.0 by product decision; users use the dedicated plugin.
- AppMan production provider, until APPMAN-CONTRACT passes.
