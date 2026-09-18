"""Production backend RPCs for DeckDepot."""

from __future__ import annotations

import os
from typing import Any, Callable

from deckdepot.errors import EngineError
from deckdepot.flatpak_engine import (
    add_flathub_remote,
    list_installed,
    list_remotes,
    require_flatpak_path,
)
from deckdepot.shortcut_registry import (
    delete_mapping,
    get_mapping,
    list_mappings,
    reset_registry,
    upsert_mapping,
)
from deckdepot.shortcuts_vdf import inspect_shortcuts_vdf_rpc
from deckdepot.system_inventory import list_system_installed
from deckdepot.task_manager import TaskManager
from deckdepot.steamgriddb import (
    clear_api_key,
    clear_asset_cache,
    fetch_capsule_artwork,
    get_cached_artwork,
    get_status,
    set_api_key,
)
from deckdepot.appman_engine import (
    get_details as appman_details,
    list_category as appman_category,
    list_installed as appman_installed,
    search as appman_search,
    status as appman_status,
)
from deckdepot.appman_settings import save_search_scope as save_appman_search_scope
from deckdepot.plugin_files import remove_plugin_owned_files
from deckdepot.update_discovery import list_user_updates


async def await_engine(coro: Any) -> dict[str, Any]:
    try:
        result = await coro
        if isinstance(result, dict) and "ok" in result:
            return result
        return {"ok": True, **result} if isinstance(result, dict) else {"ok": True, "value": result}
    except EngineError as exc:
        return exc.to_dict()


def call_engine(fn: Callable[..., dict[str, Any]], *args: Any, **kwargs: Any) -> dict[str, Any]:
    try:
        return fn(*args, **kwargs)
    except EngineError as exc:
        return exc.to_dict()


class FlatpakService:
    def __init__(self) -> None:
        self.tasks = TaskManager()

    async def get_installed_apps(self) -> dict[str, Any]:
        return await await_engine(list_installed())

    async def get_system_installed_apps(self) -> dict[str, Any]:
        return await await_engine(list_system_installed())

    async def get_user_updates(self) -> dict[str, Any]:
        return await await_engine(list_user_updates())

    async def check_flathub_remote(self) -> dict[str, Any]:
        return await await_engine(list_remotes())

    async def add_flathub_remote(self) -> dict[str, Any]:
        return await await_engine(add_flathub_remote())

    async def get_task_status(self, task_id: str) -> dict[str, Any]:
        try:
            return {"ok": True, "task": self.tasks.snapshot(task_id)}
        except EngineError as exc:
            return exc.to_dict()

    async def get_tasks(self) -> dict[str, Any]:
        return {
            "ok": True,
            "backendSessionId": self.tasks.session_id,
            "tasks": self.tasks.all_snapshots(),
        }

    async def start_install(self, app_id: str) -> dict[str, Any]:
        return await await_engine(self.tasks.start("install", app_id))

    async def start_update(self, app_id: str, ref: str = "") -> dict[str, Any]:
        return await await_engine(self.tasks.start("update", app_id, ref=ref or None))

    async def start_update_all(self) -> dict[str, Any]:
        return await await_engine(self.tasks.start("update_all", "all-user-apps"))

    async def start_uninstall(self, app_id: str) -> dict[str, Any]:
        return await await_engine(self.tasks.start("uninstall", app_id))

    async def start_appman_install(self, app_id: str, source_id: str = "am") -> dict[str, Any]:
        return await await_engine(
            self.tasks.start(
                "install", app_id, provider="appman", source_id=source_id or "am"
            )
        )

    async def start_appman_update(self, app_id: str, source_id: str = "am") -> dict[str, Any]:
        return await await_engine(
            self.tasks.start(
                "update", app_id, provider="appman", source_id=source_id or "am"
            )
        )

    async def start_appman_update_all(self) -> dict[str, Any]:
        return await await_engine(
            self.tasks.start(
                "update_all", "all-appman-apps", provider="appman"
            )
        )

    async def start_appman_uninstall(self, app_id: str, source_id: str = "am") -> dict[str, Any]:
        return await await_engine(
            self.tasks.start(
                "uninstall", app_id, provider="appman", source_id=source_id or "am"
            )
        )

    async def get_appman_status(self) -> dict[str, Any]:
        return await await_engine(appman_status())

    async def get_appman_search(self, query: str, scope: str = "") -> dict[str, Any]:
        return await await_engine(appman_search(query, scope or None))

    async def get_appman_category(self, slug: str) -> dict[str, Any]:
        return await await_engine(appman_category(slug))

    async def get_appman_details(self, app_id: str, source_id: str = "am") -> dict[str, Any]:
        return await await_engine(appman_details(app_id, source_id or "am"))

    async def get_appman_installed(self) -> dict[str, Any]:
        return await await_engine(appman_installed())

    async def get_appman_settings(self) -> dict[str, Any]:
        return await await_engine(appman_status())

    async def set_appman_search_scope(self, scope: str) -> dict[str, Any]:
        try:
            save_appman_search_scope(scope)
        except EngineError as exc:
            return exc.to_dict()
        return await await_engine(appman_status())

    async def cancel_task(self, task_id: str) -> dict[str, Any]:
        return await await_engine(self.tasks.cancel(task_id))

    async def get_flatpak_executable_spec(self) -> dict[str, Any]:
        try:
            path = require_flatpak_path()
            return {"ok": True, "path": path, "startDir": os.path.dirname(path) or "/"}
        except EngineError as exc:
            return exc.to_dict()

    async def list_shortcut_registry(self) -> dict[str, Any]:
        return call_engine(list_mappings)

    async def get_shortcut_mapping(
        self, provider: str, installation_scope: str, app_id: str
    ) -> dict[str, Any]:
        return call_engine(get_mapping, provider, installation_scope, app_id)

    async def upsert_shortcut_mapping(self, payload: dict[str, Any]) -> dict[str, Any]:
        return call_engine(upsert_mapping, payload or {})

    async def delete_shortcut_mapping(
        self, provider: str, installation_scope: str, app_id: str
    ) -> dict[str, Any]:
        return call_engine(delete_mapping, provider, installation_scope, app_id)

    async def reset_shortcut_registry(self) -> dict[str, Any]:
        return call_engine(reset_registry)

    async def inspect_shortcuts_vdf(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        return call_engine(inspect_shortcuts_vdf_rpc, payload or {})

    async def get_steamgriddb_status(self) -> dict[str, Any]:
        return call_engine(get_status)

    async def set_steamgriddb_api_key(self, api_key: str) -> dict[str, Any]:
        return call_engine(set_api_key, api_key)

    async def clear_steamgriddb_api_key(self) -> dict[str, Any]:
        return call_engine(clear_api_key)

    async def fetch_steamgriddb_capsule(self, name: str) -> dict[str, Any]:
        return call_engine(fetch_capsule_artwork, name)

    async def get_steamgriddb_asset(self, category: str) -> dict[str, Any]:
        return call_engine(get_cached_artwork, category)

    async def shutdown(self) -> None:
        await self.tasks.cancel_active()
        clear_asset_cache()

    def uninstall_owned_files(self) -> dict[str, Any]:
        return call_engine(remove_plugin_owned_files)
