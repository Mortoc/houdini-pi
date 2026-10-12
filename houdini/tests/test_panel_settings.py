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
