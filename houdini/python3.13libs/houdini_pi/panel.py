"""The Python Panel: a QWebEngineView onto the sidecar's page. Nothing else lives here.

Startup is asynchronous on purpose: createInterface runs on Houdini's main
thread, so the sidecar is spawned and then polled from a QTimer while a
placeholder shows. A blocking wait here froze Houdini for seconds.
"""

from __future__ import annotations

import os
import traceback

import json

from PySide6 import QtCore, QtWidgets

from houdini_pi import drops, sidecar
from houdini_pi.sidecar import auto_layout_wanted, pane_zoom, software_render_wanted

POLL_MS = 250
GIVE_UP_AFTER_POLLS = 120


def _houdini_zoom() -> float:
    """Zoom for the page so it matches Houdini's Global UI Size preference."""
    try:
        import hou

        return pane_zoom(hou.ui.globalScaleFactor())
    except Exception:  # no UI (hython) or an old hou: render at 1x
        return 1.0


def _apply_auto_layout() -> None:
    """Set FXHOUDINIMCP_AUTO_LAYOUT in Houdini's env when houdini-pi is configured to.

    The fxhoudinimcp bridge reads this via `hou.getenv` first, so a `putenv` here
    wins over the package file for this session. None means: leave the upstream
    default (off) alone.
    """
    wanted = auto_layout_wanted()
    if wanted is None:
        return
    import hou

    hou.putenv("FXHOUDINIMCP_AUTO_LAYOUT", "1" if wanted else "0")


class _GluedPage:
    """A QWebEnginePage that never navigates away from the agent URL.

    This pane is an app, not a browser: the only navigation allowed is the
    initial load (and reloads of the exact same URL, e.g. the reconnect button).
    Link clicks, window.location changes, form submissions and target=_blank
    are all refused. Built lazily because QtWebEngineCore may not be importable
    until the view is created.
    """

    def __new__(cls, allowed_url: str, parent):
        from PySide6 import QtWebEngineCore, QtWebEngineWidgets

        class GluedPage(QtWebEngineCore.QWebEnginePage):
            def __init__(self, url: str, parent):
                super().__init__(parent)
                self._allowed = QtCore.QUrl(url)

            def acceptNavigationRequest(self, url, _nav_type, is_main_frame):
                # Only the exact initial URL, only in the main frame. Reloads
                # of the same URL pass; everything else is refused.
                return is_main_frame and url == self._allowed

        return GluedPage(allowed_url, parent)


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
        self._bridge_polls = 0
        _apply_auto_layout()
        self._timer.start()
        self._poll()

    def _start(self, bridge_port: int):
        try:
            started = sidecar.start_sidecar(os.getpid(), bridge_port)
        except Exception:
            self._timer.stop()
            self._fail(traceback.format_exc())
            return
        if isinstance(started, str):
            self._timer.stop()
            self._show(started)
        else:
            self._pending = started

    def _poll(self):
        pending = self._pending
        if pending is None:
            # The bridge may still be starting when the desktop builds this pane.
            port = sidecar.bridge_port()
            if port is not None:
                self._start(port)
                return
            self._bridge_polls += 1
            if self._bridge_polls >= GIVE_UP_AFTER_POLLS:
                self._timer.stop()
                self._fail(f"Houdini's fxhoudinimcp bridge did not start within {GIVE_UP_AFTER_POLLS * POLL_MS // 1000}s.")
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
        if software_render_wanted():
            _keep_the_pane_off_the_gpu()
        try:
            from PySide6 import QtWebEngineWidgets
        except ImportError:
            self._fail("This Houdini's PySide6 has no QtWebEngineWidgets; houdini-pi needs it.")
            return
        view = QtWebEngineWidgets.QWebEngineView()
        # Glue the page: no navigation away from the agent, ever.
        view.setPage(_GluedPage(url, view))
        self._drops = DropForwarder(view)
        # Follow Houdini's Global UI Size. Chromium can reset zoom on load, so
        # set it again once the page is in.
        zoom = _houdini_zoom()
        view.setZoomFactor(zoom)
        view.loadFinished.connect(lambda _ok: view.setZoomFactor(zoom))
        view.setUrl(QtCore.QUrl(url))
        self.addWidget(view)
        self.setCurrentWidget(view)

    def _fail(self, text: str):
        self._label.setText(text)
        self.setCurrentWidget(self._label)


def _keep_the_pane_off_the_gpu():
    """Render the web view in software, so it never competes with COPs for the GPU.

    QWebEngineView draws through a Qt Quick scene graph that wants its own GL
    context. With the card full (Copernicus + a model server), that context
    creation failed and Qt treated it as fatal: Houdini aborted in
    QSGRenderLoop::handleContextCreationFailure on 2026-10-12. Software Quick
    plus Chromium without GPU compositing takes the pane out of that contest,
    at the cost of GPU-smooth scrolling. Both must be set before QtWebEngine
    starts.
    """
    flags = os.environ.get("QTWEBENGINE_CHROMIUM_FLAGS", "")
    for flag in ("--disable-gpu", "--disable-gpu-compositing"):
        if flag not in flags:
            flags = f"{flags} {flag}".strip()
    os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = flags
    try:
        from PySide6 import QtQuick

        QtQuick.QQuickWindow.setGraphicsApi(QtQuick.QSGRendererInterface.GraphicsApi.Software)
    except Exception as exc:  # already decided by an earlier Quick window; nothing to do about it now
        print(f"[houdini-pi] could not select the software scene graph: {exc}")


class DropForwarder(QtCore.QObject):
    """Hand Houdini's own drags (nodes, parms, channels) to the page.

    Houdini drags carry SideFX mime types and no text, so the page's DOM drop
    sees nothing. The web view's render widget gets the Qt events; this filter
    sits on it, accepts Houdini drags, and calls window.houdiniPiDrop(paths).
    """

    def __init__(self, view):
        super().__init__(view)
        self._view = view
        view.installEventFilter(self)
        view.loadFinished.connect(self._watch_render_widget)
        self._watch_render_widget()

    def _watch_render_widget(self, *_):
        proxy = self._view.focusProxy()
        if proxy is not None:
            proxy.installEventFilter(self)
        for child in self._view.findChildren(QtWidgets.QWidget):
            child.installEventFilter(self)

    def eventFilter(self, watched, event):  # noqa: N802
        kind = event.type()
        is_drag = kind in (QtCore.QEvent.DragEnter, QtCore.QEvent.DragMove, QtCore.QEvent.Drop)
        if not is_drag:
            return False
        mime = event.mimeData()
        if not drops.is_houdini_drag(list(mime.formats())):
            return False
        if kind != QtCore.QEvent.Drop:
            event.acceptProposedAction()
            return True
        payload = {fmt: bytes(mime.data(fmt).data()) for fmt in mime.formats() if fmt in drops.HOUDINI_PATH_TYPES}
        paths = drops.paths_from_mime(payload)
        event.acceptProposedAction()
        self._view.page().runJavaScript(f"window.houdiniPiDrop && window.houdiniPiDrop({json.dumps(paths)})")
        return True


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
