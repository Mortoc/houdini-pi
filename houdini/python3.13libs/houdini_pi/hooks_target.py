"""Helpers the sidecar runs inside Houdini through fxhoudinimcp's execute_python.

Every function returns something json.dumps can take, because the sidecar
reads the result as a JSON string. `hou` is imported lazily so the module can
be tested with a fake injected via `set_hou`.
"""

from __future__ import annotations

import importlib
from typing import Any

MEMORY_KEY = "houdini_pi.memory"
MEMORY_PREV_KEY = "houdini_pi.memory.prev"

_hou: Any = None
_open_group: Any = None


def set_hou(module: Any):
    """Inject a hou stand-in for tests; production resolves the real module."""
    global _hou
    _hou = module


def _h() -> Any:
    global _hou
    if _hou is None:
        _hou = importlib.import_module("hou")
    return _hou


def scene_context() -> dict[str, Any]:
    hou = _h()
    hip = hou.hipFile.path()
    is_untitled = hou.hipFile.basename() == "untitled.hip" and not hou.hipFile.hasUnsavedChanges()
    selected = [{"path": node.path(), "type": node.type().name()} for node in hou.selectedNodes()]
    current_network = None
    display_node = None
    # hou.ui exists only in a GUI session; hython and the tests have none.
    ui = getattr(hou, "ui", None)
    if ui is not None:
        pane = ui.paneTabOfType(hou.paneTabType.NetworkEditor)
        if pane is not None:
            network = pane.pwd()
            current_network = network.path()
            display = network.displayNode() if hasattr(network, "displayNode") else None
            display_node = display.path() if display is not None else None
    return {
        "hip": None if is_untitled else hip,
        "current_network": current_network,
        "selected": selected,
        "display_node": display_node,
        "frame": hou.frame(),
    }


def begin_turn(label: str) -> dict[str, Any]:
    """Open an undo group that outlives this request, so a whole agent turn is one Ctrl-Z.

    Houdini nests undo blocks by depth, so the per-command groups fxhoudinimcp
    opens inside this one merge into it rather than closing it.
    """
    global _open_group
    if _open_group is not None:
        end_turn()
    group = _h().undos.group(label)
    group.__enter__()
    _open_group = group
    return {"open": True}


def end_turn() -> dict[str, Any]:
    global _open_group
    if _open_group is None:
        return {"closed": False}
    group, _open_group = _open_group, None
    group.__exit__(None, None, None)
    return {"closed": True}


def turn_is_open() -> bool:
    return _open_group is not None


def memory_read() -> dict[str, Any]:
    root = _h().node("/")
    text = root.userData(MEMORY_KEY)
    prev = root.userData(MEMORY_PREV_KEY)
    return {"text": text or "", "prev": prev if prev else None}


def memory_write(text: str, prev: str | None) -> dict[str, Any]:
    root = _h().node("/")
    root.setUserData(MEMORY_KEY, text)
    if prev:
        root.setUserData(MEMORY_PREV_KEY, prev)
    elif root.userData(MEMORY_PREV_KEY) is not None:
        root.destroyUserData(MEMORY_PREV_KEY)
    return {"chars": len(text), "prev": bool(prev)}
