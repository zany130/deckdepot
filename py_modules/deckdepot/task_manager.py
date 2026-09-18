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
    UPDATE_ALL_APP_ID,
    confirm_remote_app,
    list_installed,
    require_installed,
    spawn_mutation,
)
from deckdepot.plugin_files import load_interrupted_task, persist_interrupted_task
from deckdepot.ids import validate_flatpak_app_id, validate_flatpak_ref
from deckdepot.redact import redact_text

TASK_EVENT_NAME = "deckdepot:task-event"
CANCEL_GRACE_SEC = 8
STATUS_EMIT_INTERVAL_SEC = 0.4
ACTIVE_PHASES = {"queued", "starting", "running", "cancelling"}


def _now_ms() -> int:
    return int(time.time() * 1000)


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
    ) -> dict[str, Any]:
        if provider not in {"flatpak", "appman"}:
            raise EngineError("INVALID_ARGUMENT", "unsupported provider")
        if operation == "update_all":
            if provider == "flatpak":
                app_id = UPDATE_ALL_APP_ID
                ref = None
                source_id = "am"
            elif provider == "appman":
                app_id = APPMAN_UPDATE_ALL_APP_ID
                ref = None
                source_id = "am"
            else:
                raise EngineError("INVALID_ARGUMENT", "unsupported provider")
        elif provider == "appman":
            app_id = validate_appman_name(app_id)
            source_id = validate_source_id(source_id)
            if operation not in {"install", "update", "uninstall"}:
                raise EngineError("INVALID_ARGUMENT", "unsupported operation")
            if operation in {"update", "uninstall"}:
                await require_appman_installed(app_id, source_id)
            ref = None
        else:
            app_id = validate_flatpak_app_id(app_id)
            source_id = "am"
            if operation not in {"install", "update", "uninstall"}:
                raise EngineError("INVALID_ARGUMENT", "unsupported operation")
            if operation == "install":
                await confirm_remote_app(app_id)
            elif operation in {"update", "uninstall"}:
                await require_installed(app_id)
            if operation == "update" and ref:
                ref = validate_flatpak_ref(ref, app_id=app_id)
            else:
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
                "ref": ref,
                "operation": operation,
                "phase": "queued",
                "progressKind": "indeterminate",
                "statusText": f"{operation} queued",
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
            self._set_phase(task, "cancelling", status_text="cancelling")
            proc = self._proc
        await self._emit(task)
        log_info(f"task {task_id} cancelling")
        if proc is not None and proc.returncode is None:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
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
                    await self._kill_group(self._proc)
        if was_active and task_id:
            final = self._tasks.get(task_id)
            if final:
                persist_interrupted_task(final)

    async def _run(self, task_id: str) -> None:
        task = self._tasks[task_id]
        try:
            if task["phase"] == "cancelling":
                self._set_phase(task, "cancelled", status_text="cancelled")
                return
            self._set_phase(task, "starting", status_text="starting")
            await self._emit(task)
            if task["phase"] == "cancelling":
                self._set_phase(task, "cancelled", status_text="cancelled")
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
            else:
                proc = await spawn_mutation(
                    task["operation"],
                    task["appId"],
                    ref=task.get("ref"),
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
                self._set_phase(task, "running", status_text="running")
                await self._emit(task)
            stdout, stderr, exit_code = await self._wait(proc, timeout, task)
            cancelled = task["phase"] == "cancelling"
            if cancelled:
                self._set_phase(
                    task,
                    "cancelled",
                    status_text="cancelled",
                    exit_code=exit_code,
                )
            elif task.get("provider") == "appman":
                succeeded, detail = interpret_appman_result(
                    task["operation"], stdout, stderr
                )
                if succeeded:
                    self._set_phase(
                        task,
                        "completed",
                        status_text="completed",
                        exit_code=exit_code,
                    )
                else:
                    self._set_phase(
                        task,
                        "failed",
                        status_text="failed",
                        exit_code=exit_code,
                        error_message=redact_text(detail or "AppMan command failed"),
                    )
                    task["errorCode"] = "PROCESS_FAILED"
            elif exit_code == 0:
                self._set_phase(
                    task,
                    "completed",
                    status_text="completed",
                    exit_code=0,
                )
            else:
                self._set_phase(
                    task,
                    "failed",
                    status_text="failed",
                    exit_code=exit_code,
                    error_message=redact_text(
                        (stderr or stdout or "Flatpak command failed")[:1500]
                    ),
                )
                task["errorCode"] = "PROCESS_FAILED"
        except EngineError as exc:
            self._set_phase(
                task,
                "failed",
                status_text="failed",
                error_message=exc.message,
            )
            task["errorCode"] = exc.code
        except Exception as exc:  # noqa: BLE001
            self._set_phase(
                task,
                "failed",
                status_text="failed",
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
                    installed = await list_installed()
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

    async def _wait(
        self,
        proc: asyncio.subprocess.Process,
        timeout: int,
        task: dict[str, Any],
    ) -> tuple[str, str, int | None]:
        stdout_chunks: list[bytes] = []
        stderr_chunks: list[bytes] = []
        last_emit = 0.0

        async def _pump(stream: asyncio.StreamReader | None, store: list[bytes]) -> None:
            nonlocal last_emit
            if stream is None:
                return
            while True:
                line = await stream.readline()
                if not line:
                    return
                store.append(line)
                text = line.decode("utf-8", "replace").strip()
                if not text or task["phase"] not in {"running", "cancelling"}:
                    continue
                # Phase/status line only. Do not parse percentages.
                task["statusText"] = text[:200]
                task["updatedAtMs"] = _now_ms()
                now = time.monotonic()
                if now - last_emit >= STATUS_EMIT_INTERVAL_SEC:
                    last_emit = now
                    await self._emit(task)

        pumpers = [
            asyncio.create_task(_pump(proc.stdout, stdout_chunks)),
            asyncio.create_task(_pump(proc.stderr, stderr_chunks)),
        ]
        deadline = time.monotonic() + timeout
        cancel_deadline: float | None = None
        while proc.returncode is None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                await self._kill_group(proc)
                await proc.wait()
                task["timedOut"] = True
                break
            if task["phase"] == "cancelling":
                if cancel_deadline is None:
                    cancel_deadline = time.monotonic() + CANCEL_GRACE_SEC
                if time.monotonic() >= cancel_deadline:
                    await self._kill_group(proc)
                    if proc.returncode is None:
                        await proc.wait()
                    break
            try:
                await asyncio.wait_for(proc.wait(), timeout=min(0.5, remaining))
            except asyncio.TimeoutError:
                continue
        await asyncio.gather(*pumpers, return_exceptions=True)
        stdout = b"".join(stdout_chunks).decode("utf-8", "replace")
        stderr = b"".join(stderr_chunks).decode("utf-8", "replace")
        return stdout, stderr, proc.returncode

    async def _kill_group(self, proc: asyncio.subprocess.Process) -> None:
        if proc.returncode is not None:
            return
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            return
