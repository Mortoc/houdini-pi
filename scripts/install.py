#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Install houdini-pi into this user's Houdini: build, install the bridge, write the package JSON.

Run it through ./install, which checks the requirements first; this script
assumes they are met.

    ./install              # install or update
    ./install --uninstall  # remove the package file this script wrote

Never overwrites a package file it did not write itself.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER = "_houdini_pi_installer"
PACKAGE_NAME = "houdini_pi.json"
# The fxhoudinimcp release the sidecar is written against: the bridge on 127.0.0.1:8100.
BRIDGE_SPEC = "git+https://github.com/healkeiser/fxhoudinimcp@v2.25.0"
BRIDGE_PACKAGE_NAME = "fxhoudinimcp.json"

Runner = Callable[[list[str]], str | None]


def run_output(argv: list[str]) -> str | None:
    try:
        return subprocess.run(argv, capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def houdini_pref_dir(run: Runner = run_output) -> Path:
    out = run(["hython", "-c", "import hou; print(hou.homeHoudiniDirectory())"])
    if not out:
        raise SystemExit("install: hython could not report hou.homeHoudiniDirectory(); is Houdini licensed?")
    return Path(out.splitlines()[-1].strip())


def package_json(root: Path, node: str | None = None, uvx: str | None = None) -> dict:
    template = json.loads((root / "houdini" / "houdini_pi.json").read_text())
    data = json.loads(json.dumps(template).replace("__HOUDINI_PI_ROOT__", str(root)))
    # Houdini's PATH is not the shell's: pin the Node and uvx this install validated.
    # As found on PATH, NOT resolved: on NixOS `node` is /run/current-system/sw/bin/node,
    # a symlink into a store path that a node update plus a garbage collection deletes.
    # The PATH entry is the stable name; the store path behind it is not.
    uvx = uvx or shutil.which("uvx")
    node = node or shutil.which("node")
    if node:
        data["env"].append({"HOUDINI_PI_NODE": node})
    if uvx:
        data["env"].append({"HOUDINI_PI_UVX": uvx})
    return data


def write_package(packages_dir: Path, root: Path, node: str | None = None, uvx: str | None = None) -> Path:
    target = packages_dir / PACKAGE_NAME
    if target.exists():
        try:
            existing = json.loads(target.read_text())
        except ValueError:
            existing = {}
        if existing.get(MARKER) is not True:
            raise SystemExit(f"install: {target} exists and was not written by this installer; move it aside first.")
    packages_dir.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(package_json(root, node, uvx), indent=2) + "\n")
    return target


def remove_package(packages_dir: Path) -> bool:
    target = packages_dir / PACKAGE_NAME
    if not target.exists():
        return False
    data = json.loads(target.read_text())
    if data.get(MARKER) is not True:
        raise SystemExit(f"install: {target} was not written by this installer; not removing it.")
    target.unlink()
    return True


def bridge_root(package: dict) -> Path | None:
    """The plugin directory a fxhoudinimcp package file points Houdini at."""
    for entry in package.get("env", []):
        if "FXHOUDINIMCP" in entry:
            return Path(entry["FXHOUDINIMCP"])
    return None


def is_inside(path: Path, directory: Path) -> bool:
    try:
        path.resolve().relative_to(directory.resolve())
        return True
    except ValueError:
        return False


def install_bridge(packages_dir: Path, run: Runner = run_output) -> Path:
    """Install the fxhoudinimcp bridge as a uv TOOL and write its Houdini package from there.

    Not `uvx --from … houdini-package`, which upstream's README suggests: uvx runs from
    uv's cache, so the package file it writes points into ~/.cache/uv/archive-v0/…, and
    `uv cache clean` or `prune` deletes the bridge out from under Houdini. A uv tool
    lives at a stable path (`uv tool dir`) until it is uninstalled.
    """
    print(f"[install] uv tool install {BRIDGE_SPEC}")
    if subprocess.run(["uv", "tool", "install", BRIDGE_SPEC]).returncode != 0:
        raise SystemExit("install: could not install the fxhoudinimcp bridge with uv tool install")
    tool_bin, cache = run(["uv", "tool", "dir", "--bin"]), run(["uv", "cache", "dir"])
    if not tool_bin or not cache:
        raise SystemExit("install: uv could not report its tool or cache directory")
    exe = Path(tool_bin) / "fxhoudinimcp"
    if subprocess.run([str(exe), "houdini-package", "--write", str(packages_dir)]).returncode != 0:
        raise SystemExit(f"install: {exe} houdini-package failed")
    target = packages_dir / BRIDGE_PACKAGE_NAME
    plugin = bridge_root(json.loads(target.read_text()))
    if plugin is None or is_inside(plugin, Path(cache)):
        raise SystemExit(f"install: {target} points Houdini at {plugin}, inside uv's cache; it would not survive a cache clean")
    return target


def build(root: Path):
    for argv in (["npm", "ci"], ["npm", "run", "build"]):
        print(f"[install] {' '.join(argv)}")
        if subprocess.run(argv, cwd=root).returncode != 0:
            raise SystemExit(f"install: {' '.join(argv)} failed")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--uninstall", action="store_true")
    args = parser.parse_args(argv)

    if args.uninstall:
        removed = remove_package(houdini_pref_dir() / "packages")
        print("[install] removed" if removed else "[install] nothing to remove")
        return 0

    build(ROOT)
    packages = houdini_pref_dir() / "packages"
    print(f"[install] wrote {install_bridge(packages)}")
    target = write_package(packages, ROOT)
    print(f"[install] wrote {target}")
    print("[install] done. In Houdini: houdini-pi > Open Agent Pane")
    return 0


if __name__ == "__main__":
    sys.exit(main())
