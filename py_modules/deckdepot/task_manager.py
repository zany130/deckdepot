"""Owned Flatpak mutation tasks with phase events and process-group cancel."""

from __future__ import annotations

import asyncio
import os
import signal
import time
import uuid
from typing import Any

import decky

from deckdepot.diagnostics import log_info
from deckdepot.errors import EngineError
from deckdepot.appman_engine import (
    APPMAN_UPDATE_ALL_APP_ID,
    MUTATION_TIMEOUT_SEC as APPMAN_TIMEOUT_SEC,
    interpret_result as interpret_appman_result,
    list_installed as list_appman_installed,
    require_installed as require_appman_installed,
    spawn_mutation as spawn_appman_mutation,
)
from deckdepot.appman_ids import validate_appman_name, validate_source_id
from deckdepot.flatpak_engine import (
    COMMAND_TIMEOUT_SEC,
    SYSTEM_UPDATE_ALL_APP_ID,
    SYSTEM_UPDATE_ALL_ARGS,
    UPDATE_ALL_APP_ID,
    confirm_named_remote_ref,
    confirm_remote_app_for_scope,
    find_installed_scopes,
    is_flathub_remote,
    list_installed,
    mutation_argv,
    require_installed_in_scope,
    spawn_mutation,
)
from deckdepot.flatpak_scope import resolve_new_install_scope
from deckdepot.session_bridge import probe_capability, spawn_system_flatpak, stop_bridged_unit
from deckdepot.system_inventory import list_system_installed
from deckdepot.plugin_files import load_interrupted_task, persist_interrupted_task
from deckdepot.ids import validate_flatpak_app_id, validate_flatpak_ref, validate_remote_name
from deckdepot.redact import redact_text

TASK_EVENT_NAME = "deckdepot:task-event"
CANCEL_GRACE_SEC = 8
ACTIVE_PHASES = {"queued", "starting", "running", "verifying", "cancelling"}
PUMP_CHUNK_SIZE = 4096
PUMP_DRAIN_TIMEOUT_SEC = 3


def _now_ms() -> int:
    return int(time.time() * 1000)


def _phase_status(operation: str, phase: str) -> str:
    if phase in {"queued", "starting"}:
        return "Starting…"
    if phase == "verifying":
        return "Verifying…"
    if phase == "cancelling":
        return "Cancelling…"
    if phase == "cancelled":
        return "Cancelled"
    if phase == "failed":
        return "Failed"
    if phase == "completed":
        if operation == "install":
            return "Installed"
        if operation == "uninstall":
            return "Removed"
        return "Updated"
    if operation == "install":
        return "Installing…"
    if operation == "uninstall":
        return "Removing…"
    return "Updating…"


class TaskManager:
    def __init__(self) -> None:
        self.session_id = uuid.uuid4().hex[:8]
        self._lock = asyncio.Lock()
        self._tasks: dict[str, dict[str, Any]] = {}
        self._active_id: str | None = None
        self._proc: asyncio.subprocess.Process | None = None
        self._runner: asyncio.Task[Any] | None = None
        interrupted = load_interrupted_task()
        if interrupted and isinstance(interrupted.get("taskId"), str):
            interrupted["backendSessionId"] = self.session_id
            self._tasks[str(interrupted["taskId"])] = interrupted

    def snapshot(self, task_id: str) -> dict[str, Any]:
        task = self._tasks.get(task_id)
        if not task:
            raise EngineError("INVALID_ARGUMENT", f"unknown task {task_id}")
        return dict(task)

    def all_snapshots(self) -> list[dict[str, Any]]:
        return [dict(task) for task in self._tasks.values()]

    def session_info(self) -> dict[str, Any]:
        return {"backendSessionId": self.session_id}

    async def _emit(self, task: dict[str, Any]) -> None:
        payload = dict(task)
        await decky.emit(TASK_EVENT_NAME, payload)

    def _set_phase(
        self,
        task: dict[str, Any],
        phase: str,
        *,
        status_text: str | None = None,
        error_message: str | None = None,
        exit_code: int | None = None,
    ) -> None:
        task["phase"] = phase
        task["updatedAtMs"] = _now_ms()
        if status_text is not None:
            task["statusText"] = status_text
        if error_message is not None:
            task["errorMessage"] = error_message
        if exit_code is not None:
            task["exitCode"] = exit_code

    async def start(
        self,
        operation: str,
        app_id: str,
        ref: str | None = None,
        *,
        provider: str = "flatpak",
        source_id: str = "am",
        installation_scope: str | None = None,
        remote_name: str | None = None,
    ) -> dict[str, Any]:
        if provider not in {"flatpak", "appman"}:
            raise EngineError("INVALID_ARGUMENT", "unsupported provider")
        requested_remote_name = remote_name
        remote_name = None
        if operation == "update_all":
            if provider == "flatpak":
                scope = (installation_scope or "user").strip().lower()
                if scope not in {"user", "system"}:
                    raise EngineError("INVALID_ARGUMENT", "update-all scope must be user or system")
                if scope == "system":
                    await _require_system_bridge()
                    app_id = SYSTEM_UPDATE_ALL_APP_ID
                else:
                    app_id = UPDATE_ALL_APP_ID
                installation_scope = scope
                ref = None
                source_id = "am"
            elif provider == "appman":
                app_id = APPMAN_UPDATE_ALL_APP_ID
                ref = None
                source_id = "am"
                installation_scope = "user"
            else:
                raise EngineError("INVALID_ARGUMENT", "unsupported provider")
        elif provider == "appman":
            app_id = validate_appman_name(app_id)
            source_id = validate_source_id(source_id)
            if operation not in {"install", "update", "uninstall"}:
                raise EngineError("INVALID_ARGUMENT", "unsupported operation")
            if operation in {"update", "uninstall"}:
                await require_appman_installed(app_id, source_id)
            installation_scope = "user"
            remote_name = None
            ref = None
        else:
            app_id = validate_flatpak_app_id(app_id)
            source_id = "am"
            if operation not in {"install", "update", "uninstall"}:
                raise EngineError("INVALID_ARGUMENT", "unsupported operation")
            requested = (installation_scope or "").strip().lower() or None
            if requested not in {None, "user", "system"}:
                raise EngineError("INVALID_ARGUMENT", "installation scope must be user or system")
            requested_remote = (requested_remote_name or "").strip() or None
            if requested_remote:
                requested_remote = validate_remote_name(requested_remote)
            if operation == "install":
                from deckdepot.flatpak_catalog import reject_denied_install

                await reject_denied_install(app_id)
                third_party = bool(
                    requested_remote and not is_flathub_remote(requested_remote)
                )
                if third_party:
                    if requested not in {"user", "system"}:
                        raise EngineError(
                            "INVALID_ARGUMENT",
                            "Third-party Flatpak installs require an explicit user or system scope.",
                        )
                    installation_scope = requested
                    if installation_scope == "system":
                        await _require_system_bridge()
                    confirmed_remote, confirmed_ref = await confirm_named_remote_ref(
                        app_id,
                        installation_scope,
                        requested_remote,
                        ref,
                    )
                    remote_name = confirmed_remote
                    ref = confirmed_ref
                else:
                    installation_scope = await resolve_new_install_scope(requested)
                    if installation_scope == "system":
                        await _require_system_bridge()
                    remote_name = await confirm_remote_app_for_scope(
                        app_id, installation_scope
                    )
                    if ref:
                        ref = validate_flatpak_ref(ref, app_id=app_id)
            else:
                installation_scope = await _resolve_existing_scope(app_id, requested)
                if installation_scope == "system":
                    await _require_system_bridge()
            if operation == "update" and ref:
                ref = validate_flatpak_ref(ref, app_id=app_id)
            elif operation != "install":
                ref = None

        async with self._lock:
            if self._active_id is not None:
                active = self._tasks[self._active_id]
                if active["phase"] in ACTIVE_PHASES:
                    raise EngineError(
                        "PROCESS_FAILED",
                        "Another package task is already running.",
                        details={"activeTaskId": self._active_id},
                    )
            task_id = uuid.uuid4().hex[:12]
            task = {
                "ok": True,
                "taskId": task_id,
                "backendSessionId": self.session_id,
                "provider": provider,
                "appId": app_id,
                "sourceId": source_id if provider == "appman" else None,
                "installationScope": installation_scope or "user",
                "remoteName": remote_name,
                "ref": ref,
                "operation": operation,
                "phase": "queued",
                "progressKind": "indeterminate",
                "statusText": _phase_status(operation, "queued"),
                "createdAtMs": _now_ms(),
                "updatedAtMs": _now_ms(),
            }
            self._tasks[task_id] = task
            self._active_id = task_id
            await self._emit(task)
            self._runner = asyncio.create_task(self._run(task_id))

        log_info(f"task {task_id} {operation} {app_id} queued")
        return {"ok": True, "taskId": task_id, "task": dict(task)}

    async def cancel(self, task_id: str) -> dict[str, Any]:
        async with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                raise EngineError("INVALID_ARGUMENT", f"unknown task {task_id}")
            if task["phase"] not in {"queued", "starting", "running"}:
                return {"ok": True, "task": dict(task), "alreadyFinished": True}
            self._set_phase(
                task, "cancelling", status_text=_phase_status(task["operation"], "cancelling")
            )
            proc = self._proc
        await self._emit(task)
        log_info(f"task {task_id} cancelling")
        if proc is not None and proc.returncode is None:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        unit = task.get("bridgeUnit")
        if unit:
            await stop_bridged_unit(str(unit))
        return {"ok": True, "task": dict(task)}

    async def cancel_active(self) -> None:
        task_id = self._active_id
        was_active = False
        if task_id and task_id in self._tasks:
            was_active = self._tasks[task_id].get("phase") in ACTIVE_PHASES
            try:
                await self.cancel(task_id)
            except EngineError:
                pass
        runner = self._runner
        if runner and not runner.done():
            try:
                await asyncio.wait_for(
                    asyncio.shield(runner),
                    timeout=CANCEL_GRACE_SEC + 4,
                )
            except (asyncio.TimeoutError, asyncio.CancelledError):
                runner.cancel()
                if self._proc is not None:
                    unit = None
                    if task_id and task_id in self._tasks:
                        unit = self._tasks[task_id].get("bridgeUnit")
                    await self._kill_group(self._proc, unit)
        if was_active and task_id:
            final = self._tasks.get(task_id)
            if final:
                persist_interrupted_task(final)

    async def _run(self, task_id: str) -> None:
        task = self._tasks[task_id]
        try:
            if task["phase"] == "cancelling":
                self._set_phase(
                    task, "cancelled", status_text=_phase_status(task["operation"], "cancelled")
                )
                return
            self._set_phase(
                task, "starting", status_text=_phase_status(task["operation"], "starting")
            )
            await self._emit(task)
            if task["phase"] == "cancelling":
                self._set_phase(
                    task, "cancelled", status_text=_phase_status(task["operation"], "cancelled")
                )
                return
            if task.get("provider") == "appman":
                proc = await spawn_appman_mutation(
                    task["operation"],
                    task["appId"],
                    source_id=str(task.get("sourceId") or "am"),
                )
                timeout = APPMAN_TIMEOUT_SEC.get(
                    task["operation"], APPMAN_TIMEOUT_SEC["update"]
                )
            elif task.get("installationScope") == "system":
                unit = f"deckdepot-system-flatpak-{task_id}.service"
                task["bridgeUnit"] = unit
                if task["operation"] == "update_all":
                    args = list(SYSTEM_UPDATE_ALL_ARGS)
                else:
                    args = mutation_argv(
                        task["operation"],
                        task["appId"],
                        ref=task.get("ref"),
                        scope="system",
                        remote_name=str(task.get("remoteName") or "flathub"),
                    )
                proc = await spawn_system_flatpak(
                    args,
                    unit=unit,
                    timeout_sec=COMMAND_TIMEOUT_SEC[
                        "update" if task["operation"] == "update_all" else task["operation"]
                    ],
                )
                timeout = COMMAND_TIMEOUT_SEC[
                    "update" if task["operation"] == "update_all" else task["operation"]
                ]
            else:
                proc = await spawn_mutation(
                    task["operation"],
                    task["appId"],
                    ref=task.get("ref"),
                    scope=str(task.get("installationScope") or "user"),
                    remote_name=str(task.get("remoteName") or "flathub"),
                )
                timeout = COMMAND_TIMEOUT_SEC[
                    "update" if task["operation"] == "update_all" else task["operation"]
                ]
            self._proc = proc
            if task["phase"] == "cancelling":
                try:
                    os.killpg(proc.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            else:
                self._set_phase(
                    task, "running", status_text=_phase_status(task["operation"], "running")
                )
                await self._emit(task)
            stdout, stderr, exit_code = await self._wait(proc, timeout, task)
            cancelled = task["phase"] == "cancelling"
            if cancelled:
                self._set_phase(
                    task,
                    "cancelled",
                    status_text=_phase_status(task["operation"], "cancelled"),
                    exit_code=exit_code,
                )
            elif task.get("provider") == "appman":
                await self._finish_appman_task(
                    task, stdout, stderr, exit_code, timeout
                )
            elif exit_code == 0:
                self._set_phase(
                    task,
                    "verifying",
                    status_text=_phase_status(task["operation"], "verifying"),
                    exit_code=0,
                )
                await self._emit(task)
                verified, verify_error = await _verify_flatpak_result(task)
                if verified:
                    self._set_phase(
                        task,
                        "completed",
                        status_text=_phase_status(task["operation"], "completed"),
                        exit_code=0,
                    )
                else:
                    self._set_phase(
                        task,
                        "failed",
                        status_text=_phase_status(task["operation"], "failed"),
                        exit_code=0,
                        error_message=verify_error
                        or "Command finished but installed state did not change as expected.",
                    )
                    task["errorCode"] = "STATE_UNCHANGED"
            else:
                error_code, error_message = _classify_flatpak_failure(
                    str(task.get("installationScope") or "user"),
                    stdout,
                    stderr,
                    exit_code,
                )
                self._set_phase(
                    task,
                    "failed",
                    status_text=_phase_status(task["operation"], "failed"),
                    exit_code=exit_code,
                    error_message=redact_text(error_message),
                )
                task["errorCode"] = error_code
        except EngineError as exc:
            self._set_phase(
                task,
                "failed",
                status_text=_phase_status(task.get("operation") or "install", "failed"),
                error_message=exc.message,
            )
            task["errorCode"] = exc.code
        except Exception as exc:  # noqa: BLE001
            self._set_phase(
                task,
                "failed",
                status_text=_phase_status(task.get("operation") or "install", "failed"),
                error_message=f"{type(exc).__name__}: {exc}",
            )
            task["errorCode"] = "INTERNAL_ERROR"
        finally:
            self._proc = None
            self._runner = None
            if self._active_id == task_id:
                self._active_id = None
            try:
                if task.get("provider") == "appman":
                    installed = await list_appman_installed()
                    source_id = task.get("sourceId") or "am"
                    present = any(
                        row["appId"] == task["appId"]
                        and row.get("sourceId") == source_id
                        for row in installed["apps"]
                    )
                else:
                    installed = await _list_scope(task.get("installationScope") or "user")
                    present = any(
                        row["appId"] == task["appId"] for row in installed["apps"]
                    )
                task["installedAfter"] = {
                    "appId": task["appId"],
                    "present": present,
                    "appCount": len(installed["apps"]),
                }
            except Exception:
                task["installedAfter"] = None
            log_info(
                "task %s %s %s phase=%s present=%s"
                % (
                    task_id,
                    task.get("operation"),
                    task.get("appId"),
                    task.get("phase"),
                    (task.get("installedAfter") or {}).get("present"),
                )
            )
            await self._emit(task)

    async def _finish_appman_task(
        self,
        task: dict[str, Any],
        stdout: str,
        stderr: str,
        exit_code: int | None,
        timeout: int,
    ) -> None:
        marker_ok, detail = interpret_appman_result(task["operation"], stdout, stderr)
        output = redact_text(detail or f"{stderr}\n{stdout}".strip() or "AppMan command failed")
        if task.get("timedOut"):
            self._set_phase(
                task,
                "failed",
                status_text=_phase_status(task["operation"], "failed"),
                exit_code=exit_code,
                error_message=f"AppMan {task['operation']} timed out after {timeout}s. {output}",
            )
            task["errorCode"] = "PROCESS_TIMEOUT"
            return
        self._set_phase(
            task,
            "verifying",
            status_text=_phase_status(task["operation"], "verifying"),
            exit_code=exit_code,
        )
        await self._emit(task)
        verified, verify_error = await _verify_appman_result(task)
        operation = task["operation"]
        # AppMan 10.5-1 often prints INSTALLATION ABORTED after a wget2/curl
        # checksum warning even when the app is present in `appman -f`. Inventory
        # is the success contract; abort text is only used when the app is absent.
        if operation == "install":
            if verified:
                self._set_phase(
                    task,
                    "completed",
                    status_text=_phase_status(operation, "completed"),
                    exit_code=exit_code,
                )
                return
            self._set_phase(
                task,
                "failed",
                status_text=_phase_status(operation, "failed"),
                exit_code=exit_code,
                error_message=redact_text(
                    verify_error
                    or output
                    or "AppMan finished but the app was not in the installed inventory."
                ),
            )
            task["errorCode"] = "STATE_UNCHANGED" if marker_ok else "PROCESS_FAILED"
            return
        if operation == "uninstall":
            if verified:
                self._set_phase(
                    task,
                    "completed",
                    status_text=_phase_status(operation, "completed"),
                    exit_code=exit_code,
                )
                return
            self._set_phase(
                task,
                "failed",
                status_text=_phase_status(operation, "failed"),
                exit_code=exit_code,
                error_message=redact_text(
                    verify_error
                    or output
                    or "AppMan finished but the app is still installed."
                ),
            )
            task["errorCode"] = "STATE_UNCHANGED" if marker_ok else "PROCESS_FAILED"
            return
        if marker_ok and verified:
            self._set_phase(
                task,
                "completed",
                status_text=_phase_status(operation, "completed"),
                exit_code=exit_code,
            )
            return
        self._set_phase(
            task,
            "failed",
            status_text=_phase_status(operation, "failed"),
            exit_code=exit_code,
            error_message=redact_text(
                verify_error or output or "AppMan command failed"
            ),
        )
        task["errorCode"] = "STATE_UNCHANGED" if marker_ok else "PROCESS_FAILED"

    async def _wait(
        self,
        proc: asyncio.subprocess.Process,
        timeout: int,
        task: dict[str, Any],
    ) -> tuple[str, str, int | None]:
        stdout_chunks: list[bytes] = []
        stderr_chunks: list[bytes] = []
        started = time.monotonic()

        async def _pump(stream: asyncio.StreamReader | None, store: list[bytes]) -> None:
            if stream is None:
                return
            while True:
                # Chunk reads, not readline(): curl/wget progress uses `\r` with
                # no newline and will fill the pipe until the parent drains it.
                chunk = await stream.read(PUMP_CHUNK_SIZE)
                if not chunk:
                    return
                store.append(chunk)

        pumpers = [
            asyncio.create_task(_pump(proc.stdout, stdout_chunks)),
            asyncio.create_task(_pump(proc.stderr, stderr_chunks)),
        ]
        deadline = time.monotonic() + timeout
        cancel_deadline: float | None = None
        while proc.returncode is None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                await self._kill_group(proc, task.get("bridgeUnit"))
                await proc.wait()
                task["timedOut"] = True
                break
            if task["phase"] == "cancelling":
                if cancel_deadline is None:
                    cancel_deadline = time.monotonic() + CANCEL_GRACE_SEC
                if time.monotonic() >= cancel_deadline:
                    await self._kill_group(proc, task.get("bridgeUnit"))
                    if proc.returncode is None:
                        await proc.wait()
                    break
            try:
                await asyncio.wait_for(proc.wait(), timeout=min(0.5, remaining))
            except asyncio.TimeoutError:
                continue
        _done, pending_pumps = await asyncio.wait(
            pumpers, timeout=PUMP_DRAIN_TIMEOUT_SEC
        )
        for pumper in pending_pumps:
            pumper.cancel()
        if pending_pumps:
            await asyncio.gather(*pending_pumps, return_exceptions=True)
        stdout = b"".join(stdout_chunks).decode("utf-8", "replace")
        stderr = b"".join(stderr_chunks).decode("utf-8", "replace")
        log_info(
            "task %s wait rc=%s elapsed=%.1fs timedOut=%s stdout=%d stderr=%d"
            % (
                task.get("taskId"),
                proc.returncode,
                time.monotonic() - started,
                bool(task.get("timedOut")),
                len(stdout),
                len(stderr),
            )
        )
        return stdout, stderr, proc.returncode

    async def _kill_group(
        self, proc: asyncio.subprocess.Process, unit: str | None = None
    ) -> None:
        if proc.returncode is None:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if unit:
            await stop_bridged_unit(str(unit))


async def _require_system_bridge() -> None:
    capability = await probe_capability()
    if capability.get("available"):
        return
    raise EngineError(
        str(capability.get("errorCode") or "SESSION_BRIDGE_UNAVAILABLE"),
        str(capability.get("reason") or "System Flatpak management is unavailable."),
        details=capability,
    )


async def _resolve_existing_scope(app_id: str, requested: str | None) -> str:
    if requested in {"user", "system"}:
        await require_installed_in_scope(app_id, requested)
        return requested
    found = await find_installed_scopes(app_id)
    if found == ["user"]:
        return "user"
    if found == ["system"]:
        return "system"
    if len(found) > 1:
        raise EngineError(
            "AMBIGUOUS_SCOPE",
            f"{app_id} is installed in both user and system scopes. Choose one.",
            details={"scopes": found},
        )
    raise EngineError(
        "INVALID_ARGUMENT",
        f"{app_id} is not an installed Flatpak.",
    )


async def _list_scope(scope: str) -> dict[str, Any]:
    if scope == "system":
        return await list_system_installed()
    return await list_installed()


async def _verify_appman_result(task: dict[str, Any]) -> tuple[bool, str | None]:
    operation = task.get("operation")
    try:
        installed = await list_appman_installed()
    except EngineError as exc:
        return False, exc.message
    if operation == "update_all":
        return True, None
    source_id = task.get("sourceId") or "am"
    present = any(
        row["appId"] == task["appId"] and row.get("sourceId") == source_id
        for row in installed["apps"]
    )
    if operation == "install":
        if present:
            return True, None
        return False, (
            f"{task['appId']} was not found in the AppMan inventory after install."
        )
    if operation == "uninstall":
        if not present:
            return True, None
        return False, (
            f"{task['appId']} is still present in the AppMan inventory after uninstall."
        )
    if operation == "update":
        if present:
            return True, None
        return False, (
            f"{task['appId']} is no longer installed after AppMan update."
        )
    return True, None


async def _verify_flatpak_result(task: dict[str, Any]) -> tuple[bool, str | None]:
    scope = str(task.get("installationScope") or "user")
    operation = task.get("operation")
    try:
        installed = await _list_scope(scope)
    except EngineError as exc:
        return False, exc.message
    if operation == "update_all":
        return True, None
    present = any(row["appId"] == task["appId"] for row in installed["apps"])
    if operation == "install":
        if present:
            return True, None
        return False, (
            f"{task['appId']} was not found in the {scope}-scoped inventory after install."
        )
    if operation == "uninstall":
        if not present:
            return True, None
        return False, (
            f"{task['appId']} is still present in the {scope}-scoped inventory after uninstall."
        )
    if operation == "update":
        if present:
            return True, None
        return False, (
            f"{task['appId']} is no longer installed in {scope} scope after update."
        )
    return True, None


def _classify_flatpak_failure(
    scope: str, stdout: str, stderr: str, exit_code: int | None
) -> tuple[str, str]:
    blob = f"{stderr}\n{stdout}".lower()
    detail = (stderr or stdout or "Flatpak command failed").strip()[:1500]
    if scope == "system":
        if "failed to connect" in blob or "not defined" in blob:
            return (
                "SESSION_BRIDGE_UNAVAILABLE",
                "Could not reach the user systemd manager for system Flatpak actions.",
            )
        if (
            "not authorized" in blob
            or "auth_admin" in blob
            or "authentication is required" in blob
            or "polkit" in blob
        ):
            return (
                "SESSION_BRIDGE_UNAUTHORIZED",
                "System Flatpak authorization was denied by the host policy.",
            )
    if "remote" in blob and (
        "not found" in blob or "can't find" in blob or "cannot find" in blob
    ):
        return ("FLATHUB_REMOTE_MISSING", detail or "The Flatpak remote is unavailable.")
    if any(
        marker in blob
        for marker in (
            "network is unreachable",
            "temporary failure in name resolution",
            "could not connect",
            "failed to download",
        )
    ):
        return ("NETWORK_FAILURE", detail or "The Flatpak download failed.")
    if exit_code is None:
        return ("PROCESS_FAILED", detail or "Flatpak command failed.")
    return ("PROCESS_FAILED", detail)
