import os
import sys
import uuid

import decky

PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
PY_MODULES = os.path.join(PLUGIN_DIR, "py_modules")
if PY_MODULES not in sys.path:
    sys.path.insert(0, PY_MODULES)

from deckdepot.diagnostics import log_error, log_info  # noqa: E402
from deckdepot.service import FlatpakService  # noqa: E402


class Plugin:
    def __init__(self) -> None:
        self.instance_id = uuid.uuid4().hex[:8]
        self.flatpak = FlatpakService()

    async def get_installed_apps(self) -> dict:
        log_info("RPC get_installed_apps")
        return await self.flatpak.get_installed_apps()

    async def get_system_installed_apps(self) -> dict:
        log_info("RPC get_system_installed_apps")
        return await self.flatpak.get_system_installed_apps()

    async def get_user_updates(self) -> dict:
        log_info("RPC get_user_updates")
        return await self.flatpak.get_user_updates()

    async def check_flathub_remote(self) -> dict:
        log_info("RPC check_flathub_remote")
        return await self.flatpak.check_flathub_remote()

    async def add_flathub_remote(self) -> dict:
        log_info("RPC add_flathub_remote")
        return await self.flatpak.add_flathub_remote()

    async def get_task_status(self, task_id: str) -> dict:
        return await self.flatpak.get_task_status(task_id)

    async def get_tasks(self) -> dict:
        return await self.flatpak.get_tasks()

    async def start_install(self, app_id: str, installation_scope: str = "") -> dict:
        log_info(
            f"RPC start_install app_id={app_id} scope={installation_scope or 'auto'}"
        )
        return await self.flatpak.start_install(app_id, installation_scope)

    async def start_update(
        self, app_id: str, ref: str = "", installation_scope: str = ""
    ) -> dict:
        log_info(
            f"RPC start_update app_id={app_id} ref={ref} scope={installation_scope}"
        )
        return await self.flatpak.start_update(app_id, ref, installation_scope)

    async def start_update_all(self, installation_scope: str = "user") -> dict:
        log_info(f"RPC start_update_all scope={installation_scope}")
        return await self.flatpak.start_update_all(installation_scope)

    async def start_uninstall(self, app_id: str, installation_scope: str = "") -> dict:
        log_info(f"RPC start_uninstall app_id={app_id} scope={installation_scope}")
        return await self.flatpak.start_uninstall(app_id, installation_scope)

    async def get_system_updates(self) -> dict:
        log_info("RPC get_system_updates")
        return await self.flatpak.get_system_updates()

    async def get_flatpak_scope_status(self) -> dict:
        return await self.flatpak.get_flatpak_scope_status()

    async def set_flatpak_install_scope(self, scope: str) -> dict:
        log_info(f"RPC set_flatpak_install_scope scope={scope}")
        return await self.flatpak.set_flatpak_install_scope(scope)

    async def probe_session_bridge(self) -> dict:
        log_info("RPC probe_session_bridge")
        return await self.flatpak.probe_session_bridge()

    async def start_appman_install(self, app_id: str, source_id: str = "am") -> dict:
        log_info(f"RPC start_appman_install app_id={app_id} source={source_id}")
        return await self.flatpak.start_appman_install(app_id, source_id)

    async def start_appman_update(self, app_id: str, source_id: str = "am") -> dict:
        log_info(f"RPC start_appman_update app_id={app_id} source={source_id}")
        return await self.flatpak.start_appman_update(app_id, source_id)

    async def start_appman_update_all(self) -> dict:
        log_info("RPC start_appman_update_all")
        return await self.flatpak.start_appman_update_all()

    async def start_appman_uninstall(self, app_id: str, source_id: str = "am") -> dict:
        log_info(f"RPC start_appman_uninstall app_id={app_id} source={source_id}")
        return await self.flatpak.start_appman_uninstall(app_id, source_id)

    async def get_appman_status(self) -> dict:
        return await self.flatpak.get_appman_status()

    async def get_appman_search(self, query: str, scope: str = "") -> dict:
        log_info("RPC get_appman_search")
        return await self.flatpak.get_appman_search(query, scope)

    async def get_appman_category(self, slug: str) -> dict:
        return await self.flatpak.get_appman_category(slug)

    async def get_appman_details(self, app_id: str, source_id: str = "am") -> dict:
        return await self.flatpak.get_appman_details(app_id, source_id)

    async def get_appman_installed(self) -> dict:
        return await self.flatpak.get_appman_installed()

    async def get_appman_launch_spec(self, app_id: str) -> dict:
        return await self.flatpak.get_appman_launch_spec(app_id)

    async def get_appman_settings(self) -> dict:
        return await self.flatpak.get_appman_settings()

    async def set_appman_search_scope(self, scope: str) -> dict:
        log_info(f"RPC set_appman_search_scope scope={scope}")
        return await self.flatpak.set_appman_search_scope(scope)

    async def cancel_task(self, task_id: str) -> dict:
        log_info(f"RPC cancel_task task_id={task_id}")
        return await self.flatpak.cancel_task(task_id)

    async def get_flatpak_executable_spec(self) -> dict:
        return await self.flatpak.get_flatpak_executable_spec()

    async def list_shortcut_registry(self) -> dict:
        return await self.flatpak.list_shortcut_registry()

    async def get_shortcut_mapping(
        self, provider: str, installation_scope: str, app_id: str
    ) -> dict:
        return await self.flatpak.get_shortcut_mapping(provider, installation_scope, app_id)

    async def upsert_shortcut_mapping(self, payload: dict) -> dict:
        log_info("RPC upsert_shortcut_mapping")
        return await self.flatpak.upsert_shortcut_mapping(payload)

    async def delete_shortcut_mapping(
        self, provider: str, installation_scope: str, app_id: str
    ) -> dict:
        log_info(f"RPC delete_shortcut_mapping app_id={app_id}")
        return await self.flatpak.delete_shortcut_mapping(
            provider, installation_scope, app_id
        )

    async def reset_shortcut_registry(self) -> dict:
        log_info("RPC reset_shortcut_registry")
        return await self.flatpak.reset_shortcut_registry()

    async def inspect_shortcuts_vdf(self, payload: dict | None = None) -> dict:
        return await self.flatpak.inspect_shortcuts_vdf(payload)

    async def get_steamgriddb_status(self) -> dict:
        return await self.flatpak.get_steamgriddb_status()

    async def set_steamgriddb_api_key(self, api_key: str) -> dict:
        log_info("RPC set_steamgriddb_api_key")
        return await self.flatpak.set_steamgriddb_api_key(api_key)

    async def clear_steamgriddb_api_key(self) -> dict:
        log_info("RPC clear_steamgriddb_api_key")
        return await self.flatpak.clear_steamgriddb_api_key()

    async def fetch_steamgriddb_capsule(self, name: str) -> dict:
        log_info("RPC fetch_steamgriddb_capsule")
        return await self.flatpak.fetch_steamgriddb_capsule(name)

    async def get_steamgriddb_asset(self, category: str) -> dict:
        return await self.flatpak.get_steamgriddb_asset(category)

    async def _main(self) -> None:
        self.instance_id = uuid.uuid4().hex[:8]
        self.flatpak = FlatpakService()
        log_info(
            "backend started instance=%s pid=%s log=%s"
            % (
                self.instance_id,
                os.getpid(),
                getattr(decky, "DECKY_PLUGIN_LOG", None),
            )
        )
        try:
            import asyncio

            asyncio.create_task(self.flatpak.probe_session_bridge())
        except Exception:
            pass

    async def _unload(self) -> None:
        log_info(f"backend unloading instance={self.instance_id}")
        try:
            await self.flatpak.shutdown()
        except Exception as exc:  # noqa: BLE001 - unload must continue
            log_error("failed cancelling Flatpak tasks", exc)
        log_info(f"backend unloaded instance={self.instance_id}")

    async def _uninstall(self) -> None:
        log_info(
            f"backend uninstall instance={self.instance_id}; "
            "plugin-owned settings/runtime files only, user apps are not removed"
        )
        try:
            result = self.flatpak.uninstall_owned_files()
            log_info(f"plugin-owned files removed={result.get('removed')}")
        except Exception as exc:  # noqa: BLE001 - uninstall must continue
            log_error("failed removing plugin-owned files", exc)

    async def _migration(self) -> None:
        log_info("no plugin migrations")
