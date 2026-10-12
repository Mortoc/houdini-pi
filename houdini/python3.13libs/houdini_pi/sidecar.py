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


def find_node(which: Callable[[str], str | None] = shutil.which) -> str:
    node = which("node")
    if node is None:
        raise SidecarError("node is not on PATH. houdini-pi needs Node 22.19 or newer.")
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
    popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, cwd=str(root), start_new_session=True)
    return argv


def ensure_sidecar(
    houdini_pid: int,
    houdini_port: int,
    root: Path | None = None,
    probe: Callable[[int], dict[str, Any] | None] = probe_health,
    spawner: Callable[..., Any] = spawn,
    sleep: Callable[[float], None] = __import__("time").sleep,
    attempts: int = 40,
) -> str:
    """Return the pane URL (with token) for a sidecar bound to this Houdini, starting one if needed."""
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
    for _ in range(attempts):
        if probe(port) is not None:
            return f"http://127.0.0.1:{port}/?token={token}"
        sleep(0.25)
    raise SidecarError(f"sidecar did not answer on {port} within {attempts * 0.25:.0f}s; see {STATE_DIR / f'sidecar-{port}.log'}")
