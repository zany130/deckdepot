"""Plugin logging and Decky TLS helper."""

from __future__ import annotations

import importlib
import ssl

import decky

from deckdepot.redact import redact_text

LOG_PREFIX = "[DeckDepot]"


def log_info(message: str) -> None:
    decky.logger.info("%s %s", LOG_PREFIX, redact_text(message))


def log_error(message: str, exc: BaseException | None = None) -> None:
    safe = redact_text(message)
    if exc is None:
        decky.logger.error("%s %s", LOG_PREFIX, safe)
        return
    decky.logger.error(
        "%s %s: %s: %s",
        LOG_PREFIX,
        safe,
        type(exc).__name__,
        redact_text(str(exc)),
    )


def helper_ssl_context() -> tuple[ssl.SSLContext | None, str]:
    for module_name in ("helpers", "decky_loader.helpers"):
        try:
            module = importlib.import_module(module_name)
            fn = getattr(module, "get_ssl_context", None)
            if not callable(fn):
                continue
            context = fn()
            if isinstance(context, ssl.SSLContext):
                return context, f"{module_name}.get_ssl_context"
        except Exception:
            continue
    return None, "unavailable"
