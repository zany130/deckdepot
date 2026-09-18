"""Typed backend errors for the DeckDepot Flatpak engine."""

from __future__ import annotations

from typing import Any


class EngineError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "ok": False,
            "errorCode": self.code,
            "errorMessage": self.message,
        }
        if self.details:
            payload["details"] = self.details
        return payload
