import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def load():
    spec = importlib.util.spec_from_loader("houdini_pi_install", loader=None)
    module = importlib.util.module_from_spec(spec)
    module.__file__ = str(ROOT / "install")
    source = (ROOT / "install").read_text()
    exec(compile(source, str(ROOT / "install"), "exec"), module.__dict__)
    return module


def fake_tools(versions: dict[str, str | None]):
    def run(argv):
        return versions.get(argv[0])

    def which(name):
        return f"/bin/{name}" if name in versions else None

    return run, which


def test_all_present_reports_no_problems():
    m = load()
    run, which = fake_tools({"node": "v22.23.3", "pi": "1.1.0", "uv": "uv 0.11", "hython": "x"})
    assert m.check_dependencies(run, which) == []


def test_each_missing_dependency_is_named():
    m = load()
    run, which = fake_tools({"node": "v20.20.2", "pi": "0.87.1"})
    problems = m.check_dependencies(run, which)
    assert [p.split(" ")[0] for p in problems] == ["node", "pi", "uv", "hython"]
    assert "found (20, 20, 2)" in problems[0]
    assert "found (0, 87, 1)" in problems[1]


def test_package_json_points_at_the_repo(tmp_path: Path):
    m = load()
    target = m.write_package(tmp_path / "packages", ROOT)
    data = json.loads(target.read_text())
    assert data[m.MARKER] is True
    assert data["env"] == [{"HOUDINI_PI_ROOT": str(ROOT)}]
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


def test_version_parsing_tolerates_prefixes():
    m = load()
    assert m.parse_version("v22.23.3") == (22, 23, 3)
    assert m.parse_version("pi 1.1.0 (abc)") == (1, 1, 0)
    assert m.parse_version("garbage") is None
    assert m.version_at_least((22, 19, 0), m.NODE_MIN)
    assert not m.version_at_least((22, 18, 9), m.NODE_MIN)
