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


def backup_scene() -> dict[str, Any]:
    """Write a Houdini backup (hou.hipFile.saveAsBackup) so a turn can be recovered beyond undo."""
    hou = _h()
    is_untitled = hou.hipFile.basename() == "untitled.hip" and not hou.hipFile.hasUnsavedChanges()
    if is_untitled:
        return {"skipped": "untitled scene"}
    return {"path": hou.hipFile.saveAsBackup()}


PANE_INTERFACE = "houdini_pi"


def _pi_link_group(hou: Any):
    """The link group of the Pi pane tab (Houdini's own Link Pane Tab widget), or None."""
    ui = getattr(hou, "ui", None)
    if ui is None:
        return None
    for tab in ui.paneTabs():
        is_ours = tab.type() == hou.paneTabType.PythonPanel and tab.activeInterface() is not None and tab.activeInterface().name() == PANE_INTERFACE
        if is_ours:
            return tab.linkGroup()
    return None


def follow_nodes(paths: list[str]) -> dict[str, Any]:
    """Make the scene follow the agent: select the last node it touched and, when the Pi pane
    is in a link group, point every pane tab in that group at it (network editors to its
    parent network, parameter views to the node)."""
    hou = _h()
    nodes = [node for node in (hou.node(path) for path in paths) if node is not None]
    if not nodes:
        return {"followed": None, "panes": 0}
    target = nodes[-1]
    target.setSelected(True, clear_all_selected=True)

    group = _pi_link_group(hou)
    linked = group is not None and group not in (hou.paneLinkType.Pinned, hou.paneLinkType.FollowSelection)
    panes = 0
    if linked:
        parent = target.parent() or target
        for tab in hou.ui.paneTabs():
            if tab.linkGroup() != group or tab.type() == hou.paneTabType.PythonPanel:
                continue
            if tab.type() == hou.paneTabType.NetworkEditor:
                tab.setPwd(parent)
                tab.setCurrentNode(target)
                panes += 1
            elif hasattr(tab, "setCurrentNode"):
                tab.setCurrentNode(target)
                panes += 1
    return {"followed": target.path(), "panes": panes}
