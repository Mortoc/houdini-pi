import importlib.util
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SH = shutil.which("sh")


def load():
    path = ROOT / "scripts" / "install.py"
    spec = importlib.util.spec_from_loader("houdini_pi_install", loader=None)
    module = importlib.util.module_from_spec(spec)
    module.__file__ = str(path)
    exec(compile(path.read_text(), str(path), "exec"), module.__dict__)
    return module


def check(tmp_path: Path, tools: dict[str, str], *args: str) -> subprocess.CompletedProcess:
    """Run `./install --check` with only `tools` on PATH, each printing its version."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    for name, version in tools.items():
        stub = bin_dir / name
        stub.write_text(f"#!{SH}\necho '{version}'\n")
        stub.chmod(0o755)
    env = {"PATH": str(bin_dir), "HOME": str(tmp_path / "home")}
    return subprocess.run([SH, str(ROOT / "install"), "--check", *args], env=env, capture_output=True, text=True)


ALL = {"uv": "uv 0.11.2", "uvx": "uv 0.11.2", "node": "v22.23.3", "npm": "10.9.0", "pi": "pi 1.1.0 (abc)", "hython": "x"}


def failed(result: subprocess.CompletedProcess) -> list[str]:
    return [line.split()[1] for line in result.stdout.splitlines() if line.lstrip().startswith("✗")]


def test_all_present_passes(tmp_path: Path):
    result = check(tmp_path, ALL)
    assert result.returncode == 0, result.stdout + result.stderr
    assert failed(result) == []
    assert "22.23.3" in result.stdout and "1.1.0" in result.stdout


def test_nothing_installed_names_everything_at_once(tmp_path: Path):
    result = check(tmp_path, {})
    assert result.returncode == 1
    assert failed(result) == ["uv", "node", "npm", "pi", "hython"]
    assert "astral.sh/uv/install.sh" in result.stdout
    assert "5 requirements are missing" in result.stderr


def test_old_versions_are_reported_with_what_was_found(tmp_path: Path):
    result = check(tmp_path, {**ALL, "node": "v22.18.9", "pi": "0.87.1"})
    assert result.returncode == 1
    assert failed(result) == ["node", "pi"]
    assert "found 22.18.9, need 22.19.0 or newer" in result.stdout
    assert "found 0.87.1, need 1.0.0 or newer" in result.stdout


def test_uv_installed_but_off_path_says_so(tmp_path: Path):
    tools = dict(ALL)
    del tools["uv"]
    local_bin = tmp_path / "home" / ".local" / "bin"
    local_bin.mkdir(parents=True)
    (local_bin / "uv").write_text(f"#!{SH}\n")
    (local_bin / "uv").chmod(0o755)
    result = check(tmp_path, tools)
    assert failed(result) == ["uv"]
    assert f"installed at {local_bin / 'uv'} but not on PATH" in result.stdout


def test_unknown_option_is_refused(tmp_path: Path):
    result = check(tmp_path, ALL, "--bogus")
    assert result.returncode == 2
    assert "unknown option '--bogus'" in result.stderr


def test_package_json_points_at_the_repo(tmp_path: Path):
    m = load()
    target = m.write_package(tmp_path / "packages", ROOT, node="/nix/store/x/bin/node", uvx="/nix/store/y/bin/uvx")
    data = json.loads(target.read_text())
    assert data[m.MARKER] is True
    assert data["env"] == [{"HOUDINI_PI_ROOT": str(ROOT)}, {"HOUDINI_PI_NODE": "/nix/store/x/bin/node"}, {"HOUDINI_PI_UVX": "/nix/store/y/bin/uvx"}]
    assert data["path"] == "$HOUDINI_PI_ROOT/houdini"
    assert m.remove_package(tmp_path / "packages") is True
    assert m.remove_package(tmp_path / "packages") is False


def test_refuses_to_touch_a_foreign_package_file(tmp_path: Path):
    m = load()
    packages = tmp_path / "packages"
    packages.mkdir()
    (packages / m.PACKAGE_NAME).write_text('{"path": "/someone/elses"}')
    with pytest.raises(SystemExit, match="not written by this installer"):
        m.write_package(packages, ROOT)
    with pytest.raises(SystemExit, match="not written by this installer"):
        m.remove_package(packages)


def test_package_json_keeps_the_path_entry_not_the_store_path_behind_it(tmp_path: Path):
    # On NixOS /run/current-system/sw/bin/node is a symlink into a store path that a
    # node update plus a garbage collection deletes; Houdini must get the PATH name.
    m = load()
    store = tmp_path / "store" / "nodejs-24" / "bin"
    store.mkdir(parents=True)
    (store / "node").write_text("")
    profile = tmp_path / "sw" / "bin"
    profile.mkdir(parents=True)
    (profile / "node").symlink_to(store / "node")
    data = m.package_json(ROOT, node=str(profile / "node"), uvx=str(profile / "uvx"))
    assert {"HOUDINI_PI_NODE": str(profile / "node")} in data["env"]
    assert {"HOUDINI_PI_UVX": str(profile / "uvx")} in data["env"]


def test_bridge_root_reads_the_fxhoudinimcp_package_file():
    m = load()
    assert m.bridge_root({"env": [{"FXHOUDINIMCP_PORT": "8100"}, {"FXHOUDINIMCP": "/x/houdini"}]}) == Path("/x/houdini")
    assert m.bridge_root({"env": []}) is None


def test_a_bridge_inside_uvs_cache_is_detected(tmp_path: Path):
    # What upstream's `uvx --from … houdini-package` writes: a path `uv cache clean` deletes.
    m = load()
    cache, tools = tmp_path / "cache", tmp_path / "tools"
    assert m.is_inside(cache / "archive-v0" / "abc" / "fxhoudinimcp" / "houdini", cache)
    assert not m.is_inside(tools / "fxhoudinimcp" / "houdini", cache)
