"""Find or start the Node sidecar for this Houdini process. Plain Python, no Qt."""

from __future__ import annotations

import json
import os
import secrets
import shutil
import subprocess
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any

PORT_BASE = 9100
PORT_SPAN = 400
PORT_SEARCH = 16
STATE_DIR = Path.home() / ".houdini-pi"


class SidecarError(RuntimeError):
    pass


SETTINGS_FILE = Path.home() / ".houdini-pi" / "settings.json"


def software_render_wanted(env: dict[str, str] | None = None, settings_file: Path = SETTINGS_FILE) -> bool:
    """Off by default: the pane renders on the GPU like the rest of Houdini.

    `HOUDINI_PI_SOFTWARE_RENDER=1`, or `{"pane": {"softwareRender": true}}` in
    the settings file, moves it to software. A future resource-pressure
    responder would flip this before opening the pane; it cannot change for a
    view that already exists, because Qt fixes the scene graph API at the first
    window.
    """
    env = os.environ if env is None else env
    if env.get("HOUDINI_PI_SOFTWARE_RENDER") == "1":
        return True
    try:
        settings = json.loads(settings_file.read_text())
    except (OSError, ValueError):
        return False
    return bool(settings.get("pane", {}).get("softwareRender", False))




def derive_port(pid: int) -> int:
    return PORT_BASE + (pid % PORT_SPAN)


def repo_root() -> Path:
    env = os.environ.get("HOUDINI_PI_ROOT")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[3]


def sidecar_entry(root: Path) -> Path:
    entry = root / "sidecar" / "dist" / "src" / "index.js"
    if not entry.exists():
        raise SidecarError(f"sidecar is not built: {entry} is missing. Run ./install in {root}.")
    return entry


def find_node(which: Callable[[str], str | None] = shutil.which, env: dict[str, str] | None = None) -> str:
    """The installer records the Node it validated in HOUDINI_PI_NODE (via the package JSON),
    because Houdini's own PATH rarely has a new enough node, or any node at all."""
    pinned = (env if env is not None else os.environ).get("HOUDINI_PI_NODE")
    if pinned:
        if not Path(pinned).exists():
            raise SidecarError(f"HOUDINI_PI_NODE={pinned} does not exist; re-run ./install.")
        return pinned
    node = which("node")
    if node is None:
        raise SidecarError("node is not on PATH and HOUDINI_PI_NODE is unset. Re-run ./install, which records the Node it finds.")
    return node


def make_token() -> str:
    return secrets.token_urlsafe(24)


def http_get_json(url: str, timeout: float = 0.5) -> dict[str, Any] | None:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError):
        return None


def probe_health(port: int, get: Callable[[str], dict[str, Any] | None] = http_get_json) -> dict[str, Any] | None:
    """The sidecar's /health payload when one of ours answers on `port`, else None."""
    payload = get(f"http://127.0.0.1:{port}/health")
    is_ours = isinstance(payload, dict) and payload.get("ok") is True and "houdiniPort" in payload
    return payload if is_ours else None


def token_file(port: int) -> Path:
    return STATE_DIR / f"sidecar-{port}.token"


def spawn(
    port: int,
    houdini_port: int,
    parent_pid: int,
    token: str,
    root: Path,
    popen: Callable[..., Any] = subprocess.Popen,
    which: Callable[[str], str | None] = shutil.which,
) -> list[str]:
    """Start the sidecar detached from Houdini's process group; it exits on its own when Houdini dies."""
    argv = [
        find_node(which),
        str(sidecar_entry(root)),
        "--port", str(port),
        "--houdini-port", str(houdini_port),
        "--parent-pid", str(parent_pid),
        "--token", token,
    ]
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    log = open(STATE_DIR / f"sidecar-{port}.log", "ab")
    popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, cwd=str(root), start_new_session=True, env=child_env())
    return argv


# Houdini's process env points the dynamic loader and Python at its own
# libraries. Node linked against the nix store then resolves libsqlite3 from
# Houdini's dsolib and dies with "undefined symbol: sqlite3session_attach".
SCRUBBED_ENV = ("LD_LIBRARY_PATH", "LD_PRELOAD", "PYTHONPATH", "PYTHONHOME", "QT_PLUGIN_PATH", "QT_QPA_PLATFORM_PLUGIN_PATH")


def child_env(base: dict[str, str] | None = None) -> dict[str, str]:
    env = dict(os.environ if base is None else base)
    for key in SCRUBBED_ENV:
        env.pop(key, None)
    return env


class Pending:
    """A sidecar that was just spawned; `url_if_ready()` is polled from a Qt timer, never a sleep loop."""

    def __init__(self, port: int, token: str, probe: Callable[[int], dict[str, Any] | None]):
        self.port = port
        self.token = token
        self.probe = probe
        self.polls = 0

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/?token={self.token}"

    @property
    def log(self) -> Path:
        return STATE_DIR / f"sidecar-{self.port}.log"

    def url_if_ready(self) -> str | None:
        self.polls += 1
        return self.url if self.probe(self.port) is not None else None


def start_sidecar(
    houdini_pid: int,
    houdini_port: int,
    root: Path | None = None,
    probe: Callable[[int], dict[str, Any] | None] = probe_health,
    spawner: Callable[..., Any] = spawn,
) -> str | Pending:
    """The pane URL of a sidecar already bound to this Houdini, or a Pending one just spawned.

    Returns immediately either way: Houdini's main thread is the caller, and a
    sleep here is a frozen UI.
    """
    root = root or repo_root()
    port = derive_port(houdini_pid)
    for candidate in range(port, port + PORT_SEARCH):
        health = probe(candidate)
        if health is None:
            port = candidate
            break
        is_ours = health.get("houdiniPort") == houdini_port and health.get("parentPid", houdini_pid) == houdini_pid
        if is_ours:
            saved = token_file(candidate)
            if not saved.exists():
                raise SidecarError(f"a sidecar answers on {candidate} but {saved} is gone; stop it and reopen the pane")
            return f"http://127.0.0.1:{candidate}/?token={saved.read_text().strip()}"
    else:
        raise SidecarError(f"no free port in {port}-{port + PORT_SEARCH - 1}")

    token = make_token()
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    token_file(port).write_text(token)
    spawner(port, houdini_port, houdini_pid, token, root)
    return Pending(port, token, probe)


def ensure_sidecar(
    houdini_pid: int,
    houdini_port: int,
    root: Path | None = None,
    probe: Callable[[int], dict[str, Any] | None] = probe_health,
    spawner: Callable[..., Any] = spawn,
    sleep: Callable[[float], None] = __import__("time").sleep,
    attempts: int = 40,
) -> str:
    """Blocking form of start_sidecar, for scripts and tests. The panel must not call this."""
    started = start_sidecar(houdini_pid, houdini_port, root, probe, spawner)
    if isinstance(started, str):
        return started
    for _ in range(attempts):
        url = started.url_if_ready()
        if url is not None:
            return url
        sleep(0.25)
    raise SidecarError(f"sidecar did not answer on {started.port} within {attempts * 0.25:.0f}s; see {started.log}")
