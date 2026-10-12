"""Decode what Houdini drags: nodes, parameters, channels, USD prims. Pure, tested without Qt."""

from __future__ import annotations

import re

# Houdini's own mime types, in the order the chips should list them.
HOUDINI_PATH_TYPES = (
    "application/sidefx-houdini-parm.path",
    "application/sidefx-houdini-channel.path",
    "application/sidefx-houdini-node.path",
    "application/sidefx-houdini-item.path",
    "application/sidefx-houdini-node.flag.path",
    "application/sidefx-houdini-usd.primitive.path",
    "application/sidefx-houdini-usd.property.path",
    "text/plain",
)

_PATH = re.compile(r"^/[A-Za-z0-9_][A-Za-z0-9_/.:\-]*$")


def is_houdini_drag(formats: list[str]) -> bool:
    return any(f in HOUDINI_PATH_TYPES for f in formats)


def paths_from_mime(data: dict[str, bytes | str]) -> list[str]:
    """Absolute Houdini paths from a drop's mime payloads, de-duplicated, first seen first."""
    found: list[str] = []
    for mime in HOUDINI_PATH_TYPES:
        raw = data.get(mime)
        if raw is None:
            continue
        text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else raw
        for token in re.split(r"[\s\x00]+", text):
            token = token.strip()
            if _PATH.match(token) and token not in found:
                found.append(token)
    return found
