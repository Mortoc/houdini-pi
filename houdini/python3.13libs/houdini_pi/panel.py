"""The Python Panel: a QWebEngineView onto the sidecar's page. Nothing else lives here."""

from __future__ import annotations

import os
import traceback

from PySide6 import QtCore, QtWidgets

from houdini_pi import sidecar

BRIDGE_PORT_ENV = "HOUDINI_PI_BRIDGE_PORT"


def houdini_bridge_port() -> int:
    return int(os.environ.get(BRIDGE_PORT_ENV, "8100"))


def createInterface():  # noqa: N802  (Houdini's required name)
    try:
        url = sidecar.ensure_sidecar(os.getpid(), houdini_bridge_port())
    except Exception:
        return _error_widget(traceback.format_exc())
    try:
        from PySide6 import QtWebEngineWidgets
    except ImportError:
        return _error_widget("This Houdini's PySide6 has no QtWebEngineWidgets; houdini-pi needs it.")
    view = QtWebEngineWidgets.QWebEngineView()
    view.setUrl(QtCore.QUrl(url))
    return view


def _error_widget(text: str) -> QtWidgets.QWidget:
    label = QtWidgets.QLabel(text)
    label.setWordWrap(True)
    label.setTextInteractionFlags(QtCore.Qt.TextSelectableByMouse)
    label.setAlignment(QtCore.Qt.AlignTop)
    return label
