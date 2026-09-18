# P0.6 Flatpak update discovery (2026-09-16)

Flatpak 1.18.2 on Bazzite. Disposable proof used `org.kde.kwrite`, then uninstalled.

## Chosen discovery command

```text
flatpak remote-ls --updates --user --app --columns=application,version,branch,arch,origin,commit,ref
```

Run with sanitized child env (`LD_LIBRARY_PATH` removed) from Decky.

- Exit 0 and empty stdout: **no updates** (not a failure)
- When an update exists, one tab-separated row per app, including the **remote commit**

`--json` also works but on 1.18.2 the JSON object had `name`, `application_id`, `version`, `branch`, `arch`, `origin` and **no commit**. Prefer `--columns`.

## What failed / is unusable

| Candidate | Result |
|---|---|
| `flatpak list --columns=active,latest` | `latest` is always `-`, even when a newer commit exists |
| Compare Flathub/list **version** strings | **Wrong.** Downgraded kwrite stayed `26.04.3` while an update existed |
| `flatpak outdated` | Not a command |
| `flatpak update --dry-run` | Unknown option |

## Positive proof

1. Installed current kwrite (`active=95cbe5d36448`, version `26.04.3`)
2. `flatpak update --user -y --noninteractive --commit=<parent> org.kde.kwrite`
3. `active` became `a346741768a8`; **version still `26.04.3`**; `latest` still `-`
4. `remote-ls --updates` listed `org.kde.kwrite … 95cbe5d36448`
5. `flatpak update --user -y --noninteractive org.kde.kwrite` restored current commit
6. `--updates` empty again; uninstalled

## Mutation (already used in P0.5)

```text
flatpak update --user -y --noninteractive <validated-app-id>
```

Noninteractive stdout when updating: `Updating app/org.kde.kwrite/x86_64/stable`  
When current: `Nothing to update.`
