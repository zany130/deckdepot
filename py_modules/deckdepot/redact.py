"""Redact secrets before logging or returning error text."""

from __future__ import annotations

import re

_PATTERNS = (
    re.compile(r"(?i)(bearer\s+)[a-z0-9._\-+=/]+"),
    re.compile(r"(?i)(authorization:\s*bearer\s+)[a-z0-9._\-+=/]+"),
    re.compile(r"(?i)(api[_-]?key\s*[:=]\s*)\S+"),
    re.compile(r"(?i)(x-api-key\s*[:=]\s*)\S+"),
    re.compile(r"(?i)(password\s*[:=]\s*)\S+"),
    re.compile(r"(?i)(secret\s*[:=]\s*)\S+"),
)


def redact_text(message: str, extra_secret: str = "") -> str:
    text = str(message or "")
    if extra_secret:
        text = text.replace(extra_secret, "[redacted]")
    for pattern in _PATTERNS:
        text = pattern.sub(r"\1[redacted]", text)
    return text
