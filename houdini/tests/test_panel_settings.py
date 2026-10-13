import json
from pathlib import Path

from houdini_pi import sidecar


def test_software_render_is_off_by_default(tmp_path: Path):
    assert sidecar.software_render_wanted(env={}, settings_file=tmp_path / "none.json") is False


def test_software_render_from_env_or_settings(tmp_path: Path):
    assert sidecar.software_render_wanted(env={"HOUDINI_PI_SOFTWARE_RENDER": "1"}, settings_file=tmp_path / "none.json") is True
    f = tmp_path / "settings.json"
    f.write_text(json.dumps({"pane": {"softwareRender": True}}))
    assert sidecar.software_render_wanted(env={}, settings_file=f) is True
    f.write_text("{bad")
    assert sidecar.software_render_wanted(env={}, settings_file=f) is False


def test_auto_layout_is_none_by_default(tmp_path: Path):
    assert sidecar.auto_layout_wanted(env={}, settings_file=tmp_path / "none.json") is None


def test_auto_layout_from_env(tmp_path: Path):
    assert sidecar.auto_layout_wanted(env={"HOUDINI_PI_AUTO_LAYOUT": "1"}, settings_file=tmp_path / "none.json") is True
    assert sidecar.auto_layout_wanted(env={"HOUDINI_PI_AUTO_LAYOUT": "0"}, settings_file=tmp_path / "none.json") is False


def test_auto_layout_from_settings(tmp_path: Path):
    f = tmp_path / "settings.json"
    f.write_text(json.dumps({"layout": {"autoLayout": True}}))
    assert sidecar.auto_layout_wanted(env={}, settings_file=f) is True
    f.write_text(json.dumps({"layout": {"autoLayout": False}}))
    assert sidecar.auto_layout_wanted(env={}, settings_file=f) is False
    # Settings without the layout key: leave the upstream default alone.
    f.write_text(json.dumps({"pane": {"softwareRender": True}}))
    assert sidecar.auto_layout_wanted(env={}, settings_file=f) is None
    f.write_text("{bad")
    assert sidecar.auto_layout_wanted(env={}, settings_file=f) is None


def test_auto_layout_env_wins_over_settings(tmp_path: Path):
    f = tmp_path / "settings.json"
    f.write_text(json.dumps({"layout": {"autoLayout": True}}))
    assert sidecar.auto_layout_wanted(env={"HOUDINI_PI_AUTO_LAYOUT": "0"}, settings_file=f) is False
