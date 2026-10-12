"""The Python Panel: a QWebEngineView onto the sidecar's page. Nothing else lives here.

Startup is asynchronous on purpose: createInterface runs on Houdini's main
thread, so the sidecar is spawned and then polled from a QTimer while a
placeholder shows. A blocking wait here froze Houdini for seconds.
"""

from __future__ import annotations

import os
import traceback

from PySide6 import QtCore, QtWidgets

from houdini_pi import sidecar

BRIDGE_PORT_ENV = "HOUDINI_PI_BRIDGE_PORT"
POLL_MS = 250
GIVE_UP_AFTER_POLLS = 120


def houdini_bridge_port() -> int:
    return int(os.environ.get(BRIDGE_PORT_ENV, "8100"))


class AgentPane(QtWidgets.QStackedWidget):
    def __init__(self):
        super().__init__()
        self._label = QtWidgets.QLabel("Starting the houdini-pi sidecar…")
        self._label.setWordWrap(True)
        self._label.setTextInteractionFlags(QtCore.Qt.TextSelectableByMouse)
        self._label.setAlignment(QtCore.Qt.AlignTop)
        self.addWidget(self._label)
        self._timer = QtCore.QTimer(self)
        self._timer.setInterval(POLL_MS)
        self._timer.timeout.connect(self._poll)
        self._pending: sidecar.Pending | None = None
        try:
            started = sidecar.start_sidecar(os.getpid(), houdini_bridge_port())
        except Exception:
            self._fail(traceback.format_exc())
            return
        if isinstance(started, str):
            self._show(started)
        else:
            self._pending = started
            self._timer.start()

    def _poll(self):
        pending = self._pending
        if pending is None:
            self._timer.stop()
            return
        url = pending.url_if_ready()
        if url is not None:
            self._timer.stop()
            self._show(url)
            return
        if pending.polls >= GIVE_UP_AFTER_POLLS:
            self._timer.stop()
            self._fail(f"sidecar did not answer on port {pending.port} within {GIVE_UP_AFTER_POLLS * POLL_MS // 1000}s.\n\nLog: {pending.log}\n\n{_tail(pending.log)}")

    def _show(self, url: str):
        try:
            from PySide6 import QtWebEngineWidgets
        except ImportError:
            self._fail("This Houdini's PySide6 has no QtWebEngineWidgets; houdini-pi needs it.")
            return
        view = QtWebEngineWidgets.QWebEngineView()
        view.setUrl(QtCore.QUrl(url))
        self.addWidget(view)
        self.setCurrentWidget(view)

    def _fail(self, text: str):
        self._label.setText(text)
        self.setCurrentWidget(self._label)


def _tail(path, lines: int = 20) -> str:
    try:
        return "\n".join(path.read_text(errors="replace").splitlines()[-lines:])
    except OSError:
        return "(no log yet)"


def createInterface():  # noqa: N802  (Houdini's required name)
    return AgentPane()


INTERFACE_NAME = "houdini_pi"


def open_pane():
    """Show the Pi pane as a docked tab: reuse an open one, else add a tab beside the Parameter view.

    The pane is a Python Panel interface, so it also appears in every pane's
    tab-type menu (New Tab ▸ Python Panel ▸ Pi) like the Geometry Spreadsheet.
    """
    import hou

    for tab in hou.ui.paneTabs():
        is_ours = tab.type() == hou.paneTabType.PythonPanel and tab.activeInterface() is not None and tab.activeInterface().name() == INTERFACE_NAME
        if is_ours:
            tab.setIsCurrentTab()
            return tab

    desktop = hou.ui.curDesktop()
    anchor = desktop.paneTabOfType(hou.paneTabType.Parm) or desktop.paneTabOfType(hou.paneTabType.NetworkEditor)
    pane = anchor.pane() if anchor is not None else None
    tab = pane.createTab(hou.paneTabType.PythonPanel) if pane is not None else desktop.createFloatingPaneTab(hou.paneTabType.PythonPanel)
    tab.setActiveInterface(hou.pypanel.interfaceByName(INTERFACE_NAME))
    tab.setIsCurrentTab()
    return tab
